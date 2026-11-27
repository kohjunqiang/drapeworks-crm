import { describe, expect, it } from "vitest";

import {
  eligibleUnassignedKeys,
  freightAssignmentPayload,
  freightComponentKey,
  freightUnavailableReason,
  isFreightAssignable,
  ORDER_SELECTION_MAX,
  orderSelectionStorageKey,
  pageSelectionState,
  parseStoredSelection,
  pruneForeignSelectionKeys,
  retainedScopedKeys,
  serializeSelection,
  togglePageSelection,
  toggleSelectionItem,
  type FreightSelectionItem,
  type ScopedFreightComponent,
  type ScopedFreightOrder,
} from "./freight-scope";

const ORDER_A = "a31fd642-0fe2-4066-9762-880b0e023471";
const ORDER_B = "b31fd642-0fe2-4066-9762-880b0e023471";
const ORDER_C = "c31fd642-0fe2-4066-9762-880b0e023471";

function component(overrides: Partial<ScopedFreightComponent> = {}): ScopedFreightComponent {
  return {
    orderId: ORDER_A,
    orderIdentifier: "DW-0001",
    customerName: "Customer A",
    development: null,
    category: "curtains",
    notNeeded: false,
    freightNumber: null,
    freightAssignedAt: null,
    arrivedCheckedAt: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
    currentStatus: "sent_to_vendor",
    assignable: true,
    unavailableReason: null,
    ...overrides,
  };
}

function order(components: ScopedFreightComponent[], id = ORDER_A): ScopedFreightOrder {
  return {
    orderId: id,
    orderIdentifier: "DW-0001",
    customerName: "Customer A",
    development: null,
    currentStatus: "sent_to_vendor",
    components,
  };
}

describe("isFreightAssignable / freightUnavailableReason", () => {
  it("accepts the freight-assignment status window", () => {
    for (const status of ["sent_to_vendor", "sent_logistic", "shipping_sg"] as const) {
      expect(isFreightAssignable({ currentStatus: status, arrivedCheckedAt: null, notNeeded: false })).toBe(true);
      expect(freightUnavailableReason({ currentStatus: status, arrivedCheckedAt: null, notNeeded: false })).toBeNull();
    }
  });

  it("rejects with reasons for every unavailable shape", () => {
    expect(freightUnavailableReason({ currentStatus: "sent_to_vendor", arrivedCheckedAt: null, notNeeded: true }))
      .toMatch(/not needed/i);
    expect(freightUnavailableReason({ currentStatus: "sent_to_vendor", arrivedCheckedAt: "2026-11-01T00:00:00Z", notNeeded: false }))
      .toMatch(/arrived/i);
    expect(freightUnavailableReason({ currentStatus: "po_ready", arrivedCheckedAt: null, notNeeded: false }))
      .toMatch(/sent to vendor/i);
    expect(freightUnavailableReason({ currentStatus: "delivered_checked", arrivedCheckedAt: null, notNeeded: false }))
      .toMatch(/past/i);
    expect(isFreightAssignable({ currentStatus: "po_ready", arrivedCheckedAt: null, notNeeded: false })).toBe(false);
  });
});

describe("eligibleUnassignedKeys", () => {
  it("picks only assignable components with no freight code", () => {
    const orders = [
      order([
        component({ category: "curtains" }),
        component({ category: "standard_tracks", freightNumber: "FR-1" }),
        component({ category: "blinds", assignable: false, unavailableReason: "Already arrived" }),
      ]),
    ];
    expect([...eligibleUnassignedKeys(orders)]).toEqual([
      freightComponentKey(ORDER_A, "curtains"),
    ]);
  });
});

describe("freightAssignmentPayload", () => {
  it("submits only the chosen components, with the code seen at load time", () => {
    const orders = [
      order([
        component({ category: "curtains" }),
        component({ category: "standard_tracks", freightNumber: "OLD-1" }),
        component({ category: "blinds" }),
      ]),
    ];
    const selected = new Set([
      freightComponentKey(ORDER_A, "curtains"),
      freightComponentKey(ORDER_A, "standard_tracks"),
    ]);
    expect(freightAssignmentPayload(orders, selected)).toEqual([
      { orderId: ORDER_A, category: "curtains", expectedFreightNumber: null },
      { orderId: ORDER_A, category: "standard_tracks", expectedFreightNumber: "OLD-1" },
    ]);
  });
});

