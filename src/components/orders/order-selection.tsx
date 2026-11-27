"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  ORDER_SELECTION_MAX,
  orderSelectionStorageKey,
  pageSelectionState,
  parseStoredSelection,
  pruneForeignSelectionKeys,
  serializeSelection,
  togglePageSelection,
  toggleSelectionItem,
  type FreightSelectionItem,
  type PageSelectionState,
} from "@/lib/logistics/freight-scope";

type OrderSelectionContextValue = {
  selected: FreightSelectionItem[];
  selectedCount: number;
  selectedIds: Set<string>;
  pageOrders: FreightSelectionItem[];
  pageState: PageSelectionState;
  canSelect: boolean;
  toggle: (order: FreightSelectionItem) => void;
  togglePage: () => void;
  clear: () => void;
};

const OrderSelectionContext = createContext<OrderSelectionContextValue | null>(null);

export function useOrderSelection() {
  return useContext(OrderSelectionContext);
}

export function OrderSelectionProvider({
  children,
  actorId,
  canSelect,
  pageOrders,
}: {
  children: ReactNode;
  actorId: string;
  canSelect: boolean;
  /** Orders rendered on this page — drives the Select-this-page tri-state. */
  pageOrders: FreightSelectionItem[];
}) {
  const [selected, setSelected] = useState<FreightSelectionItem[]>([]);
  const selectedRef = useRef(selected);
  const pageOrdersRef = useRef(pageOrders);
  useEffect(() => {
    selectedRef.current = selected;
    pageOrdersRef.current = pageOrders;
  });

  const storageKey = useMemo(
    () => (canSelect ? orderSelectionStorageKey(actorId) : null),
    [actorId, canSelect],
  );

  // A different account signing in on this tab must never see stored picks.
  useEffect(() => {
    if (!storageKey) return;
    try {
      pruneForeignSelectionKeys(sessionStorage, actorId);
    } catch { /* blocked */ }
  }, [actorId, storageKey]);

  // Restore the stored selection post-hydration (no SSR mismatch). The stored
  // page/filters of each pick are irrelevant — ids survive any result set.
  const restoredForKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = parseStoredSelection(sessionStorage.getItem(storageKey), Date.now());
        if (stored) setSelected(stored);
      } catch { /* corrupted entry — ignore */ }
      restoredForKeyRef.current = storageKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || restoredForKeyRef.current !== storageKey) return;
    try {
      sessionStorage.setItem(storageKey, serializeSelection(selected));
    } catch { /* storage full — selection lives in memory only */ }
  }, [selected, storageKey]);

  const selectedIds = useMemo(
    () => new Set(selected.map((item) => item.id)),
    [selected],
  );
  const pageState = useMemo(
    () => pageSelectionState(selected, pageOrders.map((order) => order.id)),
    [selected, pageOrders],
  );

  const toggle = useCallback((order: FreightSelectionItem) => {
    const next = toggleSelectionItem(selectedRef.current, order);
    if (next === "limit") {
      toast.error(`Freight selection is limited to ${ORDER_SELECTION_MAX} orders at a time.`);
      return;
    }
    setSelected(next);
  }, []);

  const togglePage = useCallback(() => {
    const next = togglePageSelection(selectedRef.current, pageOrdersRef.current);
    if (next === "limit") {
      toast.error(`Freight selection is limited to ${ORDER_SELECTION_MAX} orders at a time.`);
      return;
    }
    setSelected(next);
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const value = useMemo<OrderSelectionContextValue>(() => ({
    selected,
    selectedCount: selected.length,
    selectedIds,
    pageOrders,
    pageState,
    canSelect,
    toggle,
    togglePage,
    clear,
  }), [selected, selectedIds, pageOrders, pageState, canSelect, toggle, togglePage, clear]);

  return (
    <OrderSelectionContext.Provider value={value}>
      {children}
    </OrderSelectionContext.Provider>
  );
}
