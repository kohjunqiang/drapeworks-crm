import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Selectable } from "kysely";

import type { Json, ZohoPendingConnections } from "@/lib/db/schema";
import { db } from "@/lib/db/kysely";

import { decryptZohoToken, encryptZohoToken } from "./crypto";
import { resolveZohoRedirectUri } from "./oauth-redirect";

export const ZOHO_BOOKS_SCOPES = [
  "ZohoBooks.settings.READ",
  "ZohoBooks.contacts.READ",
  "ZohoBooks.contacts.CREATE",
  "ZohoBooks.estimates.READ",
  "ZohoBooks.estimates.CREATE",
  "ZohoBooks.estimates.UPDATE",
  "ZohoBooks.invoices.READ",
  "ZohoBooks.invoices.CREATE",
] as const;

const ACCOUNTS_TO_API = new Map([
  ["https://accounts.zoho.com", "https://www.zohoapis.com"],
  ["https://accounts.zoho.eu", "https://www.zohoapis.eu"],
  ["https://accounts.zoho.in", "https://www.zohoapis.in"],
  ["https://accounts.zoho.com.au", "https://www.zohoapis.com.au"],
  ["https://accounts.zoho.jp", "https://www.zohoapis.jp"],
  ["https://accounts.zohocloud.ca", "https://www.zohoapis.ca"],
  ["https://accounts.zoho.sa", "https://www.zohoapis.sa"],
]);
const API_DOMAINS = new Set(ACCOUNTS_TO_API.values());
const LIFECYCLE_LOCK = "drapeworks-zoho-connection";

type ZohoOrganization = {
  organization_id: string;
  name: string;
  currency_code?: string;
  country_code?: string;
  is_default_org?: boolean;
};

type Capabilities = {
  organizationsRead: boolean;
  contactsRead: boolean;
  estimatesRead: boolean;
  invoicesRead: boolean;
  crmKeyFieldVerified: boolean;
  crmKeyUnique: boolean;
  templateVerified: boolean;
};

function environment(): string {
  return process.env.ZOHO_CONNECTION_ENV?.trim() || process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || "development";
}

