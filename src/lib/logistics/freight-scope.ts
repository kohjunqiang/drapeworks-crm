// Isomorphic helpers for scoped bulk freight assignment: shared by the server
// action (shapes), the client selection store, and tests. Keep free of React,
// Next, and database imports.
import type { FulfilmentStatus } from "@/lib/db/schema";
import { statusIndex } from "@/lib/status-flow";
import { normalizeFreightNumber } from "./freight";
import type { ShipmentCategory } from "./shipments";

/** Server-side freight facts for one order component, scoped to chosen orders. */
export type ScopedFreightComponent = {
  orderId: string;
  orderIdentifier: string;
  customerName: string;
  development: string | null;
  category: ShipmentCategory;
  notNeeded: boolean;
  freightNumber: string | null;
  freightAssignedAt: string | null;
  arrivedCheckedAt: string | null;
  updatedAt: string;
  currentStatus: FulfilmentStatus;
  assignable: boolean;
  /** Why the component cannot be picked, when it is not assignable. */
  unavailableReason: string | null;
};

/** A selected order with its components — empty components still render. */
export type ScopedFreightOrder = {
  orderId: string;
  orderIdentifier: string;
  customerName: string;
  development: string | null;
  currentStatus: FulfilmentStatus;
  components: ScopedFreightComponent[];
};

export function freightComponentKey(
  orderId: string,
  category: string,
): string {
  return `${orderId}:${category}`;
}

/**
 * The single source of "can this component carry a new freight code" — the
 * same predicate the orders dashboard applies and the server enforces.
 */
export function isFreightAssignable(input: {
  currentStatus: FulfilmentStatus;
  arrivedCheckedAt: string | null;
  notNeeded: boolean;
}): boolean {
  const index = statusIndex(input.currentStatus);
  return index >= statusIndex("sent_to_vendor") &&
    index <= statusIndex("shipping_sg") &&
    !input.arrivedCheckedAt && !input.notNeeded;
}

export function freightUnavailableReason(input: {
  currentStatus: FulfilmentStatus;
  arrivedCheckedAt: string | null;
  notNeeded: boolean;
}): string | null {
  if (input.notNeeded) return "Marked not needed — restore it from the order first";
  if (input.arrivedCheckedAt) return "Already arrived — reopen the arrival from the order first";
  const index = statusIndex(input.currentStatus);
  if (index < statusIndex("sent_to_vendor")) {
    return "Not sent to vendor yet — review the vendor orders first";
  }
  if (index > statusIndex("shipping_sg")) return "Past the shipping stage";
  return null;
}

export type FreightSelectionItem = { id: string; label: string };

/** Bounded so a stale tab can never hand the server an unbounded payload. */
export const ORDER_SELECTION_MAX = 250;

/** Hard server cap on components per freight code — mirrored client-side. */
export const FREIGHT_COMPONENT_LIMIT = 250;

/** Keys of every component that can take a code and does not have one yet. */
export function eligibleUnassignedKeys(
  orders: ScopedFreightOrder[],
): Set<string> {
  const keys = new Set<string>();
  for (const order of orders) {
    for (const component of order.components) {
      if (component.assignable && !component.freightNumber) {
        keys.add(freightComponentKey(component.orderId, component.category));
      }
    }
  }
  return keys;
}

/** Only the chosen components, carrying the freight code seen at load time. */
export function freightAssignmentPayload(
  orders: ScopedFreightOrder[],
  selectedKeys: ReadonlySet<string>,
): { orderId: string; category: ShipmentCategory; expectedFreightNumber: string | null }[] {
  const payload: {
    orderId: string;
    category: ShipmentCategory;
    expectedFreightNumber: string | null;
  }[] = [];
  for (const order of orders) {
    for (const component of order.components) {
      if (selectedKeys.has(freightComponentKey(component.orderId, component.category))) {
        payload.push({
          orderId: component.orderId,
          category: component.category,
          expectedFreightNumber: component.freightNumber,
        });
      }
    }
  }
  return payload;
}

/**
 * After a scoped reload, keep only the picks still assignable under the fresh
 * facts — a component that became unavailable, vanished, or now rides the
 * typed code is dropped, and the caller is told how many fell out.
 */
