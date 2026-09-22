import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoomSummaryCard } from "./room-summary-card";

type WindowSummary = Parameters<typeof RoomSummaryCard>[0]["windows"][number];

function blind(over: Partial<WindowSummary> = {}): WindowSummary {
  return {
    position: 1,
    width_cm: 120,
    height_cm: 150,
    notes: "Site note",
    draw: "Single Left",
    is_blind: true,
    blind_label: "Roller Blind",
    ...over,
  };
}

function curtain(over: Partial<WindowSummary> = {}): WindowSummary {
  return {
    position: 1,
    width_cm: 200,
    height_cm: 260,
    notes: "Site note",
    draw: "Double",
    day_curtain_label: "Linen Day",
    night_curtain_label: "Dimout Night",
    ...over,
  };
}

function render(windows: WindowSummary[]): string {
  return renderToStaticMarkup(
    createElement(RoomSummaryCard, {
      label: "Bedroom 1",
      type: "Bedroom",
      windows,
      photos: [],
    }),
  );
}

// The card renders one table per covering kind — curtains ("Day Curtain")
// then blinds ("Control side"). Splitting on "<table" scopes an assertion to
// a single table: each chunk runs to the next table's opening tag.
function tableWith(html: string, header: string): string {
  const table = html.split("<table").find((t) => t.includes(header));
  if (table === undefined) throw new Error(`no table headed "${header}"`);
  return table;
}

function blindTable(html: string): string {
  return tableWith(html, "Control side");
}

function rowWith(table: string, needle: string): string {
  const row = table.split("<tr").find((r) => r.includes(needle));
  if (row === undefined) throw new Error(`no row containing "${needle}"`);
  return row;
}

describe("RoomSummaryCard — blind add-ons", () => {
  it("renders a blind's add-ons in an Add-ons column", () => {
    const table = blindTable(render([blind({ addon_labels: ["Blackout"] })]));
    expect(table).toContain("Add-ons");
    expect(table).toContain("Blackout");
  });

  it("joins a blind's multiple add-ons", () => {
    const table = blindTable(
      render([blind({ addon_labels: ["Blackout", "Extra shipping"] })]),
    );
    expect(table).toContain("Blackout, Extra shipping");
  });

  it("shows a dash in the Add-ons cell when a blind has none", () => {
    const table = blindTable(
      render([
        blind({ position: 1, blind_label: "Roller A", addon_labels: [] }),
        blind({ position: 2, blind_label: "Roller B" }),
      ]),
    );
    for (const label of ["Roller A", "Roller B"]) {
      // Every other cell is populated, so the row's only "—" is the Add-ons
      // cell — not an empty cell, and not a stray label.
      expect(rowWith(table, label).match(/—/g)).toHaveLength(1);
    }
  });

  it("keeps curtain and blind add-ons in their own tables", () => {
    const html = render([
      curtain({ position: 1, addon_labels: ["S-Fold"] }),
      blind({ position: 2, addon_labels: ["Blackout"] }),
    ]);
    const curtains = tableWith(html, "Day Curtain");
    const blinds = blindTable(html);
    expect(curtains).toContain("S-Fold");
    expect(curtains).not.toContain("Blackout");
    expect(blinds).toContain("Blackout");
    expect(blinds).not.toContain("S-Fold");
  });

  // Combos price curtains only, so a blind never shows the badge.
  it("does not render a combo badge on a blind", () => {
    const table = blindTable(
      render([blind({ addon_labels: ["Blackout"], combo_label: "Bundle" })]),
    );
    expect(table).not.toContain("Bundle");
  });
});