function aad(env = environment()): string {
  return `drapeworks:zoho-books:v1:${env}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

function configuredAccountsServer(): string {
  const value = exactOrigin(process.env.ZOHO_ACCOUNTS_BASE_URL ?? "https://accounts.zoho.com");
  if (!ACCOUNTS_TO_API.has(value)) throw new Error("ZOHO_ACCOUNTS_BASE_URL is not an allowed Zoho data centre");
  return value;
}

function allowedAccountsServer(value: string): string {
  const origin = exactOrigin(value);
  if (!ACCOUNTS_TO_API.has(origin)) throw new Error("Zoho returned an unsupported accounts data centre");
  return origin;
}

function allowedApiDomain(value: string): string {
  const origin = exactOrigin(value);
  if (!API_DOMAINS.has(origin)) throw new Error("Zoho returned an unsupported API data centre");
  return origin;
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

async function audit(eventType: string, actorId: string | null, details: Record<string, Json> = {}) {
  await db.insertInto("zoho_connection_events").values({
    id: randomUUID(), environment: environment(), event_type: eventType, actor_id: actorId, details,
  }).execute();
}

async function safeAudit(eventType: string, actorId: string | null, details: Record<string, Json> = {}) {
  try { await audit(eventType, actorId, details); }
  catch { console.error("Zoho connection audit write failed"); }
}

async function zohoJson<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json() as T & { code?: number; message?: string };
  if (!response.ok || (typeof json.code === "number" && json.code !== 0)) {
    throw new Error(json.message || `Zoho request failed (${response.status})`);
  }
  return json;
}

async function getOrganizations(apiDomain: string, accessToken: string): Promise<ZohoOrganization[]> {
  const json = await zohoJson<{ organizations?: ZohoOrganization[] }>(new URL(`${apiDomain}/books/v3/organizations`), accessToken);
  return json.organizations ?? [];
}

async function probeCapabilities(apiDomain: string, accessToken: string, organizationId: string): Promise<Capabilities> {
  const probe = async (path: string) => {
    const url = new URL(`${apiDomain}/books/v3${path}`);
    url.searchParams.set("organization_id", organizationId);
    url.searchParams.set("per_page", "1");
    try { await zohoJson(url, accessToken); return true; } catch { return false; }
  };
  const [contactsRead, estimatesRead, invoicesRead] = await Promise.all([
    probe("/contacts"), probe("/estimates"), probe("/invoices"),
  ]);
  let crmKeyFieldVerified = false;
  let crmKeyUnique = false;
  let templateVerified = false;
  try {
    const fieldId = required("ZOHO_ESTIMATE_CRM_KEY_ID");
    const apiName = required("ZOHO_ESTIMATE_CRM_KEY_API_NAME");
    const fieldsUrl = new URL(`${apiDomain}/books/v3/settings/fields`);
    fieldsUrl.searchParams.set("organization_id", organizationId);
    fieldsUrl.searchParams.set("entity", "estimate");
    fieldsUrl.searchParams.set("filter_custom_fields", "true");
    fieldsUrl.searchParams.set("field_ids", fieldId);
    const fields = await zohoJson<{ fields?: Array<Record<string, unknown>>; custom_fields?: Array<Record<string, unknown>> }>(fieldsUrl, accessToken);
    const field = [...(fields.fields ?? []), ...(fields.custom_fields ?? [])].find((candidate) =>
      String(candidate.field_id ?? candidate.customfield_id ?? "") === fieldId && candidate.api_name === apiName);
    crmKeyFieldVerified = Boolean(field && field.is_active !== false && ["string", "text"].includes(String(field.data_type ?? "string")));
    crmKeyUnique = Boolean(field?.is_unique || field?.is_unique_field || field?.is_duplicate_allowed === false);

    const templateId = required("ZOHO_ESTIMATE_TEMPLATE_ID");
    const templatesUrl = new URL(`${apiDomain}/books/v3/estimates/templates`);
    templatesUrl.searchParams.set("organization_id", organizationId);
    const templates = await zohoJson<{ templates?: Array<{ template_id?: string | number }> }>(templatesUrl, accessToken);
    templateVerified = Boolean(templates.templates?.some((template) => String(template.template_id) === templateId));
  } catch {
    // Missing or inaccessible organization-specific configuration keeps the
    // connection partial and financial actions disabled.
  }
  return { organizationsRead: true, contactsRead, estimatesRead, invoicesRead, crmKeyFieldVerified, crmKeyUnique, templateVerified };
}

async function revokeRefreshToken(accountsServer: string, refreshToken: string): Promise<boolean> {
  const response = await fetch(`${accountsServer}/oauth/v2/token/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

async function tryRevokeRefreshToken(accountsServer: string, refreshToken: string): Promise<boolean> {
  try { return await revokeRefreshToken(accountsServer, refreshToken); }
  catch { return false; }
}

async function activateConnection(input: {
  actorId: string;
  accountsServer: string;
  apiDomain: string;
  organization: ZohoOrganization;
  capabilities: Capabilities;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  pendingId?: string;
}): Promise<"connected" | "partial"> {
  const env = environment();
  const status: "connected" | "partial" = input.capabilities.contactsRead && input.capabilities.estimatesRead && input.capabilities.invoicesRead && input.capabilities.crmKeyFieldVerified && input.capabilities.templateVerified
    ? "connected" : "partial";
  const refresh = encryptZohoToken(input.refreshToken, aad(env));
  const access = encryptZohoToken(input.accessToken, aad(env));
  const values = {
    status, accounts_server: input.accountsServer, api_domain: input.apiDomain,
    organization_id: input.organization.organization_id, organization_name: input.organization.name,
    currency_code: input.organization.currency_code ?? null, country_code: input.organization.country_code ?? null,
    candidate_organizations: JSON.stringify([]) as unknown as Json, requested_scopes: [...ZOHO_BOOKS_SCOPES] as string[],
    verified_capabilities: input.capabilities as unknown as Json,
    refresh_token_ciphertext: refresh.ciphertext, refresh_token_nonce: refresh.nonce, refresh_token_tag: refresh.tag,
    access_token_ciphertext: access.ciphertext, access_token_nonce: access.nonce, access_token_tag: access.tag,
    access_token_expires_at: new Date(Date.now() + input.expiresIn * 1000), key_version: 1,
    estimate_crm_key_api_name: input.capabilities.crmKeyFieldVerified ? required("ZOHO_ESTIMATE_CRM_KEY_API_NAME") : null,
    estimate_crm_key_id: input.capabilities.crmKeyFieldVerified ? required("ZOHO_ESTIMATE_CRM_KEY_ID") : null,
    estimate_template_id: input.capabilities.templateVerified ? required("ZOHO_ESTIMATE_TEMPLATE_ID") : null,
    connected_by: input.actorId, connected_at: new Date(), last_verified_at: new Date(),
    last_error: status === "partial" ? "Required Zoho permissions, CRM Quote Key field, or quotation template could not be verified" : null,
  };
  const replaced = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
    if (input.pendingId) {
      const pending = await trx.selectFrom("zoho_pending_connections").select("id")
        .where("id", "=", input.pendingId).where("environment", "=", env)
        .where("status", "=", "claimed").where("expires_at", ">", new Date()).forUpdate().executeTakeFirst();
      if (!pending) throw new Error("The pending Zoho organization selection expired or was cancelled");
    }
    const previous = await trx.selectFrom("zoho_connections").selectAll().where("environment", "=", env).forUpdate().executeTakeFirst();
    if (previous?.status === "disconnecting") throw new Error("Zoho Books is currently disconnecting; start a fresh connection afterward");
    const otherEnvironment = await trx.selectFrom("zoho_connections").select("organization_id")
      .where("environment", "!=", env).where("status", "in", ["connected", "partial", "reconnect_required"])
      .where("organization_id", "is not", null).executeTakeFirst();
    if (otherEnvironment?.organization_id && otherEnvironment.organization_id !== input.organization.organization_id) {
      throw new Error("All CRM environments must use the same Zoho Books organization because customer and quotation links are shared");
    }
    const historicalOtherEnvironment = await trx.selectFrom("zoho_connections").select("organization_id")
      .where("environment", "!=", env).where("organization_id", "is not", null).executeTakeFirst();
    const changesBoundOrganization = (previous?.organization_id && previous.organization_id !== input.organization.organization_id)
      || (historicalOtherEnvironment?.organization_id && historicalOtherEnvironment.organization_id !== input.organization.organization_id);
    if (changesBoundOrganization) {
      await sql`lock table public.customer_zoho_links, public.order_quotations in share mode`.execute(trx);
      const [links, estimates, invoices] = await Promise.all([
        trx.selectFrom("customer_zoho_links").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
        trx.selectFrom("order_quotations").select(({ fn }) => fn.count<string>("zoho_estimate_id").as("count")).executeTakeFirstOrThrow(),
        trx.selectFrom("order_quotations").select(({ fn }) => fn.count<string>("zoho_invoice_id").as("count")).executeTakeFirstOrThrow(),
      ]);
      if ([links, estimates, invoices].some((result) => Number(result.count) > 0)) {
        throw new Error("Switching Zoho organizations is blocked while linked records exist");
      }
    }
    await trx.insertInto("zoho_connections").values({ id: randomUUID(), environment: env, token_version: 1, ...values })
      .onConflict((conflict) => conflict.column("environment").doUpdateSet({ ...values, token_version: (eb) => eb("zoho_connections.token_version", "+", 1) }))
      .execute();
    const abandoned = await trx.deleteFrom("zoho_pending_connections").where("environment", "=", env).returningAll().execute();
    return { previous, abandoned };
  });
  await safeAudit("oauth_connected", input.actorId, { status, organization_id: input.organization.organization_id, api_domain: input.apiDomain });

  if (replaced.previous?.refresh_token_ciphertext && replaced.previous.refresh_token_nonce && replaced.previous.refresh_token_tag) {
    try {
      const oldRefresh = decryptZohoToken({
        ciphertext: replaced.previous.refresh_token_ciphertext, nonce: replaced.previous.refresh_token_nonce, tag: replaced.previous.refresh_token_tag,
      }, aad(env));
      if (oldRefresh !== input.refreshToken) {
        const revoked = await revokeRefreshToken(replaced.previous.accounts_server, oldRefresh);
        await safeAudit(revoked ? "previous_authorization_revoked" : "previous_authorization_revoke_failed", input.actorId, {
          organization_id: replaced.previous.organization_id,
        });
      }
    } catch {
      await safeAudit("previous_authorization_revoke_failed", input.actorId, { organization_id: replaced.previous.organization_id });
    }
  }
  for (const pending of replaced.abandoned) {
    if (pending.id === input.pendingId) continue;
    try {
      const token = decryptZohoToken({ ciphertext: pending.refresh_token_ciphertext, nonce: pending.refresh_token_nonce, tag: pending.refresh_token_tag }, aad(env));
      await revokeRefreshToken(pending.accounts_server, token);
    } catch {
      await safeAudit("superseded_pending_authorization_revoke_failed", pending.initiated_by);
    }
  }
  return status;
}

