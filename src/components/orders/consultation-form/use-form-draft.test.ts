import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCreateFormDrafts,
  clearDraftKey,
  draftChildKey,
  formDraftKey,
  mergeFormDraft,
} from "./use-form-draft";

// vitest runs in a node environment, so the browser global is stubbed with
// the smallest Storage shape the draft helpers use.
function stubSessionStorage() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
  vi.stubGlobal("sessionStorage", storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formDraftKey", () => {
  it("uses the current recovery format instead of restoring legacy drafts", () => {
    expect(formDraftKey("curtain", "edit", "order-1")).toBe(
      "drapeworks:form-draft:v3:curtain:edit:order-1",
    );
  });

  it("gives every order and mode its own identity", () => {
    const a = formDraftKey("curtain", "edit", "order-1");
    const b = formDraftKey("curtain", "edit", "order-2");
    const c = formDraftKey("curtain", "create", "appt-9");
    const d = formDraftKey("mesh", "edit", "order-1");
    expect(new Set([a, b, c, d]).size).toBe(4);
    // So the phone country slot nested under each can never be shared.
    expect(draftChildKey(a, "customer-mobile-country")).not.toBe(
      draftChildKey(b, "customer-mobile-country"),
    );
  });
});

describe("draftChildKey", () => {
  it("nests a companion slot under the draft identity", () => {
    const draft = formDraftKey("curtain", "edit", "order-1");
    expect(draftChildKey(draft, "customer-mobile-country")).toBe(
      "drapeworks:form-draft:v3:curtain:edit:order-1:customer-mobile-country",
    );
  });
});

// The phone country slot must live and die with the draft that owns it —
// a remembered MY from one consultation must not bleed into the next.
describe("draft lifecycle clearing", () => {
  it("clearDraftKey removes the snapshot and every nested slot", () => {
    const storage = stubSessionStorage();
    const draft = formDraftKey("curtain", "edit", "order-1");
    const phone = draftChildKey(draft, "customer-mobile-country");
    storage.setItem(draft, "{}");
    storage.setItem(phone, "MY");

    clearDraftKey(draft);

    expect(storage.getItem(draft)).toBeNull();
    expect(storage.getItem(phone)).toBeNull();
  });

  it("clearDraftKey never clears a sibling order sharing the prefix", () => {
    const storage = stubSessionStorage();
    const draft = formDraftKey("curtain", "edit", "order-1");
    const sibling = formDraftKey("curtain", "edit", "order-10");
    const siblingPhone = draftChildKey(sibling, "customer-mobile-country");
    storage.setItem(sibling, "{}");
    storage.setItem(siblingPhone, "MY");
    storage.setItem(draft, "{}");
    storage.setItem(draftChildKey(draft, "customer-mobile-country"), "CN");

    clearDraftKey(draft);

    expect(storage.getItem(sibling)).toBe("{}");
    expect(storage.getItem(siblingPhone)).toBe("MY");
  });

  it("customer change clears create drafts and their phone country slots", () => {
    const storage = stubSessionStorage();
    const createDraft = formDraftKey("curtain", "create", "appt-9");
    const createPhone = draftChildKey(createDraft, "customer-mobile-country");
    const editDraft = formDraftKey("curtain", "edit", "order-1");
    const editPhone = draftChildKey(editDraft, "customer-mobile-country");
    storage.setItem(createDraft, "{}");
    storage.setItem(createPhone, "MY");
    storage.setItem(editDraft, "{}");
    storage.setItem(editPhone, "CN");

    clearCreateFormDrafts("curtain");

    expect(storage.getItem(createDraft)).toBeNull();
    expect(storage.getItem(createPhone)).toBeNull();
    // Edit drafts and their slots belong to a different lifecycle.
    expect(storage.getItem(editDraft)).toBe("{}");
    expect(storage.getItem(editPhone)).toBe("CN");
  });

  it("customer change on curtain does not touch a mesh consultation", () => {
    const storage = stubSessionStorage();
    const meshPhone = draftChildKey(
      formDraftKey("mesh", "create", "appt-1"),
      "customer-mobile-country",
    );
    storage.setItem(meshPhone, "MY");

    clearCreateFormDrafts("curtain");

    expect(storage.getItem(meshPhone)).toBe("MY");
  });
});

describe("mergeFormDraft", () => {
  it("keeps a server-provided installation address missing from an older draft", () => {
    const defaults = {
      customer: { name: "Jamie", mobile: "8123 4567" },
      order: {
        development: "Parc Esta",
        site_address: "12 Example Street #03-04",
      },
    };

    const draft = {
      customer: { name: "Jamie Tan", mobile: "8123 4567" },
      order: { development: "Parc Esta" },
    };

    expect(mergeFormDraft(defaults, draft)).toEqual({
      customer: { name: "Jamie Tan", mobile: "8123 4567" },
      order: {
        development: "Parc Esta",
        site_address: "12 Example Street #03-04",
      },
    });
  });

  it("restores an installation address when the draft contains one", () => {
    const defaults = {
      order: { site_address: "Saved address", development: "Parc Esta" },
    };

    expect(
      mergeFormDraft(defaults, {
        order: { site_address: "Unsaved edited address" },
      }),
    ).toEqual({
      order: {
        site_address: "Unsaved edited address",
        development: "Parc Esta",
      },
    });
  });

  it("replaces arrays so deleted rooms are not restored from defaults", () => {
    const defaults = { rooms: [{ id: "room-1" }, { id: "room-2" }] };

    expect(mergeFormDraft(defaults, { rooms: [{ id: "room-1" }] })).toEqual({
      rooms: [{ id: "room-1" }],
    });
  });
});
