import { afterEach, describe, expect, it, vi } from "vitest";

import { actionErrorMessage, UserFacingError } from "./user-facing-error";

afterEach(() => vi.restoreAllMocks());

describe("actionErrorMessage", () => {
  it("returns the deliberate message for a UserFacingError without logging", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = actionErrorMessage(
      new UserFacingError("The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice"),
      "fallback",
    );
    expect(message).toBe("The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice");
    expect(log).not.toHaveBeenCalled();
  });

  it("returns the fallback and logs an unexpected Error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = new Error("duplicate key value violates unique constraint \"orders_pkey\"");
    expect(actionErrorMessage(secret, "The order status could not be updated. Refresh and try again."))
      .toBe("The order status could not be updated. Refresh and try again.");
    expect(log).toHaveBeenCalledWith(secret);
  });

  it("returns the fallback for non-Error rejections", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(actionErrorMessage("socket hang up", "fallback")).toBe("fallback");
    expect(actionErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
