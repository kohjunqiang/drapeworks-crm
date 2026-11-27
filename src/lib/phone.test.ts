import { describe, expect, it } from "vitest";

import {
  canonicalizePhone,
  inferPhoneCountry,
  parsePhone,
  resolvePhoneCountry,
  typingPhoneCountry,
} from "./phone";

describe("canonicalizePhone", () => {
  it("normalises a Singapore national number under the SG default", () => {
    expect(canonicalizePhone("9123 4567")).toBe("+6591234567");
    expect(canonicalizePhone("81234567")).toBe("+6581234567");
  });

  it("normalises a Malaysian national number with its trunk 0 under MY", () => {
    expect(canonicalizePhone("012-345 6789", "MY")).toBe("+60123456789");
  });

  it("normalises a Chinese national number under CN", () => {
    expect(canonicalizePhone("138 1234 5678", "CN")).toBe("+8613812345678");
  });

  it("honours an explicit + prefix regardless of the selected country", () => {
    expect(canonicalizePhone("+60 12 345 6789", "SG")).toBe("+60123456789");
    expect(canonicalizePhone("+65 9123 4567", "MY")).toBe("+6591234567");
  });

  it("honours a 00 international prefix without a selected country", () => {
    expect(canonicalizePhone("0086 138 1234 5678")).toBe("+8613812345678");
    expect(canonicalizePhone("0060 12 345 6789", "")).toBe("+60123456789");
  });

  it("keeps significant leading zeros (Italy)", () => {
    expect(canonicalizePhone("+39 02 1234 5678")).toBe("+390212345678");
  });

  it("never double-prefixes an already-canonical number", () => {
    expect(canonicalizePhone("+6591234567")).toBe("+6591234567");
  });

  it("keeps an explicit extension instead of dropping it", () => {
    const canonical = canonicalizePhone("+1 415 234 5678 ext. 89");
    expect(canonical).not.toBeNull();
    expect(canonical).toContain("+14152345678");
    expect(canonical).toContain("89");
  });

  it("accepts possible-length numbers rather than requiring allocated ranges", () => {
    // Allocated-range strictness (isValid) would reject some of these;
    // possible-length is the agreed bar.
    expect(canonicalizePhone("+60 12 345 6789")).not.toBeNull();
    expect(canonicalizePhone("+852 6123 4567")).not.toBeNull();
  });

  it.each(["", "   ", "abc", "whatsapp me on 9123", "+", "12345"])(
    "returns null for unreadable input %j",
    (input) => {
      expect(canonicalizePhone(input)).toBeNull();
    },
  );

  it("returns null for a bare foreign national number under the SG default", () => {
    // Without the selector the server cannot guess MY — stays raw on relaxed
    // paths and errors on strict ones.
    expect(canonicalizePhone("0123456789")).toBeNull();
  });

  it("accepts international numbers whose calling code attributes no country", () => {
    // +1 is shared across NANP and +800 is non-geographic — libphonenumber
    // reports country undefined, but the number is still canonical.
    expect(canonicalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(canonicalizePhone("+800 1234 5678")).toBe("+80012345678");
  });

  it("rejects SG inputs that fail the 8-digit customer rule", () => {
    // Possible-length alone accepts SG service ranges; the shared [3689]
    // 8-digit guard keeps "60123456789" from becoming +6560123456789.
    expect(canonicalizePhone("60123456789")).toBeNull();
    expect(canonicalizePhone("+6560123456789")).toBeNull();
  });
});

describe("parsePhone", () => {
  it("reports the parsed country and national number", () => {
    const parsed = parsePhone("+60 12 345 6789");
    expect(parsed?.country).toBe("MY");
    expect(parsed?.nationalNumber).toBe("123456789");
  });

  it("returns an undefined country for shared and non-geographic codes", () => {
    expect(parsePhone("+1 (555) 123-4567")?.country).toBeUndefined();
    expect(parsePhone("+800 1234 5678")?.country).toBeUndefined();
  });
});

describe("inferPhoneCountry", () => {
  it("defaults to Singapore for an empty value", () => {
    expect(inferPhoneCountry("")).toBe("SG");
    expect(inferPhoneCountry("   ")).toBe("SG");
  });

  it("infers the country of an explicit international value", () => {
    expect(inferPhoneCountry("+60 12 345 6789")).toBe("MY");
    expect(inferPhoneCountry("0086 138 1234 5678")).toBe("CN");
  });

  it("infers the fallback country for a bare national number", () => {
    expect(inferPhoneCountry("91234567")).toBe("SG");
    expect(inferPhoneCountry("0123456789", "MY")).toBe("MY");
  });

  it("reports no country for values that are not readable numbers", () => {
    // The selector must show its "other" state rather than silently claiming SG.
    expect(inferPhoneCountry("whatsapp only")).toBe("");
  });
});

// The draft-restore boundary: a persisted country selection must survive a
// value that can't re-infer it (an incomplete national number), while a
// value that can infer always wins.
describe("resolvePhoneCountry", () => {
  it("restores the persisted country for an incomplete national number", () => {
    // "0123" parses under no country — without the remembered selection the
    // selector would collapse to "other" on draft restore.
    expect(resolvePhoneCountry("0123", "MY")).toBe("MY");
  });

  it("lets an inferable value win over the persisted country", () => {
    expect(resolvePhoneCountry("+60 12 345 6789", "SG")).toBe("MY");
    expect(resolvePhoneCountry("9123 4567", "MY")).toBe("SG");
  });

  it("shows 'other' for a parsed explicit number with no attributable country", () => {
    // +800 is non-geographic and +1 is shared across NANP — a successful
    // parse owns its (empty) country; the persisted pick must not win.
    expect(resolvePhoneCountry("+800 1234 5678", "MY")).toBe("");
    expect(resolvePhoneCountry("+1 (555) 123-4567", "MY")).toBe("");
  });

  it("restores the persisted country for unparseable legacy text", () => {
    expect(resolvePhoneCountry("whatsapp only", "MY")).toBe("MY");
  });

  it("keeps the SG default for an empty value regardless of persistence", () => {
    expect(resolvePhoneCountry("", "MY")).toBe("SG");
  });

  it("falls back to no country with nothing persisted and nothing inferable", () => {
    expect(resolvePhoneCountry("whatsapp only", null)).toBe("");
  });
});

// Selector state across keystrokes: the SG default and deliberate picks must
// survive incomplete national input; only an explicit "+"/"00" prefix may
// change the selection mid-typing.
describe("typingPhoneCountry", () => {
  it("keeps Singapore selected through a whole national number", () => {
    let country = resolvePhoneCountry("", null); // fresh empty field = SG
    for (const partial of ["9", "91", "912", "9123 4567"]) {
      country = typingPhoneCountry(partial, country, "");
      expect(country).toBe("SG");
    }
  });

  it("keeps a deliberate MY pick through partial input", () => {
    expect(typingPhoneCountry("0", "MY", "")).toBe("MY");
    expect(typingPhoneCountry("0123", "MY", "")).toBe("MY");
    expect(typingPhoneCountry("012-345 678", "MY", "")).toBe("MY");
  });

  it("keeps the 'other' state through national input under no country", () => {
    // Legacy/unparseable text must not be silently reattributed to SG.
    expect(typingPhoneCountry("91234567", "", "")).toBe("");
  });

  it("re-infers when the text carries an explicit + or 00 prefix", () => {
    expect(typingPhoneCountry("+60123456789", "SG", "")).toBe("MY");
    expect(typingPhoneCountry("0060 12 345 6789", "MY", "")).toBe("MY");
    expect(typingPhoneCountry("+65 9123 4567", "MY", "")).toBe("SG");
  });

  it("reports 'other' for an explicit prefix that cannot attribute a country", () => {
    expect(typingPhoneCountry("+800 1234 5678", "SG", "")).toBe("");
  });

  // The reload boundary: the effective typing country is persisted under the
  // draft-scoped key, so a partial national draft restores its selection.
  it("a persisted typing country restores SG over a partial national draft", () => {
    const persistedAfterTyping = typingPhoneCountry("9", "SG", "");
    expect(resolvePhoneCountry("9", persistedAfterTyping)).toBe("SG");
  });

  it("fresh SG typing replaces a stale persisted MY on restore", () => {
    // Stale remembered MY + fresh "9" -> the held SG is what gets persisted,
    // so the restored draft resolves SG rather than the stale pick.
    const persistedAfterTyping = typingPhoneCountry("9", "SG", "MY");
    expect(persistedAfterTyping).toBe("SG");
    expect(resolvePhoneCountry("9", persistedAfterTyping)).toBe("SG");
  });
});
