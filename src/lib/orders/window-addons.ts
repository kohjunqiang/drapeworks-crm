// Which add-ons a window offers, and which of them are ticked.
//
// Pure by design: the consultation form and every Server Action write path run
// the SAME function, so the live quote and the saved quote cannot disagree
// about what a window carries. It deliberately does NOT run at quote-read time
// — for a saved order the persisted window_addons rows are the truth, because a
// quote must reproduce what was agreed rather than what today's rules decide.

export type AddonBasis = "per_metre" | "per_unit";

export type AddonRule = {
  id: string;
  key: string;
  label: string;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: AddonBasis;
  appliesTo: "curtain" | "blind" | "both";
  autoRule: "manual" | "always" | "width_over";
  autoWidthOverCm: number | null;
  isActive: boolean;
};

export type ResolvedAddon = AddonRule & {
  /** Ticked, whether by the consultant or by the rule. */
  selected: boolean;
  /** The rule decided it; the consultant cannot untick it. */
  locked: boolean;
};

/** What the calculator needs — a resolved add-on stripped of its rules. */
export type CalcAddon = {
  key?: string;
  label: string;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: AddonBasis;
};

/**
 * An add-on with no cost AND no sale charges nothing. Offering it is the same
 * mistake as listing a curtain series with no price: a control that looks like
 * it does something and doesn't. Cost-only is a real add-on — it moves COGS —
 * so both sides must be empty to count as nothing.
 */
function chargesNothing(a: AddonRule): boolean {
  return !a.costRmbCents && !a.saleSgdCents;
}

export function resolveWindowAddons(
  covering: "curtain" | "blind",
  widthCm: number | null,
  /** What is ticked right now. On the server, the submitted set. */
  selectedIds: readonly string[],
  /**
   * What window_addons already holds for this window. Empty on both create
   * paths. This — never selectedIds — is what grants the survival exception,
   * so a payload cannot claim an archived add-on "was already there".
   */
  persistedIds: readonly string[],
  /** Every pricing_addons row, unfiltered. Filtering is this function's job. */
  catalogue: readonly AddonRule[],
): ResolvedAddon[] {
  const ticked = new Set(selectedIds);
  const persisted = new Set(persistedIds);

  const offered = catalogue.filter((a) => {
    // 1. Scope runs first, so nothing below can resurrect an add-on that
    //    belongs to the other covering.
    if (a.appliesTo !== "both" && a.appliesTo !== covering) return false;
    // 2. Don't offer what can't be quoted — unless the window already has it,
    //    in which case dropping it would silently delete a real charge on the
    //    next save.
    if (persisted.has(a.id)) return true;
    return a.isActive && !chargesNothing(a);
  });

  return offered
    .map((a): ResolvedAddon => {
      if (a.autoRule === "always") return { ...a, selected: true, locked: true };
      if (
        a.autoRule === "width_over" &&
        a.autoWidthOverCm != null &&
        widthCm != null &&
        widthCm > a.autoWidthOverCm
      ) {
        return { ...a, selected: true, locked: true };
      }
      // Manual, and any width_over that did not trigger. A persisted-but-
      // retired add-on lands here too: clearable, and once cleared the filter
      // above drops it for good.
      return { ...a, selected: ticked.has(a.id), locked: false };
    })
    .sort(
      (x, y) =>
        Number(y.isActive) - Number(x.isActive) ||
        x.label.localeCompare(y.label),
    );
}

/** The ticked add-ons, as calculator input. */
export function toCalcAddons(resolved: readonly ResolvedAddon[]): CalcAddon[] {
  return resolved
    .filter((a) => a.selected)
    .map((a) => ({
      key: a.key,
      label: a.label,
      costRmbCents: a.costRmbCents,
      saleSgdCents: a.saleSgdCents,
      basis: a.basis,
    }));
}

/** The ticked add-ons' ids, for persistence. */
export function selectedAddonIds(resolved: readonly ResolvedAddon[]): string[] {
  return resolved.filter((a) => a.selected).map((a) => a.id);
}
