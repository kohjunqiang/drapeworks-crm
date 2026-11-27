// Shared phone parsing and normalisation for customer and lead numbers.
// Used by client components (country inference, live canonicalisation) and by
// server-side Zod schemas (canonicalisation on the way into the database), so
// the same value means the same thing at every step of lead → appointment →
// order.
//
// libphonenumber-js carries the country rules — trunk prefixes that must be
// dropped (Malaysia's leading 0) or kept (Italy's leading 0), "00"
// international dialling, extension markers — so no hand-rolled country logic
// lives here.

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

// Deterministic labels: Intl.DisplayNames output differs across engines
// (server renders e.g. "Falkland Islands", some browsers append
// "(Islas Malvinas)"), which produced a hydration mismatch. The complete
// set is frozen into ./phone-country-names.ts at author time; the ISO code
// fallback is only a safety net for a country added without a name entry.
import { PHONE_COUNTRY_NAMES } from "./phone-country-names";

/** Bare national input is read as this country — the business is in Singapore. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "SG";

/**
 * The selector's "no country" state: an explicit "+"/"00" number still parses,
 * a bare national number is kept verbatim rather than guessed.
 */
export type PhoneCountryChoice = CountryCode | "";

export type ParsedPhone = {
  /** Canonical E.164, with " ext. N" appended when the input carried an extension. */
  canonical: string;
  /**
   * ISO country when the library can attribute one. Undefined for shared
   * calling codes (+1 covers US/CA/…) and non-geographic ranges (+800) —
   * those still canonicalise fine.
   */
  country: CountryCode | undefined;
  /** National significant number, e.g. "91234567" for "+65 9123 4567". */
  nationalNumber: string;
};

// "00" is the international dialling prefix for most countries (Singapore
// included). Rewrite it to "+" so an explicitly-prefixed foreign number parses
// no matter which country the selector happens to show.
function normalizeIdd(text: string): string {
  const trimmed = text.trim();
  return /^00\d/.test(trimmed) ? `+${trimmed.slice(2)}` : trimmed;
}

// Trailing "ext. 89" / "x89" / "extension 89" — detached before parsing so an
// extension can never silently disappear from the stored value.
const EXT_SUFFIX = /\s*(?:ext\.?|extension|x)\s*\.?\s*(\d{1,7})\s*$/i;

// Singapore customer numbers are 8 digits starting 3 (VoIP), 6 (landline),
// 8 or 9 (mobile) — the same rule the pre-libphonenumber schema enforced.
// Possible-length alone accepts SG service ranges (e.g. 11-digit "60…") that
// are not customer numbers, so this check is shared by every path.
const SG_NATIONAL = /^[3689]\d{7}$/;

export function parsePhone(
  text: string,
  defaultCountry: PhoneCountryChoice = DEFAULT_PHONE_COUNTRY,
): ParsedPhone | null {
  let input = text.trim();
  if (!input) return null;
  const extMatch = input.match(EXT_SUFFIX);
  const ext = extMatch?.[1] ?? null;
  if (extMatch) input = input.slice(0, extMatch.index).trim();
  input = normalizeIdd(input);
  const parsed = parsePhoneNumberFromString(input, {
    defaultCountry: defaultCountry || undefined,
    // extract:false — the whole field must be the number, so a legacy value
    // like "whatsapp 9123" is left alone instead of half-parsed.
    extract: false,
  });
  // Possible-length check, deliberately not isValid(): a number inside a
  // not-yet-allocated range still normalises instead of being rejected.
  // parsed.country may be undefined for shared codes (+1) or non-geographic
  // ranges (+800) — the number is still canonical and must be accepted.
  if (!parsed || !parsed.isPossible()) return null;
  if (parsed.country === "SG" && !SG_NATIONAL.test(parsed.nationalNumber)) return null;
  const extension = parsed.ext ?? ext;
  return {
    canonical: extension ? `${parsed.number} ext. ${extension}` : parsed.number,
    country: parsed.country,
    nationalNumber: parsed.nationalNumber,
  };
}

/** Canonical E.164 form of `text`, or null when it is not readable as a number. */
export function canonicalizePhone(
  text: string,
  defaultCountry: PhoneCountryChoice = DEFAULT_PHONE_COUNTRY,
): string | null {
  return parsePhone(text, defaultCountry)?.canonical ?? null;
}

/**
 * The country an existing value belongs to, for the selector's initial state.
 * Explicit "+"/"00" values report their own country; bare national values
 * report the fallback they parse under; anything else reports "" so the
 * control can show its "other" state instead of silently claiming Singapore.
 */
export function inferPhoneCountry(
  text: string,
  fallback: PhoneCountryChoice = DEFAULT_PHONE_COUNTRY,
): PhoneCountryChoice {
  const input = text.trim();
  if (!input) return fallback;
  if (input.startsWith("+") || /^00\d/.test(input)) {
    const explicit = parsePhone(input, "");
    // A parseable international number with an unattributable calling code
    // (+1, +800) shows "other" — never a guessed country.
    if (explicit) return explicit.country ?? "";
  }
  return parsePhone(input, fallback)?.country ?? "";
}

/**
 * Selector state when a value arrives from outside (draft restore, RHF
 * reset, a different customer). An incomplete national number can't
 * re-infer its country, so the last explicitly-picked country is the
 * fallback; anything that does infer — including an explicit "+"/"00"
 * value — wins over it. Empty input still gets the SG default via
 * inferPhoneCountry, so `persisted` only matters for typed values.
 */
export function resolvePhoneCountry(
  text: string,
  persisted: PhoneCountryChoice | null,
): PhoneCountryChoice {
  const input = text.trim();
  if (input.startsWith("+") || /^00\d/.test(input)) {
    // A successfully parsed explicit international number owns its country —
    // including "none": shared and non-geographic codes (+1, +800) report
    // country undefined, which must surface as "other" rather than silently
    // adopting the persisted pick.
    const explicit = parsePhone(input, "");
    if (explicit) return explicit.country ?? "";
  }
  return inferPhoneCountry(text) || persisted || "";
}

/**
 * Selector state while the user types. Only text carrying an explicit
 * "+"/"00" international prefix re-infers its country (and may therefore
 * change the selection); anything else holds the current effective country.
 * Without this, the SG default is lost on the very first typed digit —
 * "9" infers no country — and a deliberate MY pick collapses to "other"
 * through every incomplete intermediate value.
 */
export function typingPhoneCountry(
  nextText: string,
  current: PhoneCountryChoice,
  persisted: PhoneCountryChoice,
): PhoneCountryChoice {
  return /^\s*(\+|00\d)/.test(nextText)
    ? resolvePhoneCountry(nextText, persisted)
    : current;
}

/** Whether `code` is a dialling country the selector actually offers. */
const PHONE_COUNTRY_CODE_SET = new Set<string>(getCountries());
export function isPhoneCountryCode(code: string): code is CountryCode {
  return PHONE_COUNTRY_CODE_SET.has(code);
}

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  callingCode: string;
};

/** Every dialling country, labelled "name (+code)" and sorted by name. */
export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = getCountries()
  .map((code) => ({
    code,
    name: PHONE_COUNTRY_NAMES[code] ?? code,
    callingCode: `+${getCountryCallingCode(code)}`,
  }))
  // Codepoint comparison of the frozen labels — localeCompare output is
  // collation-dependent and could reorder options between server and client.
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
