"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";

import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRY_OPTIONS,
  canonicalizePhone,
  isPhoneCountryCode,
  parsePhone,
  resolvePhoneCountry,
  typingPhoneCountry,
  type PhoneCountryChoice,
} from "@/lib/phone";

export const PHONE_INPUT_BASE_CLASS =
  "w-full min-w-0 min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

type Props = {
  /**
   * Submitted field name for plain <form>/FormData surfaces. When set, a
   * hidden input carries the effective value (canonical when parseable, raw
   * otherwise) so the visible input's typed text is never submitted directly.
   */
  name?: string;
  /** id for the visible input — the field's label points here. */
  id?: string;
  /** Controlled submitted value; omit for uncontrolled (FormData) use. */
  value?: string;
  /** Initial raw value for uncontrolled use. */
  defaultValue?: string;
  /**
   * Reports the effective value on every change: canonical E.164 when the
   * text parses under the selected country (or carries its own +/00 prefix),
   * the raw text otherwise.
   */
  onChange?: (submitted: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  /**
   * Field's human label ("Mobile"). Names both controls when no enclosing
   * <label htmlFor> association exists: the input gets it verbatim, the
   * selector "<label> country".
   */
  label?: string;
  /**
   * sessionStorage key for the selected country only. An incomplete national
   * number can't re-infer its country after a draft restore/remount, so the
   * selection is remembered here; a completed number always re-infers from
   * the value itself. Never sent to the server.
   */
  persistKey?: string;
  inputClassName?: string;
  selectClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
};

/**
 * Country selector + phone input, one labelled group. The selector picks how
 * a bare national number is read; an explicit "+"/"00" prefix always wins so
 * a pasted international number is never double-prefixed. The component's
 * value contract is a single string: the canonical E.164 form when the text
 * parses, the untouched raw text when it does not — so legacy free-text
 * values still save on relaxed (lead/draft) paths and strict order
 * validation can name the problem itself.
 *
 * Mount never rewrites an existing value: unparseable legacy text shows the
 * "Other country" state and stays verbatim until the user edits it.
 */
export function PhoneInput({
  name,
  id,
  value,
  defaultValue,
  onChange,
  onBlur,
  disabled,
  required,
  placeholder,
  autoComplete,
  label,
  persistKey,
  inputClassName,
  selectClassName,
  inputRef,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
  "aria-required": ariaRequired,
}: Props) {
  const isControlled = value !== undefined;
  const [text, setText] = useState(() => value ?? defaultValue ?? "");
  // The last submitted value seen or emitted. When a controlled `value`
  // arrives that differs, it came from outside — an RHF reset, a restored
  // draft, a fresh customer — so the display and inferred country resync.
  const [lastSubmitted, setLastSubmitted] = useState(() => value ?? defaultValue ?? "");
  // An explicit pick this mount (or a blur-confirmed attribution). null =
  // derive from the value plus whatever country persisted under persistKey.
  const [chosen, setChosen] = useState<PhoneCountryChoice | null>(null);

  // The remembered country under persistKey. useSyncExternalStore is the
  // supported path for browser-only state: the server snapshot is "" so
  // hydration markup matches, and React re-reads the store after mount and
  // on every render — including after the form draft lifecycle clears the
  // key on save / cancel / customer change. sessionStorage emits no
  // same-tab change events, so there is nothing to subscribe to.
  const persisted = useSyncExternalStore(
    useCallback(() => () => {}, []),
    useCallback((): PhoneCountryChoice => {
      if (!persistKey) return "";
      try {
        const stored = sessionStorage.getItem(persistKey);
        return stored && isPhoneCountryCode(stored) ? stored : "";
      } catch {
        return "";
      }
    }, [persistKey]),
    (): PhoneCountryChoice => "",
  );

  const country = chosen ?? resolvePhoneCountry(text, persisted);

  if (isControlled && value !== lastSubmitted) {
    setLastSubmitted(value);
    setText(value);
    setChosen(null);
  }

  const submitted = canonicalizePhone(text, country) ?? text;

  function emit(nextText: string, nextCountry: PhoneCountryChoice) {
    const next = canonicalizePhone(nextText, nextCountry) ?? nextText;
    // Only report real value changes — picking a country while the field is
    // empty or unparseable must not dirty the surrounding form.
    if (next !== lastSubmitted) {
      setLastSubmitted(next);
      onChange?.(next);
    }
  }

  function persist(next: PhoneCountryChoice) {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, next);
    } catch {
      /* storage unavailable — selection lives in memory only */
    }
  }

  function selectCountry(next: PhoneCountryChoice) {
    setChosen(next);
    persist(next);
    emit(text, next);
  }

  function handleBlur() {
    // Tidy the display once the user finishes: a parseable number shows its
    // canonical form and the selector reflects the country it actually had —
    // or "Other" when the calling code cannot be attributed (+1, +800).
    const parsed = parsePhone(text, country);
    if (parsed) {
      if (parsed.canonical !== text) setText(parsed.canonical);
      const inferred = parsed.country ?? "";
      if (inferred !== country) {
        setChosen(inferred);
        persist(inferred);
      }
    }
    onBlur?.();
  }

  const inputCls = inputClassName ?? PHONE_INPUT_BASE_CLASS;
  const selectCls = selectClassName ?? PHONE_INPUT_BASE_CLASS;
  const selectId = id ? `${id}-country` : undefined;
  const accessibleName = ariaLabel ?? label;

  return (
    // flex-wrap: the pair sits side by side when there is room and stacks to
    // full-width rows in narrow columns, so nothing clips at 375px.
    <div className="flex flex-wrap gap-2">
      <select
        id={selectId}
        value={country}
        disabled={disabled}
        aria-label={`${accessibleName ?? "Phone number"} country`}
        onChange={(event) => selectCountry(event.target.value as PhoneCountryChoice)}
        className={`${selectCls} min-h-11 flex-[1_1_10rem]`}
      >
        <option value="">Other country (+…)</option>
        {/* Singapore is the default and by far the common case — pin it on
            top, then the rest alphabetically. */}
        {PHONE_COUNTRY_OPTIONS.filter((option) => option.code === DEFAULT_PHONE_COUNTRY).map((option) => (
          <option key={option.code} value={option.code}>
            {option.name} ({option.callingCode})
          </option>
        ))}
        {PHONE_COUNTRY_OPTIONS.filter((option) => option.code !== DEFAULT_PHONE_COUNTRY).map((option) => (
          <option key={option.code} value={option.code}>
            {option.name} ({option.callingCode})
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        id={id}
        type="tel"
        value={text}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => {
          const nextText = event.target.value;
          // Hold the current selection through partial national input so the
          // SG default survives "9" -> "91234567"; only an explicit "+"/"00"
          // prefix re-infers. Locking into `chosen` also keeps a deliberate
          // pick stable until an external value resets it.
          const nextCountry = typingPhoneCountry(nextText, country, persisted);
          setText(nextText);
          setChosen(nextCountry);
          // Keep the remembered country in step while typing: a partial
          // national draft ("9") can't re-infer SG after a reload, so without
          // this the restored snapshot falls back to "other" — and a stale
          // persisted MY must not survive fresh SG typing.
          if (nextCountry !== persisted) persist(nextCountry);
          emit(nextText, nextCountry);
        }}
        onBlur={handleBlur}
        aria-label={accessibleName}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedby}
        aria-required={ariaRequired || undefined}
        className={`${inputCls} min-h-11 flex-[999_1_8rem]`}
      />
      {name !== undefined && (
        <input type="hidden" name={name} value={submitted} readOnly />
      )}
    </div>
  );
}
