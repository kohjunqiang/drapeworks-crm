// The rail options a window can carry, defined ONCE.
//
// Four things change what the rail order says about a window, and until now
// every consumer checked them by name — the track-order loader asked for the
// "s_fold" add-on key, the shipment deriver compared against it again, the PO
// loader a third time, and slim tracks sat in window_addons being quietly
// ignored by all of them. This module is the single definition: each option's
// key, where its fact lives (a pricing add-on joined through window_addons, or
// a boolean column on the window itself), the text it prints on a rail line,
// and what carrying it DOES.
//
// NOTHING HERE READS THE DATABASE OR THE CLOCK.

import type { ShipmentCategory } from "@/lib/logistics/shipments";

export type TrackOptionKey =
  | "s_fold"
  | "slim_tracks"
  | "side_installation"
  | "overlap_tracks_attachment";

/** Where the fact that a window carries this option is stored. */
export type TrackOptionSource =
  | { kind: "addon"; addonKey: string }
  | {
      kind: "window_column";
      /** The flag on WindowTrackFacts backed by a boolean windows column. */
      column: "sideInstallation" | "overlapTracksAttachment";
    };

/** What carrying the option does to the rail order. */
export type TrackOptionEffect =
  /** The rail is a different product: its own card, its own shipment. */
  | {
      kind: "routes_shipment";
      shipmentKind: Extract<
        ShipmentCategory,
        "standard_tracks" | "s_fold_tracks"
      >;
    }
  /** Extra wording on the rail line; nothing else changes. */
  | { kind: "label" }
  /** The window is ALSO listed on a second order, with this suffix. */
  | { kind: "extra_order"; orderSuffix: string };

export type TrackOption = {
  key: TrackOptionKey;
  source: TrackOptionSource;
  /**
   * The wording appended to the rail line itself, stored verbatim like every
   * other catalogue label — null for the overlap attachment, which never
   * marks the base line and speaks only through its extra order.
   */
  railLabel: string | null;
  effect: TrackOptionEffect;
};

/**
 * The registry, in rail-line order: this is the sequence the suffixes print
 * in ("…配连接器 S-Fold Slim Tracks 侧装 Side installation"), so reordering
 * it reorders the order sheet.
 */
export const TRACK_OPTIONS: readonly TrackOption[] = [
  {
    key: "s_fold",
    source: { kind: "addon", addonKey: "s_fold" },
    railLabel: "S-Fold",
    effect: { kind: "routes_shipment", shipmentKind: "s_fold_tracks" },
  },
  {
    key: "slim_tracks",
    source: { kind: "addon", addonKey: "slim_tracks" },
    railLabel: "Slim Tracks",
    effect: { kind: "label" },
  },
  {
    key: "side_installation",
    source: { kind: "window_column", column: "sideInstallation" },
    railLabel: "侧装 Side installation",
    effect: { kind: "label" },
  },
  {
    key: "overlap_tracks_attachment",
    source: { kind: "window_column", column: "overlapTracksAttachment" },
    railLabel: null,
    effect: { kind: "extra_order", orderSuffix: "P6白色配交叉器" },
  },
];

/** Which options a window carries, keyed the same way as the registry. */
export type TrackOptions = Record<TrackOptionKey, boolean>;

/**
 * The pricing_addons keys a loader must fetch for the registry to resolve —
 * the add-on-sourced options and nothing else, so a new column-backed option
 * never widens the query.
 */
export const TRACK_OPTION_ADDON_KEYS: readonly string[] = TRACK_OPTIONS.flatMap(
  (option) => (option.source.kind === "addon" ? [option.source.addonKey] : []),
);

/** The facts a window brings: its add-on keys, and the two flag columns. */
export type WindowTrackFacts = {
  addonKeys: Iterable<string>;
  sideInstallation?: boolean;
  overlapTracksAttachment?: boolean;
};

/** Facts in, one flag per registered option out. */
export function resolveTrackOptions(facts: WindowTrackFacts): TrackOptions {
  const keys = new Set(facts.addonKeys);
  const resolved = {} as TrackOptions;
  for (const option of TRACK_OPTIONS) {
    resolved[option.key] =
      option.source.kind === "addon"
        ? keys.has(option.source.addonKey)
        : facts[option.source.column] === true;
  }
  return resolved;
}

/**
 * Which rail shipment the window's track belongs to: the routed kind when a
 * shipment-routing option is present, standard otherwise. Slim tracks is a
 * variant of the SAME rail, so it deliberately routes nowhere.
 */
export function railShipmentKind(
  options: TrackOptions,
): Extract<ShipmentCategory, "standard_tracks" | "s_fold_tracks"> {
  const routing = TRACK_OPTIONS.find(
    (option) =>
      option.effect.kind === "routes_shipment" && options[option.key],
  );
  return routing && routing.effect.kind === "routes_shipment"
    ? routing.effect.shipmentKind
    : "standard_tracks";
}

/**
 * Everything the rail line prints after 根配连接器, in registry order —
 * " S-Fold Slim Tracks 侧装 Side installation", or "" for a plain rail.
 */
export function railLineSuffix(options: TrackOptions): string {
  return TRACK_OPTIONS.filter(
    (option) => option.railLabel !== null && options[option.key],
  )
    .map((option) => ` ${option.railLabel}`)
    .join("");
}

/** Whether the window is also listed on an extra order (the overlap card). */
export function hasExtraOrder(options: TrackOptions): boolean {
  return TRACK_OPTIONS.some(
    (option) => option.effect.kind === "extra_order" && options[option.key],
  );
}

/**
 * The suffix the extra order appends after the whole base line —
 * " P6白色配交叉器", or "" when no extra-order option applies.
 */
export function extraOrderSuffix(options: TrackOptions): string {
  return TRACK_OPTIONS.filter(
    (option) => option.effect.kind === "extra_order" && options[option.key],
  )
    .map((option) =>
      option.effect.kind === "extra_order" ? ` ${option.effect.orderSuffix}` : "",
    )
    .join("");
}
