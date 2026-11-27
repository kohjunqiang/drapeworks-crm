"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { getLeadBatchEditData, saveLeadBatch } from "@/lib/actions/leads-batch";
import {
  buildPatch, changedFields, pruneLeadErrors, reapplyChangedValues, valuesFromSnapshot, EXPANDED_FIELDS, TERMINAL_BATCH_STAGES,
  batchContextKey, batchDraftStorageKey, parseStoredDrafts, pruneForeignDraftKeys,
  type BatchEditableField, type BatchDraftValues, type LeadBatchError, type LeadBatchSnapshot,
} from "@/lib/leads/batch-draft";

export interface BatchEntry {
  snapshot: LeadBatchSnapshot;
  baseline: BatchDraftValues;
  values: BatchDraftValues;
  /** Page the lead was last seen on — used to jump back to an off-page row. */
  page: number;
  expanded: boolean;
  loading: boolean;
  errors: Record<string, string>;
  conflict?: LeadBatchSnapshot;
}

interface BatchEditContextValue {
  entries: Record<string, BatchEntry>;
  order: string[];
  selectedCount: number;
  changedCount: number;
  saving: boolean;
  saveErrors: LeadBatchError[];
  entryFor: (id: string) => BatchEntry | undefined;
  changedFor: (id: string) => BatchEditableField[];
  toggle: (lead: { id: string; name: string }) => void;
  setField: (id: string, field: BatchEditableField, value: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  discardLeadEdits: (id: string) => void;
  resolveConflict: (id: string, mode: "discard" | "reapply") => void;
  saveAll: () => void;
  cancelAll: () => void;
  jumpTo: (id: string, field?: string) => void;
  noteSeen: (id: string) => void;
  guardNavigation: (href: string) => boolean;
}

const BatchEditContext = createContext<BatchEditContextValue | null>(null);

export function useBatchEdit() {
  return useContext(BatchEditContext);
}

/** For components outside the leads list that still need the nav guard. */
export function useBatchEditGuard() {
  return useContext(BatchEditContext)?.guardNavigation;
}

const EMPTY_SNAPSHOT = (id: string): LeadBatchSnapshot => ({
  id, updated_at: "", is_archived: false, name: "", funnel_stage: "Qualify Lead",
  closure_reason: null, last_outcome: null, next_action_date_text: null, move_in_date_text: null,
  action_detail: null, mobile: null, development: null, inbound_outbound: null,
  contact_channel: "Other", source: null, primary_product: null, keys_collected: null,
  interaction_summary: null, quotation_breakdown: null, historical_summary: null,
  latest_quote_note: null, renovation_buying_stage: null, engagement_quality: null,
  latest_quote_cents: null, assigned_consultant_id: null, owner_id: null,
});

/** Max leads selectable at once — mirrors the server-side batch cap. */
export const BATCH_MAX = 50;

/** Variant-suffixed ids: desktop rows and mobile cards mount simultaneously. */
export type BatchVariant = "table" | "card";
export const batchRowDomId = (id: string, variant: BatchVariant) => `batch-lead-${variant}-${id}`;
export const batchFieldDomId = (id: string, field: string, variant: BatchVariant) => `batch-field-${variant}-${id}-${field}`;

/** Same list + same filters/sort/page-size — only the page number may differ. */
const navigationPreservesDrafts = (href: string) => {
  try {
    const next = new URL(href, window.location.origin);
    const current = new URL(window.location.href);
    if (next.origin !== current.origin || next.pathname !== current.pathname) return false;
    const strip = (url: URL) => {
      const params = new URLSearchParams(url.search);
      params.delete("page");
      params.sort();
      return params.toString();
    };
    return strip(next) === strip(current);
  } catch {
    return false;
  }
};

export function LeadBatchProvider({ children, currentPage, actorId }: { children: ReactNode; currentPage: number; actorId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<Record<string, BatchEntry>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<LeadBatchError[]>([]);
  const changedCount = useMemo(() => order.filter(id => {
    const entry = entries[id];
    return !!entry && !entry.loading && changedFields(entry.baseline, entry.values).length > 0;
  }).length, [entries, order]);
  const entriesRef = useRef(entries);
  const orderRef = useRef(order);
  const pageRef = useRef(currentPage);
  const changedCountRef = useRef(changedCount);
  const savingRef = useRef(saving);
  useEffect(() => {
    entriesRef.current = entries;
    orderRef.current = order;
    pageRef.current = currentPage;
    changedCountRef.current = changedCount;
    savingRef.current = saving;
  });

  const setEntry = useCallback((id: string, updater: (entry: BatchEntry) => BatchEntry | null) => {
    setEntries(prev => {
      const entry = prev[id];
      if (!entry) return prev;
      const next = updater(entry);
      if (next === entry) return prev;
      if (next === null) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const pruneSaveErrors = useCallback((id: string, field?: string) => {
    setSaveErrors(prev => pruneLeadErrors(prev, id, field));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries(prev => {
      if (!prev[id]) return prev;
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setOrder(prev => prev.filter(item => item !== id));
    setSaveErrors(prev => pruneLeadErrors(prev, id));
  }, []);

  // Render-safe: reads state. Event handlers use changedFieldsFor (ref-backed).
  const changedFor = useCallback((id: string) => {
    const entry = entries[id];
    return entry && !entry.loading ? changedFields(entry.baseline, entry.values) : [];
  }, [entries]);

  const changedFieldsFor = useCallback((id: string) => {
    const entry = entriesRef.current[id];
    return entry && !entry.loading ? changedFields(entry.baseline, entry.values).length : 0;
  }, []);

  const clearAll = useCallback(() => {
    setEntries({});
    setOrder([]);
    setSaveErrors([]);
  }, []);

  // Persist drafts to sessionStorage so browser Back/Forward away from /leads
  // can restore them. Identity is the authenticated user's id — never cookie or
  // token contents — plus a normalized result-context key (filters/sort/view/
  // pageSize, page excluded) so pagination within a context shares drafts.
  const storageKey = useMemo(
    () => batchDraftStorageKey(actorId, batchContextKey(searchParams.toString())),
    [actorId, searchParams],
  );

  // A different account signing in on this tab must never see stored drafts.
  useEffect(() => {
    try { pruneForeignDraftKeys(sessionStorage, actorId); } catch { /* blocked */ }
  }, [actorId]);

  // Restore the stored drafts for this context (post-hydration, so no SSR
  // mismatch). A stale version baseline surfaces as a normal conflict on the
  // next save. restoredForKey marks the storage key the persist effect may
  // safely write — it can never clobber a key before the restore pass has read
  // it (e.g. when the context changes and this effect re-runs).
  const restoredForKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = parseStoredDrafts<BatchEntry>(sessionStorage.getItem(storageKey), Date.now());
        if (stored) { setEntries(stored.entries); setOrder(stored.order); }
      } catch { /* corrupted entry — ignore */ }
      restoredForKeyRef.current = storageKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    if (restoredForKeyRef.current !== storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ entries, order, savedAt: Date.now() }));
    } catch { /* storage full — drafts live in memory only */ }
  }, [entries, order, storageKey]);

  const toggle = useCallback((lead: { id: string; name: string }) => {
    if (savingRef.current) return;
    const existing = entriesRef.current[lead.id];
    if (existing) {
      if (existing.loading) return;
      if (changedFieldsFor(lead.id) > 0 && !window.confirm(`Discard unsaved changes to ${lead.name}?`)) return;
      removeEntry(lead.id);
      return;
    }
    if (orderRef.current.length >= BATCH_MAX) {
      toast.error(`Batch editing is limited to ${BATCH_MAX} leads at a time.`);
      return;
    }
    const sourcePage = pageRef.current;
    setOrder(prev => [...prev, lead.id]);
    setEntries(prev => ({
      ...prev,
      [lead.id]: {
        snapshot: EMPTY_SNAPSHOT(lead.id),
        baseline: valuesFromSnapshot(EMPTY_SNAPSHOT(lead.id)),
        values: valuesFromSnapshot(EMPTY_SNAPSHOT(lead.id)),
        page: sourcePage, expanded: false, loading: true, errors: {},
      },
    }));
    getLeadBatchEditData({ lead_ids: [lead.id] })
      .then(({ leads }) => {
        const snapshot = leads.find(row => row.id === lead.id);
        if (!snapshot || snapshot.is_archived) {
          removeEntry(lead.id);
          toast.error(snapshot?.is_archived ? `${lead.name} is archived and cannot be edited.` : `Could not load ${lead.name} — it may no longer exist.`);
          return;
        }
        const values = valuesFromSnapshot(snapshot);
        setEntry(lead.id, entry => ({
          ...entry, snapshot, baseline: values, values,
          page: sourcePage, loading: false,
        }));
      })
      .catch(() => {
        removeEntry(lead.id);
        toast.error(`Could not load ${lead.name}. Please try again.`);
      });
  }, [changedFieldsFor, removeEntry, setEntry]);

  const setField = useCallback((id: string, field: BatchEditableField, value: string) => {
    if (savingRef.current) return;
    const current = entriesRef.current[id];
    if (!current || current.values[field] === value) return;
    setEntry(id, entry => {
      const errors = { ...entry.errors };
      delete errors[field];
      const expand = field === "funnel_stage" && TERMINAL_BATCH_STAGES.has(value);
      return { ...entry, values: { ...entry.values, [field]: value }, errors, expanded: entry.expanded || expand };
    });
    // Correcting a field clears its own stale save error; unrelated errors stay.
    pruneSaveErrors(id, field);
  }, [pruneSaveErrors, setEntry]);

  const setExpanded = useCallback((id: string, expanded: boolean) => {
    if (savingRef.current) return;
    setEntry(id, entry => entry.expanded === expanded ? entry : { ...entry, expanded });
  }, [setEntry]);

  const discardLeadEdits = useCallback((id: string) => {
    if (savingRef.current) return;
    setEntry(id, entry => {
      // On an unresolved conflict, "discard" must adopt the latest version —
      // resetting to the stale baseline would conflict again on the next save.
      const baseline = valuesFromSnapshot(entry.conflict ?? entry.snapshot);
      return {
        ...entry,
        ...(entry.conflict ? { snapshot: entry.conflict } : {}),
        baseline, values: baseline, errors: {}, conflict: undefined,
      };
    });
    pruneSaveErrors(id);
  }, [pruneSaveErrors, setEntry]);

  const resolveConflict = useCallback((id: string, mode: "discard" | "reapply") => {
    if (savingRef.current) return;
    setEntry(id, entry => {
      if (!entry.conflict) return entry;
      const baseline = valuesFromSnapshot(entry.conflict);
      // Reapply overlays ONLY the fields the user intentionally changed, so the
      // other editor's updates to untouched fields survive.
      return {
        ...entry, snapshot: entry.conflict, baseline,
        values: mode === "discard" ? baseline : reapplyChangedValues(baseline, entry.baseline, entry.values),
        errors: {}, conflict: undefined,
      };
    });
    pruneSaveErrors(id);
  }, [pruneSaveErrors, setEntry]);

  const noteSeen = useCallback((id: string) => {
    setEntry(id, entry => entry.page === pageRef.current ? entry : { ...entry, page: pageRef.current });
  }, [setEntry]);

  const pageHref = useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    return `${pathname}?${params.toString()}`;
  }, [pathname, searchParams]);

