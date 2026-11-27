import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  link: null as null | {
    zoho_contact_id: string;
    pending_salutation: string | null;
    salutation_sync_error: string | null;
  },
  salutation: null as string | null,
  // Serialization lives inside the mocked sql.execute — the same call site
  // as pg_advisory_xact_lock — so deleting the lock in production code both
  // removes the faked mutual exclusion AND fails the lock-call assertion.
  queue: Promise.resolve() as Promise<unknown>,
  lockCalls: [] as { text: string; values: unknown[] }[],
  failNextLock: false,
  // The link-row FOR UPDATE acquire is a second hold point: a save that
  // commits its title+marker while an old sync is parked here must still
  // win, because the customers read happens AFTER the row lock is held.
  holdLinkAcquire: null as Promise<void> | null,
  gateReached: null as null | (() => void),
  reads: [] as string[],
  remote: vi.fn(),
}));

// The advisory lock acquires inside the transaction and releases at commit:
// execute blocks on the previous holder and registers its release ON THE
// EXECUTOR it was handed — the transaction-scoped object — so the commit
// releases exactly the lock ITS transaction took, never a later acquirer's.
vi.mock("kysely", () => ({
  sql: (strings: readonly string[], ...values: unknown[]) => {
    state.lockCalls.push({ text: strings.join("?"), values });
    return {
      execute: async (executor: { __releaseLock?: () => void }) => {
        if (state.failNextLock) {
          state.failNextLock = false;
          throw new Error("database unreachable");
        }
        const prev = state.queue;
        state.queue = new Promise<void>((resolve) => {
          if (executor) executor.__releaseLock = resolve;
        });
        await prev;
        return { rows: [] };
      },
    };
  },
}));

// A transaction-scoped fake: update write-backs honour their own WHERE fence
// (customer + exact zoho_contact_id), so a stale attempt can't land on a row
// that has since been relinked.
const trx = {
  selectFrom(table: string) {
    state.reads.push(table);
    const q: Record<string, unknown> = {};
    q.innerJoin = () => q;
    q.select = () => q;
    q.where = () => q;
    q.forUpdate = () => {
      q.__forUpdate = true;
      return q;
    };
    q.executeTakeFirst = async () => {
      if (table === "customer_zoho_links") {
        // The row-lock acquire is the hold point — and only a REAL forUpdate
        // engages it. Dropping the modifier skips the gate entirely, which
        // is exactly the ordering bug the regression test asserts against.
        if (q.__forUpdate && state.holdLinkAcquire) {
          state.gateReached?.();
          await state.holdLinkAcquire;
        }
        return state.link
          ? { zoho_contact_id: state.link.zoho_contact_id }
          : undefined;
      }
      if (table === "customers") {
        // A SECOND statement evaluates a fresh snapshot — the title committed
        // by the time the row lock was finally held, not the pre-wait one.
        return { salutation: state.salutation };
      }
      return undefined;
    };
    return q;
  },
  updateTable() {
    const wheres: Record<string, unknown> = {};
    let setValues: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    q.set = (values: Record<string, unknown>) => {
      setValues = values;
      return q;
    };
    q.where = (column: string, _op: string, value: unknown) => {
      wheres[column] = value;
      return q;
    };
    q.execute = async () => {
      // Honour whatever fence the caller set: a customer-scoped write applies
      // broadly, a write fenced to an exact zoho_contact_id misses a relink.
      if (
        state.link &&
        wheres.customer_id === "customer-1" &&
        (wheres.zoho_contact_id === undefined ||
          wheres.zoho_contact_id === state.link.zoho_contact_id)
      ) {
        Object.assign(state.link, setValues);
      }
      return [];
    };
    return q;
  },
};

vi.mock("@/lib/db/kysely", () => ({
  db: {
    transaction() {
      return {
        execute(fn: (t: typeof trx) => unknown) {
          // A fresh executor per transaction — its OWN advisory-lock release
          // travels on it, so commit frees this transaction's lock only.
          const executor = { ...trx } as typeof trx & {
            __releaseLock?: () => void;
          };
          return Promise.resolve()
            .then(() => fn(executor))
            .finally(() => {
              executor.__releaseLock?.();
            });
        },
      };
    },
    selectFrom() {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.where = () => q;
      q.executeTakeFirst = async () =>
        state.link
          ? {
              pending_salutation: state.link.pending_salutation,
              salutation_sync_error: state.link.salutation_sync_error,
            }
          : undefined;
      return q;
    },
  },
}));

vi.mock("./books", () => ({
  updateZohoPrimaryContactSalutation: state.remote,
}));

import {
  QUEUED_MESSAGE,
  queueZohoSalutationSync,
  retryZohoSalutation,
  syncZohoSalutation,
} from "./salutation-sync";

