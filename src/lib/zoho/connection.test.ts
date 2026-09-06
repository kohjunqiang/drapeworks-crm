import { afterEach, describe, expect, it } from "vitest";

import { resolveZohoAppOrigin, resolveZohoRedirectUri } from "./oauth-redirect";

const originalRedirectUri = process.env.ZOHO_OAUTH_REDIRECT_URI;

afterEach(() => {
  if (originalRedirectUri === undefined) delete process.env.ZOHO_OAUTH_REDIRECT_URI;
  else process.env.ZOHO_OAUTH_REDIRECT_URI = originalRedirectUri;
});

describe("resolveZohoRedirectUri", () => {
  it("uses the approved configured callback behind a reverse proxy", () => {
    process.env.ZOHO_OAUTH_REDIRECT_URI = "https://app.drapeworks.sg/api/integrations/zoho/callback";

    expect(resolveZohoRedirectUri("http://drapeworks-crm.railway.internal"))
      .toBe("https://app.drapeworks.sg/api/integrations/zoho/callback");
    expect(resolveZohoAppOrigin("https://0.0.0.0:8080"))
      .toBe("https://app.drapeworks.sg");
  });

  it("rejects a configured callback outside the approved CRM origins", () => {
    process.env.ZOHO_OAUTH_REDIRECT_URI = "https://example.com/api/integrations/zoho/callback";

    expect(() => resolveZohoRedirectUri("https://app.drapeworks.sg"))
      .toThrow("ZOHO_OAUTH_REDIRECT_URI is not an authorized Zoho callback URL");
  });

  it("derives the callback from an approved request origin when none is configured", () => {
    delete process.env.ZOHO_OAUTH_REDIRECT_URI;

    expect(resolveZohoRedirectUri("http://localhost:3001"))
      .toBe("http://localhost:3001/api/integrations/zoho/callback");
  });

  it("rejects an unapproved request origin when no callback is configured", () => {
    delete process.env.ZOHO_OAUTH_REDIRECT_URI;

    expect(() => resolveZohoRedirectUri("http://drapeworks-crm.railway.internal"))
      .toThrow("This CRM origin is not authorized for Zoho OAuth");
  });
});