  const pendingFocus = useRef<{ id: string; field?: string; tries: number } | null>(null);
  // Both variants mount simultaneously; pick whichever is actually visible.
  const findEl = useCallback((build: (variant: BatchVariant) => string) => {
    for (const variant of ["table", "card"] as const) {
      const el = document.getElementById(build(variant));
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }, []);
  const attemptFocus = useCallback(() => {
    const target = pendingFocus.current;
    if (!target) return false;
    if (target.field) {
      // Wait for the expanded section / page to mount the requested field —
      // never silently downgrade a field jump to a row focus.
      const el = findEl(variant => batchFieldDomId(target.id, target.field as string, variant));
      if (!el) {
        if (target.tries++ < 40) return false;
        pendingFocus.current = null;
        return true;
      }
      pendingFocus.current = null;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      return true;
    }
    const row = findEl(variant => batchRowDomId(target.id, variant));
    if (!row) {
      if (target.tries++ < 40) return false;
      pendingFocus.current = null;
      return true;
    }
    pendingFocus.current = null;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    if (row instanceof HTMLElement) row.focus({ preventScroll: true });
    return true;
  }, [findEl]);
  // Rows mount asynchronously after page navigation; retry on every render.
  useEffect(() => { attemptFocus(); });

  const jumpTo = useCallback((id: string, field?: string) => {
    if (field && (EXPANDED_FIELDS as readonly string[]).includes(field)) {
      setEntry(id, entry => entry.expanded ? entry : { ...entry, expanded: true });
    }
    pendingFocus.current = { id, field, tries: 0 };
    if (attemptFocus()) return;
    const entry = entriesRef.current[id];
    if (entry && entry.page !== pageRef.current) router.push(pageHref(entry.page));
    else window.setTimeout(attemptFocus, 50);
  }, [attemptFocus, pageHref, router, setEntry]);

  const guardNavigation = useCallback((href: string) => {
    if (navigationPreservesDrafts(href)) return true;
    if (savingRef.current) return false;
    const dirty = changedCountRef.current;
    if (!dirty) {
      // Result-context changes (filter/sort/view/page-size) would leave stored
      // row pages wrong — drop clean selections rather than orphan them.
      if (orderRef.current.length > 0) clearAll();
      return true;
    }
    if (!window.confirm(`Discard unsaved changes to ${dirty} lead${dirty === 1 ? "" : "s"}?`)) return false;
    clearAll();
    return true;
  }, [clearAll]);

  const guardRef = useRef(guardNavigation);
  useEffect(() => { guardRef.current = guardNavigation; });

  // Anchor clicks: pagination stays inside the list and keeps drafts; anything
  // that changes the result set or leaves the page asks first when dirty.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      if (!guardRef.current(href)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (changedCountRef.current > 0 || savingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const saveAll = useCallback(() => {
    const current = entriesRef.current;
    const changed = orderRef.current
      .map(id => current[id])
      .filter((entry): entry is BatchEntry => !!entry && !entry.loading && changedFields(entry.baseline, entry.values).length > 0);
    if (!changed.length || savingRef.current) return;
    setSaving(true);
    setSaveErrors([]);
    const payload = changed.map(entry => ({
      id: entry.snapshot.id,
      expected_updated_at: entry.snapshot.updated_at,
      patch: buildPatch(entry.baseline, entry.values),
    }));
    void (async () => {
      try {
        const result = await saveLeadBatch({ leads: payload });
        if (!result.ok) {
          setSaveErrors(result.errors);
          setEntries(prev => {
            const next = { ...prev };
            for (const error of result.errors) {
              const entry = next[error.leadId];
              if (!entry) continue;
              const errors = { ...entry.errors };
              if (error.field) errors[error.field] = error.message;
              else errors.__lead = error.message;
              next[error.leadId] = { ...entry, errors, conflict: error.latest ?? entry.conflict };
            }
            return next;
          });
          toast.error("Some leads could not be saved — nothing was written. Fix the highlighted fields.");
          const first = result.errors.find(error => entriesRef.current[error.leadId]);
          if (first) jumpTo(first.leadId, first.field);
          return;
        }
        // Authoritative success: finish the batch entirely — saved leads may
        // leave the current filters, so a retained selection would jump wrong.
        clearAll();
        toast.success(`Saved ${result.saved.length} lead${result.saved.length === 1 ? "" : "s"}${result.skipped.length ? ` (${result.skipped.length} had no effective changes)` : ""}. Calculated columns update on reload — saved rows may leave the current filters.`);
        router.refresh();
      } catch {
        // Commit status unknown: never claim nothing was written.
        setSaveErrors([{ leadId: "", kind: "validation", message: "Could not confirm whether the batch saved. Your edits are kept — check the list before retrying." }]);
        toast.error("Could not confirm the save — your edits are kept. Check the list before retrying.");
      } finally {
        setSaving(false);
      }
    })();
  }, [clearAll, jumpTo, router]);

  const cancelAll = useCallback(() => {
    const dirty = changedCountRef.current;
    if (dirty && !window.confirm(`Discard unsaved changes to ${dirty} lead${dirty === 1 ? "" : "s"}?`)) return;
    clearAll();
  }, [clearAll]);

  const value = useMemo<BatchEditContextValue>(() => ({
    entries, order,
    selectedCount: order.length,
    changedCount,
    saving, saveErrors,
    entryFor: id => entries[id],
    changedFor,
    toggle, setField, setExpanded, discardLeadEdits, resolveConflict,
    saveAll, cancelAll, jumpTo, noteSeen, guardNavigation,
  }), [entries, order, changedCount, saving, saveErrors, changedFor, toggle, setField, setExpanded, discardLeadEdits, resolveConflict, saveAll, cancelAll, jumpTo, noteSeen, guardNavigation]);

  return <BatchEditContext.Provider value={value}>{children}</BatchEditContext.Provider>;
}