export function isZohoOAuthAppConfigured(): boolean {
  return process.env.ZOHO_OAUTH_CLIENT_KIND === "server" && ["ZOHO_OAUTH_CLIENT_ID", "ZOHO_OAUTH_CLIENT_SECRET", "ZOHO_TOKEN_ENCRYPTION_KEY", "ZOHO_ESTIMATE_CRM_KEY_API_NAME", "ZOHO_ESTIMATE_CRM_KEY_ID", "ZOHO_ESTIMATE_TEMPLATE_ID"]
    .every((name) => Boolean(process.env[name]?.trim()));
}

export async function createZohoAuthorizationUrl(adminId: string, origin: string): Promise<string> {
  if (!isZohoOAuthAppConfigured()) throw new Error("The Zoho Server-based Application is not configured");
  const state = randomBytes(32).toString("base64url");
  const accountsServer = configuredAccountsServer();
  await db.deleteFrom("zoho_oauth_states").where("expires_at", "<", new Date(Date.now() - 86_400_000)).execute();
  await db.insertInto("zoho_oauth_states").values({
    state_hash: hashState(state), environment: environment(), accounts_server: accountsServer,
    initiated_by: adminId, return_path: "/admin/integrations/zoho", expires_at: new Date(Date.now() + 5 * 60_000), used_at: null,
  }).execute();
  const url = new URL(`${accountsServer}/oauth/v2/auth`);
  url.searchParams.set("scope", ZOHO_BOOKS_SCOPES.join(","));
  url.searchParams.set("client_id", required("ZOHO_OAUTH_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", resolveZohoRedirectUri(origin));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeZohoAuthorization(input: {
  adminId: string;
  state: string;
  code: string;
  accountsServer?: string | null;
  origin: string;
}): Promise<"connected" | "partial" | "pending_organization"> {
  const env = environment();
  const consumed = await db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom("zoho_oauth_states").selectAll()
      .where("state_hash", "=", hashState(input.state)).where("environment", "=", env)
      .where("initiated_by", "=", input.adminId).where("used_at", "is", null)
      .where("expires_at", ">", new Date()).forUpdate().executeTakeFirst();
    if (!row) throw new Error("The Zoho connection request expired or was already used");
    await trx.updateTable("zoho_oauth_states").set({ used_at: new Date() }).where("state_hash", "=", row.state_hash).execute();
    return row;
  });
  const accountsServer = input.accountsServer ? allowedAccountsServer(input.accountsServer) : consumed.accounts_server;
  if (accountsServer !== consumed.accounts_server) throw new Error("Zoho returned from a different accounts data centre");

  const params = new URLSearchParams({
    grant_type: "authorization_code", client_id: required("ZOHO_OAUTH_CLIENT_ID"),
    client_secret: required("ZOHO_OAUTH_CLIENT_SECRET"), redirect_uri: resolveZohoRedirectUri(input.origin), code: input.code,
  });
  const tokenResponse = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params,
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const token = await tokenResponse.json() as {
    access_token?: string; refresh_token?: string; api_domain?: string; expires_in?: number; error?: string;
  };
  if (!tokenResponse.ok || !token.access_token || !token.refresh_token || !token.api_domain) {
    throw new Error(token.error ? `Zoho authorization failed: ${token.error}` : "Zoho did not return offline access");
  }
  let apiDomain: string;
  try { apiDomain = allowedApiDomain(token.api_domain); }
  catch (error) { await tryRevokeRefreshToken(accountsServer, token.refresh_token); throw error; }
  if (apiDomain !== ACCOUNTS_TO_API.get(accountsServer)) {
    await tryRevokeRefreshToken(accountsServer, token.refresh_token);
    throw new Error("Zoho API and accounts data centres do not match");
  }

  let organizations: ZohoOrganization[];
  try { organizations = await getOrganizations(apiDomain, token.access_token); }
  catch (error) { await tryRevokeRefreshToken(accountsServer, token.refresh_token); throw error; }
  const compatible = organizations.filter((org) => org.currency_code === "SGD");
  if (compatible.length === 0) {
    await tryRevokeRefreshToken(accountsServer, token.refresh_token);
    throw new Error("No SGD Zoho Books organization is available to this account");
  }
  if (compatible.length > 1) {
    const refresh = encryptZohoToken(token.refresh_token, aad(env));
    const access = encryptZohoToken(token.access_token, aad(env));
    let superseded: Selectable<ZohoPendingConnections>[] = [];
    try {
      superseded = await db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
        const old = await trx.deleteFrom("zoho_pending_connections").where("environment", "=", env).returningAll().execute();
        await trx.insertInto("zoho_pending_connections").values({
          id: randomUUID(), environment: env, accounts_server: accountsServer, api_domain: apiDomain,
          candidate_organizations: JSON.stringify(compatible) as unknown as Json, requested_scopes: [...ZOHO_BOOKS_SCOPES] as string[],
          refresh_token_ciphertext: refresh.ciphertext, refresh_token_nonce: refresh.nonce, refresh_token_tag: refresh.tag,
          access_token_ciphertext: access.ciphertext, access_token_nonce: access.nonce, access_token_tag: access.tag,
          access_token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
          initiated_by: input.adminId, expires_at: new Date(Date.now() + 15 * 60_000), status: "pending", claimed_at: null,
        }).execute();
        return old;
      });
    } catch (error) {
      await tryRevokeRefreshToken(accountsServer, token.refresh_token);
      throw error;
    }
    for (const old of superseded) {
      try {
        const oldToken = decryptZohoToken({ ciphertext: old.refresh_token_ciphertext, nonce: old.refresh_token_nonce, tag: old.refresh_token_tag }, aad(env));
        await revokeRefreshToken(old.accounts_server, oldToken);
      } catch { await safeAudit("superseded_pending_authorization_revoke_failed", old.initiated_by); }
    }
    await safeAudit("organization_selection_required", input.adminId, { organizations: compatible.length, api_domain: apiDomain });
    return "pending_organization";
  }

  const selected = compatible[0];
  const capabilities = await probeCapabilities(apiDomain, token.access_token, selected.organization_id);
  try {
    return await activateConnection({
      actorId: input.adminId, accountsServer, apiDomain, organization: selected, capabilities,
      refreshToken: token.refresh_token, accessToken: token.access_token, expiresIn: token.expires_in ?? 3600,
    });
  } catch (error) {
    await tryRevokeRefreshToken(accountsServer, token.refresh_token);
    throw error;
  }
}

