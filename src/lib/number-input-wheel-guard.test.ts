import { describe, expect, it, vi } from "vitest";

import { installNumberInputWheelGuard } from "./number-input-wheel-guard";

type Listener = {
  type: string;
  fn: (event: { target: unknown }) => void;
  options: unknown;
};

function fakeDoc() {
  const listeners: Listener[] = [];
  const doc = {
    activeElement: null as unknown,
    addEventListener: vi.fn(
      (type: string, fn: Listener["fn"], options: unknown) =>
        listeners.push({ type, fn, options }),
    ),
    removeEventListener: vi.fn((type: string, fn: Listener["fn"]) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    }),
  };
  return {
    doc: doc as unknown as Document,
    listeners,
    setActive(el: unknown) {
      doc.activeElement = el;
    },
    wheel(target: unknown) {
      for (const l of [...listeners]) {
        if (l.type === "wheel") l.fn({ target });
      }
    },
  };
}

function fakeInput(type: string) {
  return { tagName: "INPUT", type, blur: vi.fn() };
}

describe("installNumberInputWheelGuard", () => {
  it("blurs a focused number input on wheel, before the browser can step it", () => {
    const { doc, setActive, wheel } = fakeDoc();
    const input = fakeInput("number");
    setActive(input);

    installNumberInputWheelGuard(doc);
    wheel(input);

    expect(input.blur).toHaveBeenCalledTimes(1);
  });

  it("registers one passive capture-phase listener on document", () => {
    const { doc, listeners } = fakeDoc();

    installNumberInputWheelGuard(doc);

    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe("wheel");
    // passive: preventDefault is never called, so page/dialog scrolling —
    // including wheel over a non-input element — is completely unaffected.
    expect(listeners[0].options).toMatchObject({
      capture: true,
      passive: true,
    });
  });

  it("leaves a wheel over a focused text input alone", () => {
    const { doc, setActive, wheel } = fakeDoc();
    const input = fakeInput("text");
    setActive(input);

    installNumberInputWheelGuard(doc);
    wheel(input);

    expect(input.blur).not.toHaveBeenCalled();
  });

  it("ignores number inputs that are not focused — wheel over them only scrolls", () => {
    const { doc, setActive, wheel } = fakeDoc();
    const input = fakeInput("number");
    setActive(fakeInput("text"));

    installNumberInputWheelGuard(doc);
    wheel(input);

    expect(input.blur).not.toHaveBeenCalled();
  });

  it("covers inputs added to the DOM after install (dynamic rows, dialog portals)", () => {
    const { doc, setActive, wheel } = fakeDoc();

    installNumberInputWheelGuard(doc);

    const late = fakeInput("number");
    setActive(late);
    wheel(late);

    expect(late.blur).toHaveBeenCalledTimes(1);
  });

  it("cleanup removes the listener so remounts never stack duplicates", () => {
    const { doc, listeners, setActive, wheel } = fakeDoc();
    const input = fakeInput("number");
    setActive(input);

    const cleanup = installNumberInputWheelGuard(doc);
    cleanup();

    expect(listeners).toHaveLength(0);
    wheel(input);
    expect(input.blur).not.toHaveBeenCalled();

    // StrictMode-style remount: exactly one active listener again.
    installNumberInputWheelGuard(doc);
    expect(listeners).toHaveLength(1);
  });
});