describe("retainedScopedKeys", () => {
  it("keeps still-assignable picks and reports the dropped count", () => {
    const orders = [
      order([
        component({ category: "curtains" }),
        component({ category: "standard_tracks", assignable: false, unavailableReason: "Past the shipping stage" }),
        component({ category: "blinds", freightNumber: "FR-9" }),
      ]),
      order([
        component({ orderId: ORDER_B, category: "curtains", freightNumber: "OLD-1" }),
      ], ORDER_B),
    ];
    const selected = new Set([
      freightComponentKey(ORDER_A, "curtains"),
      freightComponentKey(ORDER_A, "standard_tracks"),
      freightComponentKey(ORDER_A, "blinds"),
      freightComponentKey(ORDER_B, "curtains"),
      freightComponentKey(ORDER_C, "curtains"),
    ]);
    const { kept, dropped } = retainedScopedKeys(orders, selected, "fr-9");
    // Unavailable, now-on-the-typed-code, and vanished picks all fall out;
    // a pick riding a different code stays (fresh confirmation required).
    expect([...kept].sort()).toEqual([
      freightComponentKey(ORDER_A, "curtains"),
      freightComponentKey(ORDER_B, "curtains"),
    ].sort());
    expect(dropped).toBe(3);
  });

  it("keeps a pick riding the typed code when no code is typed yet", () => {
    const orders = [order([component({ category: "curtains", freightNumber: "OLD-1" })])];
    const selected = new Set([freightComponentKey(ORDER_A, "curtains")]);
    expect(retainedScopedKeys(orders, selected, "").kept.size).toBe(1);
    expect(retainedScopedKeys(orders, selected, "old-1").kept.size).toBe(0);
  });
});

const item = (id: string): FreightSelectionItem => ({ id, label: id });

describe("order selection store", () => {
  it("toggles a single order on and off", () => {
    let selected: FreightSelectionItem[] = [];
    selected = toggleSelectionItem(selected, item(ORDER_A)) as FreightSelectionItem[];
    expect(selected.map((i) => i.id)).toEqual([ORDER_A]);
    selected = toggleSelectionItem(selected, item(ORDER_B)) as FreightSelectionItem[];
    selected = toggleSelectionItem(selected, item(ORDER_A)) as FreightSelectionItem[];
    expect(selected.map((i) => i.id)).toEqual([ORDER_B]);
  });

  it("refuses to grow past the cap", () => {
    const full = Array.from({ length: ORDER_SELECTION_MAX }, (_, i) => item(`order-${i}`));
    expect(toggleSelectionItem(full, item("one-more"))).toBe("limit");
  });

  it("reports the page tri-state", () => {
    const selected = [item(ORDER_A)];
    expect(pageSelectionState(selected, [ORDER_A, ORDER_B])).toBe("some");
    expect(pageSelectionState(selected, [ORDER_A])).toBe("all");
    expect(pageSelectionState(selected, [ORDER_B, ORDER_C])).toBe("none");
    expect(pageSelectionState(selected, [])).toBe("none");
  });

  it("page toggle keeps off-page picks when removing this page", () => {
    const selected = [item(ORDER_A), item(ORDER_B), item(ORDER_C)];
    const next = togglePageSelection(selected, [item(ORDER_A), item(ORDER_B)]);
    expect(next).not.toBe("limit");
    expect((next as FreightSelectionItem[]).map((i) => i.id)).toEqual([ORDER_C]);
  });

  it("page toggle adds only this page's missing rows", () => {
    const selected = [item(ORDER_A), item(ORDER_C)];
    const next = togglePageSelection(selected, [item(ORDER_A), item(ORDER_B)]);
    expect((next as FreightSelectionItem[]).map((i) => i.id)).toEqual([ORDER_A, ORDER_C, ORDER_B]);
  });

  it("persists, restores, dedupes and expires stored selections", () => {
    const selected = [item(ORDER_A), item(ORDER_B)];
    const raw = serializeSelection(selected);
    expect(parseStoredSelection(raw, Date.now())).toEqual(selected);
    expect(parseStoredSelection(raw, Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
    expect(parseStoredSelection("not-json", Date.now())).toBeNull();
    expect(parseStoredSelection(null, Date.now())).toBeNull();
    const duped = JSON.stringify({
      savedAt: Date.now(),
      selected: [...selected, item(ORDER_A), { id: 3 }, null],
    });
    expect(parseStoredSelection(duped, Date.now())).toEqual(selected);
    expect(parseStoredSelection(JSON.stringify({ savedAt: Date.now(), selected: [] }), Date.now())).toBeNull();
  });

  it("scopes storage to the actor and prunes other actors' keys", () => {
    expect(orderSelectionStorageKey("u1")).toContain("u1");
    const keys = [
      orderSelectionStorageKey("u1"),
      orderSelectionStorageKey("u2"),
      "unrelated:key",
    ];
    const storage = {
      length: keys.length,
      key: (index: number) => keys[index] ?? null,
      removeItem: (key: string) => { keys.splice(keys.indexOf(key), 1); },
    };
    pruneForeignSelectionKeys(storage, "u1");
    expect(keys).toEqual([orderSelectionStorageKey("u1"), "unrelated:key"]);
  });
});