export async function getZohoConnectionSummary() {
  const expired = await db.deleteFrom("zoho_pending_connections").where("environment", "=", environment())
    .where("expires_at", "<=", new Date()).returningAll().execute();
  for (const pending of expired) {
    try {
      const token = decryptZohoToken({ ciphertext: pending.refresh_token_ciphertext, nonce: pending.refresh_token_nonce, tag: pending.refresh_token_tag }, aad());
      const revoked = await revokeRefreshToken(pending.accounts_server, token);
      await safeAudit(revoked ? "expired_pending_authorization_revoked" : "expired_pending_authorization_revoke_failed", pending.initiated_by);
    } catch {
      // The local credential is already gone; audit the best-effort remote cleanup.
      await safeAudit("expired_pending_authorization_revoke_failed", pending.initiated_by);
    }
  }
  const [row, pending, customerLinks, estimates, invoices, interrupted, failures] = await Promise.all([
    db.selectFrom("zoho_connections")
      .select(["status", "organization_id", "organization_name", "currency_code", "country_code", "api_domain", "candidate_organizations", "requested_scopes", "verified_capabilities", "connected_at", "last_verified_at", "last_error", "estimate_crm_key_api_name", "estimate_crm_key_id", "estimate_template_id"])
      .where("environment", "=", environment()).executeTakeFirst(),
    db.selectFrom("zoho_pending_connections").select(["id", "candidate_organizations", "expires_at"])
      .where("environment", "=", environment()).where("status", "=", "pending").where("expires_at", ">", new Date())
      .orderBy("created_at", "desc").executeTakeFirst(),
    db.selectFrom("customer_zoho_links").select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("order_quotations").select(({ fn }) => fn.count<string>("zoho_estimate_id").as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("order_quotations").select(({ fn }) => fn.count<string>("zoho_invoice_id").as("count")).executeTakeFirstOrThrow(),
    db.selectFrom("order_quotations").select(({ fn }) => fn.countAll<string>().as("count"))
      .where((eb) => eb.or([eb("status", "in", ["syncing", "sending"]), eb("invoice_sync_state", "in", ["pending", "uncertain"])]))
      .executeTakeFirstOrThrow(),
    db.selectFrom("order_quotations").select(({ fn }) => fn.countAll<string>().as("count"))
      .where((eb) => eb.or([eb("status", "in", ["sync_failed", "conflict"]), eb("invoice_sync_state", "in", ["failed", "uncertain"])]))
      .executeTakeFirstOrThrow(),
  ]);
  return {
    appConfigured: isZohoOAuthAppConfigured(), connection: row ?? null, pending: pending ?? null,
    operational: {
      customerLinks: Number(customerLinks.count), estimates: Number(estimates.count), invoices: Number(invoices.count),
      interrupted: Number(interrupted.count), failures: Number(failures.count),
    },
  };
}

export type ZohoAccessContext = {
  connectionId: string;
  tokenVersion: number;
  accessToken: string;
  organizationId: string;
  apiBaseUrl: string;
  crmKeyApiName: string | null;
  crmKeyFieldId: string | null;
  estimateTemplateId: string | null;
};

export async function getZohoAccessContext(forceRefresh = false, allowPartial = false): Promise<ZohoAccessContext> {
  const env = environment();
  const result = await db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom("zoho_connections").selectAll().where("environment", "=", env).forUpdate().executeTakeFirst();
    if (!row || (row.status !== "connected" && !(allowPartial && row.status === "partial")) || !row.organization_id || !row.access_token_ciphertext || !row.access_token_nonce || !row.access_token_tag || !row.access_token_expires_at || !row.refresh_token_ciphertext || !row.refresh_token_nonce || !row.refresh_token_tag) {
      throw new Error("Zoho Books is not connected. Ask an admin to connect it under Integrations.");
    }
    if (!allowPartial && (!row.estimate_crm_key_api_name || !row.estimate_crm_key_id || !row.estimate_template_id)) {
      throw new Error("Zoho Books organization settings are not verified. Ask an admin to reconnect it under Integrations.");
    }
    const context = (accessToken: string, tokenVersion = row.token_version): ZohoAccessContext => ({
      connectionId: row.id, tokenVersion,
      accessToken, organizationId: row.organization_id!, apiBaseUrl: `${row.api_domain}/books/v3`,
      crmKeyApiName: row.estimate_crm_key_api_name, crmKeyFieldId: row.estimate_crm_key_id,
      estimateTemplateId: row.estimate_template_id,
    });
    const stillValid = new Date(row.access_token_expires_at).getTime() > Date.now() + 60_000;
    let accessToken = decryptZohoToken({ ciphertext: row.access_token_ciphertext, nonce: row.access_token_nonce, tag: row.access_token_tag }, aad(env));
    if (stillValid && !forceRefresh) return { context: context(accessToken), error: null };

    const refreshToken = decryptZohoToken({ ciphertext: row.refresh_token_ciphertext, nonce: row.refresh_token_nonce, tag: row.refresh_token_tag }, aad(env));
    const params = new URLSearchParams({ refresh_token: refreshToken, client_id: required("ZOHO_OAUTH_CLIENT_ID"), client_secret: required("ZOHO_OAUTH_CLIENT_SECRET"), grant_type: "refresh_token" });
    const response = await fetch(`${row.accounts_server}/oauth/v2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params,
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json() as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !json.access_token) {
      await trx.updateTable("zoho_connections").set({ status: "reconnect_required", last_error: "Zoho authorization must be renewed" }).where("id", "=", row.id).execute();
      return { context: null, error: json.error ? `Zoho authorization must be renewed (${json.error})` : "Zoho authorization must be renewed" };
    }
    accessToken = json.access_token;
    const encrypted = encryptZohoToken(accessToken, aad(env));
    await trx.updateTable("zoho_connections").set({
      access_token_ciphertext: encrypted.ciphertext, access_token_nonce: encrypted.nonce, access_token_tag: encrypted.tag,
      access_token_expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000), token_version: row.token_version + 1,
      last_error: null,
    }).where("id", "=", row.id).execute();
    return { context: context(accessToken, row.token_version + 1), error: null };
  });
  if (result.error || !result.context) throw new Error(result.error ?? "Zoho authorization must be renewed");
  return result.context;
}

export async function verifyZohoConnection(actorId: string): Promise<"connected" | "partial"> {
  const context = await getZohoAccessContext(false, true);
  const organizations = await getOrganizations(new URL(context.apiBaseUrl).origin, context.accessToken);
  const organization = organizations.find((candidate) => candidate.organization_id === context.organizationId);
  if (!organization || organization.currency_code !== "SGD") {
    await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
      await trx.updateTable("zoho_connections").set({ status: "error", last_error: "The connected SGD organization is no longer available" })
        .where("id", "=", context.connectionId).where("token_version", "=", context.tokenVersion)
        .where("organization_id", "=", context.organizationId).where("status", "in", ["connected", "partial"]).execute();
    });
    throw new Error("The connected Zoho organization is no longer available");
  }
  const capabilities = await probeCapabilities(new URL(context.apiBaseUrl).origin, context.accessToken, context.organizationId);
  const status = capabilities.contactsRead && capabilities.estimatesRead && capabilities.invoicesRead && capabilities.crmKeyFieldVerified && capabilities.templateVerified ? "connected" : "partial";
  const updated = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
    return trx.updateTable("zoho_connections").set({
      status, organization_name: organization.name, currency_code: organization.currency_code ?? null,
      country_code: organization.country_code ?? null, verified_capabilities: capabilities as unknown as Json,
      estimate_crm_key_api_name: capabilities.crmKeyFieldVerified ? required("ZOHO_ESTIMATE_CRM_KEY_API_NAME") : null,
      estimate_crm_key_id: capabilities.crmKeyFieldVerified ? required("ZOHO_ESTIMATE_CRM_KEY_ID") : null,
      estimate_template_id: capabilities.templateVerified ? required("ZOHO_ESTIMATE_TEMPLATE_ID") : null,
      last_verified_at: new Date(), last_error: status === "partial" ? "Some required Zoho capabilities are unavailable" : null,
    }).where("id", "=", context.connectionId).where("token_version", "=", context.tokenVersion)
      .where("organization_id", "=", context.organizationId).where("status", "in", ["connected", "partial"])
      .returning("id").executeTakeFirst();
  });
  if (!updated) throw new Error("The Zoho connection changed while it was being verified. Test the current connection again.");
  await safeAudit("connection_verified", actorId, { status, organization_id: context.organizationId });
  return status;
}

export async function selectZohoOrganization(actorId: string, pendingId: string, organizationId: string): Promise<"connected" | "partial"> {
  const env = environment();
  const row = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
    return trx.updateTable("zoho_pending_connections").set({ status: "claimed", claimed_at: new Date() })
      .where("id", "=", pendingId).where("environment", "=", env).where("initiated_by", "=", actorId)
      .where("status", "=", "pending").where("expires_at", ">", new Date()).returningAll().executeTakeFirst();
  });
  if (!row) throw new Error("There is no Zoho organization selection awaiting completion");
  const candidates = Array.isArray(row.candidate_organizations) ? row.candidate_organizations as unknown as ZohoOrganization[] : [];
  const selected = candidates.find((candidate) => candidate.organization_id === organizationId && candidate.currency_code === "SGD");
  if (!selected) {
    await db.updateTable("zoho_pending_connections").set({ status: "pending", claimed_at: null }).where("id", "=", row.id).where("status", "=", "claimed").execute();
    throw new Error("Select an available SGD Zoho Books organization");
  }
  try {
    const accessToken = decryptZohoToken({ ciphertext: row.access_token_ciphertext, nonce: row.access_token_nonce, tag: row.access_token_tag }, aad(env));
    const organizations = await getOrganizations(row.api_domain, accessToken);
    if (!organizations.some((candidate) => candidate.organization_id === selected.organization_id && candidate.currency_code === "SGD")) throw new Error("That Zoho organization is no longer available");
    const capabilities = await probeCapabilities(row.api_domain, accessToken, selected.organization_id);
    const refreshToken = decryptZohoToken({ ciphertext: row.refresh_token_ciphertext, nonce: row.refresh_token_nonce, tag: row.refresh_token_tag }, aad(env));
    const status = await activateConnection({
      actorId, accountsServer: row.accounts_server, apiDomain: row.api_domain, organization: selected, capabilities,
      refreshToken, accessToken, expiresIn: Math.max(60, Math.floor((new Date(row.access_token_expires_at).getTime() - Date.now()) / 1000)),
      pendingId: row.id,
    });
    await safeAudit("organization_selected", actorId, { status, organization_id: selected.organization_id });
    return status;
  } catch (error) {
    await db.updateTable("zoho_pending_connections").set({ status: "pending", claimed_at: null })
      .where("id", "=", row.id).where("status", "=", "claimed").where("expires_at", ">", new Date()).execute();
    throw error;
  }
}

export async function cancelPendingZohoAuthorization(actorId: string): Promise<void> {
  const env = environment();
  const pending = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
    await trx.selectFrom("zoho_pending_connections").select("id").where("environment", "=", env).forUpdate().execute();
    const rows = await trx.deleteFrom("zoho_pending_connections").where("environment", "=", env).returningAll().execute();
    await trx.deleteFrom("zoho_oauth_states").where("environment", "=", env).execute();
    return rows;
  });
  for (const grant of pending) {
    try {
      const token = decryptZohoToken({ ciphertext: grant.refresh_token_ciphertext, nonce: grant.refresh_token_nonce, tag: grant.refresh_token_tag }, aad(env));
      const revoked = await revokeRefreshToken(grant.accounts_server, token);
      await safeAudit(revoked ? "pending_authorization_cancelled" : "pending_authorization_revoke_failed", actorId);
    } catch { await safeAudit("pending_authorization_revoke_failed", actorId); }
  }
}

export async function disconnectZohoConnection(actorId: string): Promise<void> {
  const env = environment();
  const claimed = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${LIFECYCLE_LOCK}))`.execute(trx);
    const connection = await trx.selectFrom("zoho_connections").selectAll().where("environment", "=", env).forUpdate().executeTakeFirst();
    await trx.selectFrom("zoho_pending_connections").select("id").where("environment", "=", env).forUpdate().execute();
    const active = await trx.selectFrom("order_quotations").select(({ fn }) => fn.countAll<string>().as("count"))
      .where((eb) => eb.or([eb("status", "in", ["syncing", "sending"]), eb("invoice_sync_state", "in", ["pending", "uncertain"])]))
      .executeTakeFirstOrThrow();
    if (Number(active.count) > 0) throw new Error("Wait for active Zoho quotation or invoice operations to finish before disconnecting");
    const pending = await trx.deleteFrom("zoho_pending_connections").where("environment", "=", env).returningAll().execute();
    await trx.deleteFrom("zoho_oauth_states").where("environment", "=", env).execute();
    if (connection && connection.status !== "disconnected") {
      if (!connection.refresh_token_ciphertext || !connection.refresh_token_nonce || !connection.refresh_token_tag) throw new Error("The stored Zoho authorization is incomplete");
      await trx.updateTable("zoho_connections").set({ status: "disconnecting", last_error: null }).where("id", "=", connection.id).execute();
    }
    return { connection: connection && connection.status !== "disconnected" ? connection : null, pending };
  });
  for (const pending of claimed.pending) {
    try {
      const pendingToken = decryptZohoToken({ ciphertext: pending.refresh_token_ciphertext, nonce: pending.refresh_token_nonce, tag: pending.refresh_token_tag }, aad(env));
      const revoked = await revokeRefreshToken(pending.accounts_server, pendingToken);
      await safeAudit(revoked ? "pending_authorization_cancelled" : "pending_authorization_revoke_failed", actorId);
    } catch {
      await safeAudit("pending_authorization_revoke_failed", actorId);
    }
  }
  if (!claimed.connection) return;
  const refreshToken = decryptZohoToken({ ciphertext: claimed.connection.refresh_token_ciphertext!, nonce: claimed.connection.refresh_token_nonce!, tag: claimed.connection.refresh_token_tag! }, aad(env));
  let revoked = false;
  try { revoked = await revokeRefreshToken(claimed.connection.accounts_server, refreshToken); }
  catch { revoked = false; }
  if (!revoked) {
    await db.updateTable("zoho_connections").set({ status: "reconnect_required", last_error: "Zoho access could not be revoked; reconnect or retry disconnect" }).where("id", "=", claimed.connection.id).execute();
    throw new Error("Zoho access could not be revoked; no local credentials were removed");
  }
  const disconnected = await db.updateTable("zoho_connections").set({
    status: "disconnected", refresh_token_ciphertext: null, refresh_token_nonce: null, refresh_token_tag: null,
    access_token_ciphertext: null, access_token_nonce: null, access_token_tag: null, access_token_expires_at: null,
    verified_capabilities: {} as Json, last_error: null,
  }).where("id", "=", claimed.connection.id).where("status", "=", "disconnecting").returning("id").executeTakeFirst();
  if (!disconnected) {
    await safeAudit("oauth_disconnect_finalize_conflict", actorId, { organization_id: claimed.connection.organization_id });
    throw new Error("Zoho access was revoked, but the CRM connection changed during cleanup. Reconnect before continuing.");
  }
  await safeAudit("oauth_disconnected", actorId, { organization_id: claimed.connection.organization_id });
}
