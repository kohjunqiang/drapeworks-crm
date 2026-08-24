/**
 * Mints the Google Calendar refresh token, once, by hand.
 *
 *   npm run calendar:consent
 *
 * Run it again whenever the token stops working — consent revoked, secret
 * rotated, or the app moved to a different Google account. Nothing else in the
 * codebase calls this; it exists so the token in `.env` has a reproducible
 * origin rather than being a value someone pasted from a browser once.
 *
 * Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET already set.
 * Prints the refresh token to stdout — nothing is written to disk, because the
 * only sensible destination differs per environment (.env locally, Railway
 * service variables in production).
 */
import { createServer } from "node:http";

import { OAuth2Client } from "google-auth-library";

// Loopback, not the long-dead urn:ietf:wg:oauth:2.0:oob flow Google turned off
// in 2022. A "Desktop app" OAuth client accepts any http://127.0.0.1 port
// without registering it; a "Web application" client does NOT, and will reject
// this with redirect_uri_mismatch. Create a Desktop app client.
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first",
    );
  }

  const oauth = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  });

  const url = oauth.generateAuthUrl({
    // Without offline the response carries an access token only, and there is
    // nothing durable to put in .env.
    access_type: "offline",
    // Google returns a refresh token only on the FIRST consent for a given
    // client/account pair. Without this, a second run of this script silently
    // returns no refresh_token and looks broken.
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\nOpen this URL, sign in as the calendar's owner, and approve:\n");
  console.log(url);
  console.log("\nWaiting for the redirect…\n");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", REDIRECT_URI);
      const received = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        received
          ? "Authorised. Close this tab and return to the terminal."
          : `Authorisation failed: ${error ?? "no code returned"}`,
      );
      server.close();

      if (received) resolve(received);
      else reject(new Error(error ?? "No authorisation code in the redirect"));
    });

    server.on("error", reject);
    server.listen(PORT);
  });

  const { tokens } = await oauth.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token. This happens when the account has " +
        "already granted consent to this client — revoke it at " +
        "https://myaccount.google.com/permissions and run this again.",
    );
  }

  console.log("Add this to .env (and to Railway's service variables):\n");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