export function retainedScopedKeys(
  orders: ScopedFreightOrder[],
  selectedKeys: ReadonlySet<string>,
  freightNumber: string,
): { kept: Set<string>; dropped: number } {
  const normalized = normalizeFreightNumber(freightNumber);
  const fresh = new Map<string, ScopedFreightComponent>();
  for (const order of orders) {
    for (const component of order.components) {
      fresh.set(
        freightComponentKey(component.orderId, component.category),
        component,
      );
    }
  }
  const kept = new Set<string>();
  let dropped = 0;
  for (const key of selectedKeys) {
    const component = fresh.get(key);
    const ridesTypedCode = Boolean(
      normalized && component?.freightNumber &&
      normalizeFreightNumber(component.freightNumber) === normalized,
    );
    if (component && component.assignable && !ridesTypedCode) {
      kept.add(key);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

// --- Cross-page selection store --------------------------------------------
// Selection lives in sessionStorage so Link-based pagination (which remounts
// the page-level provider) and filter changes both keep it. Identity is the
// authenticated user's id — never cookie or token contents. Deliberately NOT
// keyed on filters: freight selection survives a result-set change.

export const ORDER_SELECTION_STORAGE_PREFIX = "drapeworks:order-freight-selection";
export const ORDER_SELECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function orderSelectionStorageKey(actorId: string): string {
  return `${ORDER_SELECTION_STORAGE_PREFIX}:${actorId}`;
}

/** Remove selections owned by any other actor (account switch on a shared tab). */
export function pruneForeignSelectionKeys(
  storage: { length: number; key: (index: number) => string | null; removeItem: (key: string) => void },
  actorId: string,
): void {
  const ours = `${ORDER_SELECTION_STORAGE_PREFIX}:${actorId}`;
  const stale: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${ORDER_SELECTION_STORAGE_PREFIX}:`) && !key.startsWith(ours)) {
      stale.push(key);
    }
  }
  for (const key of stale) storage.removeItem(key);
}

/** Parse a persisted selection — bounded, well-formed, unexpired — or null. */
export function parseStoredSelection(
  raw: string | null,
  now: number,
  maxAgeMs = ORDER_SELECTION_MAX_AGE_MS,
): FreightSelectionItem[] | null {
  if (!raw) return null;
  let data: { selected?: unknown; savedAt?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data?.savedAt !== "number" || now - data.savedAt > maxAgeMs) return null;
  const seen = new Set<string>();
  const items = (Array.isArray(data.selected) ? data.selected : [])
    .filter((item): item is FreightSelectionItem =>
      !!item && typeof item === "object" &&
      typeof (item as FreightSelectionItem).id === "string" &&
      typeof (item as FreightSelectionItem).label === "string")
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, ORDER_SELECTION_MAX);
  return items.length ? items : null;
}

export function serializeSelection(selected: FreightSelectionItem[]): string {
  return JSON.stringify({ selected, savedAt: Date.now() });
}

/** Toggle one order: append when absent, remove when present. */
export function toggleSelectionItem(
  selected: FreightSelectionItem[],
  item: FreightSelectionItem,
): FreightSelectionItem[] | "limit" {
  if (selected.some((entry) => entry.id === item.id)) {
    return selected.filter((entry) => entry.id !== item.id);
  }
  if (selected.length >= ORDER_SELECTION_MAX) return "limit";
  return [...selected, item];
}

export type PageSelectionState = "none" | "some" | "all";

export function pageSelectionState(
  selected: FreightSelectionItem[],
  pageOrderIds: readonly string[],
): PageSelectionState {
  if (!pageOrderIds.length) return "none";
  const chosen = new Set(selected.map((item) => item.id));
  const picked = pageOrderIds.filter((id) => chosen.has(id)).length;
  if (picked === 0) return "none";
  return picked === pageOrderIds.length ? "all" : "some";
}

/**
 * Page-only toggle: fully-selected page removes just its rows (off-page picks
 * survive); otherwise adds the page rows still missing — never touches others.
 */
export function togglePageSelection(
  selected: FreightSelectionItem[],
  pageOrders: FreightSelectionItem[],
): FreightSelectionItem[] | "limit" {
  const pageIds = new Set(pageOrders.map((order) => order.id));
  if (pageSelectionState(selected, [...pageIds]) === "all") {
    return selected.filter((item) => !pageIds.has(item.id));
  }
  const chosen = new Set(selected.map((item) => item.id));
  const missing = pageOrders.filter((order) => !chosen.has(order.id));
  if (selected.length + missing.length > ORDER_SELECTION_MAX) return "limit";
  return [...selected, ...missing];
}
