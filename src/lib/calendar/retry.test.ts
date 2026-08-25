import { describe, expect, it } from "vitest";

import {
  backoffMs,
  CALENDAR_BUDGET_MS,
  isRetryable,
  MAX_ATTEMPTS,
  nextDelayMs,
  retryAfterMs,
} from "./retry";

const RATE_LIMITED = JSON.stringify({
  error: {
    code: 403,
    errors: [{ reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }],
  },
});

const BAD_SCOPES = JSON.stringify({
  error: {
    code: 403,
    status: "PERMISSION_DENIED",
    message: "Request had insufficient authentication scopes.",
  },
});

describe("isRetryable", () => {
  it("retries 429", () => {
    expect(isRetryable(429, "")).toBe(true);
  });

  it("retries 5xx", () => {
    expect(isRetryable(500, "")).toBe(true);
    expect(isRetryable(503, "")).toBe(true);
  });

  it("retries a 403 that is a rate limit", () => {
    expect(isRetryable(403, RATE_LIMITED)).toBe(true);
  });

  it("does NOT retry a 403 that is a permission failure", () => {
    // The exact body seen when the OAuth grant lacks calendar.events. Retrying
    // it burns the consultant's request and never succeeds.
    expect(isRetryable(403, BAD_SCOPES)).toBe(false);
  });

  it("matches the reason whatever the casing", () => {
    expect(isRetryable(403, '{"reason":"USERRATELIMITEXCEEDED"}')).toBe(true);
  });

  it("does not retry permanent client errors", () => {
    for (const status of [400, 401, 404, 409, 410, 412]) {
      expect(isRetryable(status, "")).toBe(false);
    }
  });
});

describe("retryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(" 30 ")).toBe(30000);
  });

  it("returns null for absent or unusable values", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs("")).toBeNull();
    expect(retryAfterMs("-1")).toBeNull();
    // The HTTP-date form is legal but deliberately not honoured.
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });
});

describe("backoffMs", () => {
  it("doubles per attempt", () => {
    const noJitter = () => 0;
    expect(backoffMs(0, noJitter)).toBe(500);
    expect(backoffMs(1, noJitter)).toBe(1000);
    expect(backoffMs(2, noJitter)).toBe(2000);
  });

  it("adds jitter within one base interval", () => {
    expect(backoffMs(0, () => 0.999)).toBe(999);
    expect(backoffMs(1, () => 0.5)).toBe(1250);
  });
});

describe("nextDelayMs", () => {
  const noJitter = () => 0;

  it("gives up once attempts are exhausted", () => {
    expect(nextDelayMs(MAX_ATTEMPTS - 1, 60_000, null, noJitter)).toBeNull();
  });

  it("backs off while attempts remain", () => {
    expect(nextDelayMs(0, 60_000, null, noJitter)).toBe(500);
    expect(nextDelayMs(1, 60_000, null, noJitter)).toBe(1000);
  });

  it("prefers Retry-After over the computed backoff", () => {
    expect(nextDelayMs(0, 60_000, "5", noJitter)).toBe(5000);
  });

  it("gives up rather than sleeping past the budget", () => {
    // Waiting out the remaining time only to fail teaches the operator the
    // same thing, later.
    expect(nextDelayMs(0, 400, null, noJitter)).toBeNull();
    expect(nextDelayMs(0, 60_000, "3600", noJitter)).toBeNull();
  });

  it("keeps the whole sync inside a human's patience", () => {
    // Three attempts at the 10s per-request timeout plus backoff must not be
    // able to outlast this; the budget is what stops retries reintroducing the
    // hang that per-request timeouts were added to prevent.
    expect(CALENDAR_BUDGET_MS).toBe(25_000);
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