beforeEach(() => {
  state.link = {
    zoho_contact_id: "zoho-1",
    pending_salutation: null,
    salutation_sync_error: null,
  };
  state.salutation = "Mr";
  state.queue = Promise.resolve();
  state.lockCalls = [];
  state.failNextLock = false;
  state.holdLinkAcquire = null;
  state.gateReached = null;
  state.reads = [];
  state.remote.mockReset().mockResolvedValue(undefined);
});

// Resolves once the first remote call has STARTED (the sync holds the lock
// and is mid-flight), and captures its release so the test can land the PUT.
function holdFirstRemoteCall() {
  let release: (value?: unknown) => void = () => {};
  const started = new Promise<void>((resolve) => {
    state.remote.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
          resolve();
        }),
    );
  });
  return { started, release: () => release() };
}

describe("syncZohoSalutation", () => {
  it("pushes the committed title to the linked contact and clears the row", async () => {
    await syncZohoSalutation("customer-1");

    expect(state.remote).toHaveBeenCalledWith({
      contactId: "zoho-1",
      salutation: "Mr",
    });
    expect(state.link).toMatchObject({
      pending_salutation: null,
      salutation_sync_error: null,
    });
  });

  it("is a no-op when the customer has no Zoho link", async () => {
    state.link = null;
    await syncZohoSalutation("customer-1");
    expect(state.remote).not.toHaveBeenCalled();
  });

  it("parks the attempt on failure instead of throwing — the save already committed", async () => {
    state.remote.mockRejectedValueOnce(new Error("Zoho 500"));
    await expect(syncZohoSalutation("customer-1")).resolves.toBeUndefined();
    expect(state.link).toMatchObject({
      pending_salutation: "Mr",
      salutation_sync_error: "Zoho 500",
    });
  });

  it("keeps a title CLEAR visibly pending on failure", async () => {
    state.salutation = null;
    state.remote.mockRejectedValueOnce(new Error("Zoho 500"));
    await syncZohoSalutation("customer-1");
    // desired is null, so "pending" is carried by a non-null error — the
    // workspace can still show a retry.
    expect(state.link?.pending_salutation).toBeNull();
    expect(state.link?.salutation_sync_error).toBe("Zoho 500");
  });

  it("serializes overlapping saves: the attempt that runs last pushes the latest committed title", async () => {
    // First save: "Mr" — its remote call is still in flight…
    const firstCall = holdFirstRemoteCall();
    const first = syncZohoSalutation("customer-1");
    // Handshake: only once the first attempt holds the lock and reached the
    // remote call may the test commit the newer title and land its PUT.
    await firstCall.started;

    // …when a second save commits "Dr" and queues its own sync behind the lock.
    const second = syncZohoSalutation("customer-1");
    state.salutation = "Dr";
    firstCall.release();
    await Promise.all([first, second]);

    // Two remote calls: the queued second attempt re-read the customer under
    // the lock, so Zoho ends with the LATEST title — not the stale "Mr" the
    // slow first call finally wrote. Assert on the remote side effect, not
    // just the DB row.
    expect(state.remote).toHaveBeenCalledTimes(2);
    expect(state.remote.mock.calls[1]?.[0]).toMatchObject({
      contactId: "zoho-1",
      salutation: "Dr",
    });
    // Serialization came from the advisory lock itself — one acquire per
    // sync, keyed on the customer id.
    expect(state.lockCalls).toHaveLength(2);
    for (const call of state.lockCalls) {
      expect(call.text).toContain("pg_advisory_xact_lock");
      expect(call.values[0]).toBe("customer-1");
    }
    expect(state.link).toMatchObject({
      pending_salutation: null,
      salutation_sync_error: null,
    });
  });

  it("a save committing while the sync waits on the link row still wins — the title read is AFTER the row lock", async () => {
    // Old sync parked AT the link-row FOR UPDATE acquire…
    let releaseAcquire!: () => void;
    state.holdLinkAcquire = new Promise<void>((r) => (releaseAcquire = r));
    const gateReached = new Promise<void>((r) => (state.gateReached = r));
    const first = syncZohoSalutation("customer-1");
    await gateReached;

    // …when the original save commits title "Dr" AND its durable queue
    // marker. Without the row-lock-then-read split, the parked attempt would
    // overwrite this marker with the stale "Mr" and clear it after pushing
    // "Mr" — the committed marker would be lost with nothing to retry.
    state.salutation = "Dr";
    state.link = {
      zoho_contact_id: "zoho-1",
      pending_salutation: "Dr",
      salutation_sync_error: QUEUED_MESSAGE,
    };
    releaseAcquire();
    await first;

    // The link row locked FIRST, then the customers select ran — fresh
    // snapshot semantics, not a joined read frozen at the pre-wait snapshot.
    expect(state.reads).toEqual(["customer_zoho_links", "customers"]);
    // The pushed value is the one committed before the lock was held.
    expect(state.remote).toHaveBeenCalledWith({
      contactId: "zoho-1",
      salutation: "Dr",
    });
    // And the marker is cleared only because "Dr" was actually pushed —
    // cleared-as-processed, never clobbered-and-lost.
    expect(state.link).toMatchObject({
      pending_salutation: null,
      salutation_sync_error: null,
    });
  });

  it("cannot clobber a relinked row — the write-back is fenced to the exact contact", async () => {
    const firstCall = holdFirstRemoteCall();
    const first = syncZohoSalutation("customer-1");
    await firstCall.started;

    // Mid-flight relink: fresh row, different contact, nothing parked.
    state.link = {
      zoho_contact_id: "zoho-new",
      pending_salutation: null,
      salutation_sync_error: null,
    };
    firstCall.release();
    await first;

    // The slow attempt pushed to the OLD contact (correct — that was its
    // target) but its write-back hit zero rows: the relinked row stays clean.
    expect(state.remote).toHaveBeenCalledWith({
      contactId: "zoho-1",
      salutation: "Mr",
    });
    expect(state.link).toMatchObject({
      zoho_contact_id: "zoho-new",
      pending_salutation: null,
      salutation_sync_error: null,
    });
  });
});

