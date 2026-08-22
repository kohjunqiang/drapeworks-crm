import { describe, expect, it } from "vitest";

import {
  resolveWindowAddons,
  toCalcAddons,
  selectedAddonIds,
  type AddonRule,
} from "./window-addons";

const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

const rule = (over: Partial<AddonRule> = {}): AddonRule => ({
  id: id(1),
  key: "s_fold",
  label: "S-Fold",
  costRmbCents: 1100,
  saleSgdCents: 8000,
  basis: "per_metre",
  appliesTo: "curtain",
  autoRule: "manual",
  autoWidthOverCm: null,
  isActive: true,
  ...over,
});

describe("resolveWindowAddons — scope", () => {
  it("hides a curtain add-on from a blind", () => {
    expect(resolveWindowAddons("blind", 150, [], [], [rule()])).toEqual([]);
  });

  it("shows a 'both' add-on on each covering", () => {
    const both = rule({ id: id(2), key: "blackout", appliesTo: "both" });
    expect(resolveWindowAddons("blind", 150, [], [], [both])).toHaveLength(1);
    expect(resolveWindowAddons("curtain", 150, [], [], [both])).toHaveLength(1);
  });

  it("drops a persisted curtain add-on when the window became a blind", () => {
    // Scope runs FIRST, so survival cannot resurrect an out-of-scope add-on.
    expect(resolveWindowAddons("blind", 150, [id(1)], [id(1)], [rule()])).toEqual(
      [],
    );
  });
});

describe("resolveWindowAddons — nothing to offer", () => {
  it("hides an inactive add-on", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ isActive: false })],
    );
    expect(out).toEqual([]);
  });

  it("hides an add-on that charges nothing", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ costRmbCents: 0, saleSgdCents: 0 })],
    );
    expect(out).toEqual([]);
  });

  it("hides an unpriced width_over add-on however wide the window", () => {
    const out = resolveWindowAddons(
      "blind",
      300,
      [],
      [],
      [
        rule({
          key: "extra_shipping",
          appliesTo: "blind",
          autoRule: "width_over",
          autoWidthOverCm: 200,
          costRmbCents: null,
          saleSgdCents: null,
        }),
      ],
    );
    expect(out).toEqual([]);
  });

  it("keeps a cost-only add-on — it still moves COGS", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ costRmbCents: 2700, saleSgdCents: null })],
    );
    expect(out).toHaveLength(1);
  });

  it("keeps an inactive add-on the window already carries", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [id(1)],
      [id(1)],
      [rule({ isActive: false })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].selected).toBe(true);
    // Clearable, just not re-tickable once cleared and saved.
    expect(out[0].locked).toBe(false);
  });

  it("keeps a persisted add-on that has since been zeroed", () => {
    const out = resolveWindowAddons(
      "blind",
      150,
      [id(4)],
      [id(4)],
      [
        rule({
          id: id(4),
          key: "blinds_surcharge",
          appliesTo: "blind",
          costRmbCents: 0,
          saleSgdCents: 0,
        }),
      ],
    );
    expect(out).toHaveLength(1);
  });

  it("does not let selectedIds alone grant survival", () => {
    // The create-path forgery: a payload claiming an archived add-on was
    // already on a brand-new window. Only persistedIds may say that.
    const out = resolveWindowAddons(
      "curtain",
      150,
      [id(1)],
      [],
      [rule({ isActive: false })],
    );
    expect(out).toEqual([]);
  });
});

describe("resolveWindowAddons — auto rules", () => {
  const shipping = rule({
    id: id(3),
    key: "extra_shipping",
    label: "Extra shipping",
    appliesTo: "blind",
    basis: "per_unit",
    autoRule: "width_over",
    autoWidthOverCm: 200,
    costRmbCents: null,
    saleSgdCents: 13000,
  });

  it("leaves 199 unlocked", () => {
    const [a] = resolveWindowAddons("blind", 199, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("leaves exactly 200 unlocked — the threshold must be exceeded", () => {
    const [a] = resolveWindowAddons("blind", 200, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("locks 201", () => {
    const [a] = resolveWindowAddons("blind", 201, [], [], [shipping]);
    expect(a).toMatchObject({ selected: true, locked: true });
  });

  it("lets a consultant tick it below the threshold", () => {
    const [a] = resolveWindowAddons("blind", 150, [id(3)], [], [shipping]);
    expect(a).toMatchObject({ selected: true, locked: false });
  });

  it("never auto-locks an unmeasured window", () => {
    const [a] = resolveWindowAddons("blind", null, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("applies an 'always' add-on whatever the width", () => {
    const always = rule({
      id: id(4),
      key: "blinds_surcharge",
      appliesTo: "blind",
      autoRule: "always",
    });
    const [a] = resolveWindowAddons("blind", null, [], [], [always]);
    expect(a).toMatchObject({ selected: true, locked: true });
  });
});

describe("resolveWindowAddons — ordering", () => {
  it("puts active before archived, then sorts by label", () => {
    const rows = [
      rule({ id: id(5), key: "zebra", label: "Zebra" }),
      rule({ id: id(6), key: "alpha", label: "Alpha" }),
      rule({ id: id(7), key: "gone", label: "Archived", isActive: false }),
    ];
    const out = resolveWindowAddons("curtain", 150, [id(7)], [id(7)], rows);
    expect(out.map((a) => a.label)).toEqual(["Alpha", "Zebra", "Archived"]);
  });
});

describe("toCalcAddons / selectedAddonIds", () => {
  it("passes only the selected ones through, as calculator input", () => {
    const rows = [
      rule({ id: id(1), label: "S-Fold" }),
      rule({ id: id(2), key: "blackout", label: "Blackout" }),
    ];
    const resolved = resolveWindowAddons("curtain", 150, [id(2)], [], rows);
    expect(toCalcAddons(resolved)).toEqual([
      {
        label: "Blackout",
        costRmbCents: 1100,
        saleSgdCents: 8000,
        basis: "per_metre",
      },
    ]);
    expect(selectedAddonIds(resolved)).toEqual([id(2)]);
  });

  it("includes an auto-applied add-on the payload never ticked", () => {
    const shipping = rule({
      id: id(3),
      key: "extra_shipping",
      appliesTo: "blind",
      basis: "per_unit",
      autoRule: "width_over",
      autoWidthOverCm: 200,
      saleSgdCents: 13000,
    });
    const resolved = resolveWindowAddons("blind", 230, [], [], [shipping]);
    expect(selectedAddonIds(resolved)).toEqual([id(3)]);
  });
});
