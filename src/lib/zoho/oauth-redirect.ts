const CRM_ORIGINS = new Set([
  "http://localhost:3001",
  "https://app.drapeworks.sg",
]);
const CALLBACK_PATH = "/api/integrations/zoho/callback";

export function resolveZohoRedirectUri(origin: string): string {
  const configured = process.env.ZOHO_OAUTH_REDIRECT_URI?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!CRM_ORIGINS.has(url.origin) || url.pathname !== CALLBACK_PATH || url.search || url.hash) {
      throw new Error("ZOHO_OAUTH_REDIRECT_URI is not an authorized Zoho callback URL");
    }
    return url.toString();
  }

  const requestOrigin = new URL(origin).origin;
  if (!CRM_ORIGINS.has(requestOrigin)) throw new Error("This CRM origin is not authorized for Zoho OAuth");
  return `${requestOrigin}${CALLBACK_PATH}`;
}
