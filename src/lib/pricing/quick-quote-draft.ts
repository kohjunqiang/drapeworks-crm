import type { CalculatorValues } from "@/lib/validation/pricing-calculator";

export type QuickQuoteDraft = { values: CalculatorValues; override: string | null };

/** A tab-memory draft, not a saved quote. Copy both directions so React Hook
 * Form and later edits cannot mutate a cached draft belonging to another mount. */
export function createQuickQuoteDraftStore() {
  const drafts = new Map<string, QuickQuoteDraft>();
  return {
    read(profileId: string): QuickQuoteDraft | null {
      const draft = drafts.get(profileId);
      return draft ? structuredClone(draft) : null;
    },
    write(profileId: string, draft: QuickQuoteDraft) {
      drafts.set(profileId, structuredClone(draft));
    },
    clear(profileId: string) { drafts.delete(profileId); },
  };
}

const browserDrafts = createQuickQuoteDraftStore();
// This client-imported module can also be evaluated during SSR. No draft data
// may ever be read or written in that server process's module singleton.
export function readQuickQuoteDraft(profileId: string) {
  return typeof window === "undefined" ? null : browserDrafts.read(profileId);
}
export function writeQuickQuoteDraft(profileId: string, draft: QuickQuoteDraft) {
  if (typeof window !== "undefined") browserDrafts.write(profileId, draft);
}
export function clearQuickQuoteDraft(profileId: string) {
  if (typeof window !== "undefined") browserDrafts.clear(profileId);
}
