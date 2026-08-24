import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALENDAR_TIMEOUT_MS, withTimeout } from "./timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a resolved value straight through", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "test")).resolves.toBe(
      "ok",
    );
  });

  it("passes a rejection straight through", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "test"),
    ).rejects.toThrow("boom");
  });

  it("rejects when the promise never settles", async () => {
    const hanging = withTimeout(new Promise<never>(() => {}), 1000, "POST");
    const assertion = expect(hanging).rejects.toThrow(
      "Google Calendar POST timed out after 1000ms",
    );

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not fire once the promise has resolved", async () => {
    // The timer must be cleared on the happy path. Left pending it would
    // reject an already-settled race — harmless — but also keep the Node event
    // loop alive for the full timeout after every successful sync.
    await withTimeout(Promise.resolve("ok"), 1000, "test");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives a Google round-trip ten seconds", () => {
    // Pinned because a booking is committed before this runs: raising it to
    // where a consultant gives up on the spinner would strand the appointment
    // in 'pending' with no visible retry.
    expect(CALENDAR_TIMEOUT_MS).toBe(10_000);
  });
});
