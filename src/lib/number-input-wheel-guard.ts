// Native `input[type=number]` steps its value on wheel while focused, which is
// how a consultant scrolling a long consultation form silently edits Height cm.
// The fix is to blur the input before the browser's default step action runs:
// the wheel event still dispatches normally (the listener is passive and never
// calls preventDefault), so page and dialog scrolling are untouched.
//
// The listener lives on `document` in the capture phase, so it covers every
// number input — raw `type="number"` fields, the shared <Input>, rows added
// later, and inputs inside React portals (dialogs) — with no per-field wiring,
// and it cannot be swallowed by a component calling stopPropagation.

function isNumberInput(el: unknown): el is HTMLInputElement {
  return (
    typeof el === "object" &&
    el !== null &&
    (el as HTMLInputElement).tagName === "INPUT" &&
    (el as HTMLInputElement).type === "number" &&
    typeof (el as HTMLInputElement).blur === "function"
  );
}

// Structural check (tagName/type rather than instanceof) keeps the module
// importable in node tests, where HTMLInputElement does not exist.
export function installNumberInputWheelGuard(doc: Document): () => void {
  const onWheel = (event: Event) => {
    const target = event.target;
    if (isNumberInput(target) && target === doc.activeElement) {
      target.blur();
    }
  };
  doc.addEventListener("wheel", onWheel, { capture: true, passive: true });
  return () => doc.removeEventListener("wheel", onWheel, { capture: true });
}
