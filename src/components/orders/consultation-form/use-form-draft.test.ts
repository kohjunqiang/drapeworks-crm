import { describe, expect, it } from "vitest";

import { formDraftKey, mergeFormDraft } from "./use-form-draft";

describe("formDraftKey", () => {
  it("uses the current recovery format instead of restoring legacy drafts", () => {
    expect(formDraftKey("curtain", "edit", "order-1")).toBe(
      "drapeworks:form-draft:v2:curtain:edit:order-1",
    );
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