describe("retryZohoSalutation", () => {
  it("re-pushes the customer's CURRENT title, not the parked one", async () => {
    // The parked value is stale — the customer was edited again after it failed.
    state.link = {
      zoho_contact_id: "zoho-1",
      pending_salutation: "Mr",
      salutation_sync_error: "Zoho 500",
    };
    state.salutation = "Ms";

    expect(await retryZohoSalutation("customer-1")).toBe(true);
    expect(state.remote).toHaveBeenCalledWith({
      contactId: "zoho-1",
      salutation: "Ms",
    });
    expect(state.link).toMatchObject({
      pending_salutation: null,
      salutation_sync_error: null,
    });
  });

  it("reports false while the push is still failing, leaving the row parked", async () => {
    state.link = {
      zoho_contact_id: "zoho-1",
      pending_salutation: "Dr",
      salutation_sync_error: "Zoho 500",
    };
    state.salutation = "Dr";
    state.remote.mockRejectedValueOnce(new Error("still down"));

    expect(await retryZohoSalutation("customer-1")).toBe(false);
    expect(state.link?.salutation_sync_error).toBe("still down");
  });

  it("is a clean no-op when nothing is parked", async () => {
    expect(await retryZohoSalutation("customer-1")).toBe(true);
    expect(state.remote).not.toHaveBeenCalled();
  });
});

describe("queueZohoSalutationSync", () => {
  it("parks the desired title durably inside the save transaction", async () => {
    await queueZohoSalutationSync(trx as never, "customer-1", "Dr");
    expect(state.link).toMatchObject({
      pending_salutation: "Dr",
      salutation_sync_error: QUEUED_MESSAGE,
    });
    expect(state.remote).not.toHaveBeenCalled();
  });

  it("queues a title CLEAR as a visible marker — pending null + non-null error", async () => {
    await queueZohoSalutationSync(trx as never, "customer-1", null);
    expect(state.link).toMatchObject({
      pending_salutation: null,
      salutation_sync_error: QUEUED_MESSAGE,
    });
  });

  it("is a no-op for a customer with no link — nothing to push", async () => {
    state.link = null;
    await queueZohoSalutationSync(trx as never, "customer-1", "Ms");
    expect(state.link).toBeNull();
    expect(state.remote).not.toHaveBeenCalled();
  });

  it("a dead post-commit sync leaves the committed queue marker retryable, not clean", async () => {
    // The order transaction committed the title AND the queue marker; the
    // post-commit sync's transaction then dies before the remote call.
    await queueZohoSalutationSync(trx as never, "customer-1", "Dr");
    state.salutation = "Dr";
    state.failNextLock = true;
    await expect(syncZohoSalutation("customer-1")).resolves.toBeUndefined();

    expect(state.remote).not.toHaveBeenCalled();
    // Not swallowed as clean: the marker committed with the save survives.
    expect(state.link).toMatchObject({
      pending_salutation: "Dr",
      salutation_sync_error: QUEUED_MESSAGE,
    });
    // …and the same retry path still pushes it through later.
    expect(await retryZohoSalutation("customer-1")).toBe(true);
    expect(state.remote).toHaveBeenCalledWith({
      contactId: "zoho-1",
      salutation: "Dr",
    });
  });
});
