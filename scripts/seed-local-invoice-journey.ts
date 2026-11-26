// scripts/seed-local-invoice-journey.ts
//
// Synthetic end-to-end fixture for the invoice → deposit → manufacturing
// journey on the disposable local app started by
// scripts/start-invoice-journey-local.mjs (port 3005, build dir
// .next-invoice-journey). Runs AFTER setup-priority-local.ts and
// seed-local-admin.ts — the tester profile ...0099 must already be admin.
//
// Seeds, all with stable synthetic ids:
//   * customer + customer_zoho_links row pointing at the fixture contact
//   * lead (so the deposit handoff's Won milestone has somewhere to land)
//   * order at order_recorded, S$4730.00 total, S$2365.00 recorded deposit
//   * room + measured window, and a configured curtain manufacture allowance
//   * order_invoice_ledger: linked fixture invoice, CRM items matching the
//     fixture invoice exactly, verified fingerprint, verified audit row
//   * zoho_connections row for environment "local-fixture" carrying
//     locally-encrypted dummy tokens (aes-256-gcm, fixture key — see
//     scripts/fixtures/invoice-journey-fixture.json)
//
// The dev server itself answers Zoho traffic through
// scripts/zoho-fixture-preload.mjs, so these tokens are placeholders that let
// getZohoAccessContext decrypt successfully without any real credential.
//
// Hard guard: only 127.0.0.1:55439, database postgres or
// drapeworks_priority_local. Idempotent via stable ids.
//
//   node --import tsx scripts/seed-local-invoice-journey.ts \
//     postgresql://jason@127.0.0.1:55439/drapeworks_priority_local

import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import { quotePayloadHash } from "../src/lib/quotations/hash";
import {
  commercialFingerprint,
  normalizeCommercialInvoice,
} from "../src/lib/quotations/commercial-invoice";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "invoice-journey-fixture.json"),
    "utf8",
  ),
) as {
  environment: string;
  apiDomain: string;
  accountsServer: string;
  organizationId: string;
  organizationName: string;
  aad: string;
  tokenEncryptionKeyBase64: string;
  orderId: string;
  contactId: string;
  invoice: Parameters<typeof normalizeCommercialInvoice>[0];
};

const OWNER_ID = "00000000-0000-4000-8000-000000000099";
const ORDER_ID = fixture.orderId;
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c2";
const LEAD_ID = "00000000-0000-4000-8000-0000000000c3";
const ROOM_ID = "00000000-0000-4000-8000-0000000000f2";
const WINDOW_ID = "00000000-0000-4000-8000-0000000000f3";
const CONNECTION_ID = "00000000-0000-4000-8000-0000000000f4";

const ZOHO_SCOPES = [
  "ZohoBooks.settings.READ",
  "ZohoBooks.contacts.READ",
  "ZohoBooks.contacts.CREATE",
  "ZohoBooks.estimates.READ",
  "ZohoBooks.estimates.CREATE",
  "ZohoBooks.estimates.UPDATE",
  "ZohoBooks.invoices.READ",
  "ZohoBooks.invoices.CREATE",
  "ZohoBooks.invoices.UPDATE",
  "ZohoBooks.customerpayments.READ",
  "ZohoBooks.customerpayments.CREATE",
];

// Mirrors src/lib/zoho/crypto.ts encryptZohoToken — duplicated rather than
// imported because that module is marked "server-only", which throws under a
// plain tsx script. The fixture key is a constant of the fixture file, never
// a real credential.
function encryptToken(
  value: string,
  key: Buffer,
  aad: string,
): { ciphertext: string; nonce: string; tag: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function guardedUrl(): string {
  const raw = process.argv[2] ?? process.env.DATABASE_URL ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Pass the local cluster URL as argv[2] or DATABASE_URL");
  }
  const ok =
    (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
    url.hostname === "127.0.0.1" &&
    url.port === "55439" &&
    ["/postgres", "/drapeworks_priority_local"].includes(url.pathname);
  if (!ok) {
    throw new Error(
      "Refusing to run: target must be 127.0.0.1:55439, database postgres or drapeworks_priority_local.",
    );
  }
  return raw;
}

async function main() {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: guardedUrl(), max: 1, ssl: false }),
    }),
  });
  try {
    const owner = await sql<{ id: string }>`
      select id from public.profiles where id = ${OWNER_ID}::uuid
    `.execute(db);
    if (owner.rows.length === 0) {
      throw new Error(
        "profiles row for the seeded tester is missing — run setup-priority-local.ts and seed-local-admin.ts first",
      );
    }

    const key = Buffer.from(fixture.tokenEncryptionKeyBase64, "base64");
    if (key.length !== 32) throw new Error("fixture token key must decode to 32 bytes");
    const access = encryptToken("fixture-access-token", key, fixture.aad);
    const refresh = encryptToken("fixture-refresh-token", key, fixture.aad);
    const document = normalizeCommercialInvoice(fixture.invoice);
    const verified = commercialFingerprint(document);
    const documentJson = JSON.stringify(document);

    await db.transaction().execute(async (trx) => {
      await sql`
        insert into public.customers (id, name, mobile, email, created_by)
        values (${CUSTOMER_ID}::uuid, 'QA Invoice Journey', '90000000', 'qa.invoice@example.invalid', ${OWNER_ID}::uuid)
        on conflict (id) do nothing
      `.execute(trx);

      await sql`
        insert into public.customer_zoho_links (customer_id, zoho_contact_id, confirmed_by)
        values (${CUSTOMER_ID}::uuid, ${fixture.contactId}, ${OWNER_ID}::uuid)
        on conflict (customer_id) do nothing
      `.execute(trx);

      await sql`
        insert into public.leads (id, customer_id, lead_ref, name, contact_channel, owner_id, lead_status, funnel_stage, first_initiated_at)
        values (${LEAD_ID}::uuid, ${CUSTOMER_ID}::uuid, ${"INVOICE-JOURNEY-QA"}, 'QA Invoice Journey', 'Other', ${OWNER_ID}::uuid, 'Active', 'Qualify Lead', now())
        on conflict (id) do nothing
      `.execute(trx);

      // display_id is assigned by the assign_order_display_id trigger from
      // seq_year/seq_num — read the confirmation identifier off the UI.
      await sql`
        insert into public.orders (
          id, customer_id, consultant_id, appointment_id, lead_id,
          seq_year, seq_num, display_id,
          property_type, development, site_address, unit_type, move_in_date,
          price_quoted_cents, deposit_cents, freight_mode, channel,
          extra_install_sgd_cents, discount_bps, promo_label,
          general_notes, is_draft, product_line
        ) values (
          ${ORDER_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid, null, ${LEAD_ID}::uuid,
          2026, 98001, '',
          'HDB', 'QA Estate', '1 Fixture Way', '4-room', null,
          473000, 236500, 'air', 'standard',
          0, 0, null,
          'QA invoice journey fixture', false, 'curtain'
        )
        on conflict (id) do nothing
      `.execute(trx);

      await sql`
        insert into public.order_status_events (order_id, status, note, created_by)
        select ${ORDER_ID}::uuid, 'order_recorded', 'QA invoice journey fixture', ${OWNER_ID}::uuid
        where not exists (
          select 1 from public.order_status_events
          where order_id = ${ORDER_ID}::uuid and note = 'QA invoice journey fixture'
        )
      `.execute(trx);

      await sql`
        insert into public.rooms (id, order_id, type, label, position)
        values (${ROOM_ID}::uuid, ${ORDER_ID}::uuid, 'Living Room', 'Living Room', 0)
        on conflict (id) do nothing
      `.execute(trx);

      // A measured curtain window: width/height drive the manufacturing
      // figures; day/night types picked from the catalogue when present.
      const day = await sql<{ id: string }>`
        select id from public.curtain_types where status = 'Active' and category = 'Day' order by created_at, id limit 1
      `.execute(trx);
      const night = await sql<{ id: string }>`
        select id from public.curtain_types where status = 'Active' and category = 'Night' order by created_at, id limit 1
      `.execute(trx);
      await sql`
        insert into public.windows (id, room_id, position, width_cm, height_cm, draw, day_curtain_type_id, night_curtain_type_id)
        values (
          ${WINDOW_ID}::uuid, ${ROOM_ID}::uuid, 0, 200, 250, 'Double',
          ${day.rows[0]?.id ?? null}::uuid, ${night.rows[0]?.id ?? null}::uuid
        )
        on conflict (id) do update set
          width_cm = excluded.width_cm, height_cm = excluded.height_cm,
          draw = excluded.draw,
          day_curtain_type_id = excluded.day_curtain_type_id,
          night_curtain_type_id = excluded.night_curtain_type_id
      `.execute(trx);

      // The confirm action needs a configured curtain allowance. This is the
      // disposable cluster, so setting it is safe and required for the journey.
      await sql`
        update public.manufacture_allowances set width_delta_cm = 10, height_delta_cm = 10, updated_by = ${OWNER_ID}::uuid
        where product_line = 'curtain'
      `.execute(trx);

      // The same context query src/lib/invoices/service.ts local() runs, so
      // the stored source fingerprint is exactly what a live preview computes.
      const source = (await sql<{ context: unknown }>`select jsonb_build_object(
        'order',jsonb_build_object('product',o.product_line,'package',o.curtain_package_id,'packageRules',o.curtain_package_rules,'packagePrice',o.curtain_package_sale_sgd_cents,'discount',o.discount_bps,'installation',o.extra_install_sgd_cents,'freight',o.freight_mode,'channel',o.channel),
        'rooms',(select coalesce(jsonb_agg(to_jsonb(r)-'created_at' order by r.id),'[]') from public.rooms r where r.order_id=o.id),
        'windows',(select coalesce(jsonb_agg(to_jsonb(w)-'created_at'-'updated_at' order by w.id),'[]') from public.windows w join public.rooms r on r.id=w.room_id where r.order_id=o.id),
        'mesh',(select coalesce(jsonb_agg(to_jsonb(m)-'created_at' order by m.id),'[]') from public.mesh_panels m join public.rooms r on r.id=m.room_id where r.order_id=o.id),
        'addons',(select coalesce(jsonb_agg(to_jsonb(a)-'created_at' order by a.window_id,a.addon_id),'[]') from public.window_addons a join public.windows w on w.id=a.window_id join public.rooms r on r.id=w.room_id where r.order_id=o.id)
      ) as context from public.orders o where o.id=${ORDER_ID}::uuid`.execute(trx)).rows[0].context;
      const sourceFingerprint = quotePayloadHash(source);

      await sql`
        insert into public.order_invoice_ledger (
          order_id, organization_id, customer_id, invoice_id, invoice_number,
          document, invoice_state, payment_state, source_fingerprint,
          verified_fingerprint, updated_by
        ) values (
          ${ORDER_ID}::uuid, ${fixture.organizationId}, ${fixture.contactId},
          ${fixture.invoice.invoice_id}, ${fixture.invoice.invoice_number ?? null},
          ${documentJson}::jsonb, 'linked', 'idle', ${sourceFingerprint},
          ${verified}, ${OWNER_ID}::uuid
        )
        on conflict (order_id) do update set
          organization_id = excluded.organization_id,
          customer_id = excluded.customer_id,
          invoice_id = excluded.invoice_id,
          invoice_number = excluded.invoice_number,
          document = excluded.document,
          invoice_state = excluded.invoice_state,
          payment_state = excluded.payment_state,
          source_fingerprint = excluded.source_fingerprint,
          verified_fingerprint = excluded.verified_fingerprint,
          claim_token = null, claim_kind = null,
          legacy_unresolved = false, legacy_operations = '[]'::jsonb,
          updated_by = excluded.updated_by, updated_at = now()
      `.execute(trx);

      // The verified-evidence row invoicePreview() looks for when reporting
      // syncComplete — the handoff itself does not require it, but it mirrors
      // what continueOrderInvoice leaves behind.
      await sql`
        insert into public.order_invoice_audit (order_id, action, before_document, after_document, actor_id)
        select ${ORDER_ID}::uuid, 'invoice_sync_verified', ${documentJson}::jsonb, ${documentJson}::jsonb, ${OWNER_ID}::uuid
        where not exists (
          select 1 from public.order_invoice_audit
          where order_id = ${ORDER_ID}::uuid and action = 'invoice_sync_verified'
        )
      `.execute(trx);

      await sql`
        insert into public.zoho_connections (
          id, environment, status, accounts_server, api_domain,
          organization_id, organization_name, currency_code, country_code,
          requested_scopes, verified_capabilities, candidate_organizations,
          refresh_token_ciphertext, refresh_token_nonce, refresh_token_tag,
          access_token_ciphertext, access_token_nonce, access_token_tag,
          access_token_expires_at, key_version,
          estimate_crm_key_api_name, estimate_crm_key_id, estimate_template_id,
          connected_by, connected_at, last_verified_at
        ) values (
          ${CONNECTION_ID}::uuid, ${fixture.environment}, 'connected',
          ${fixture.accountsServer}, ${fixture.apiDomain},
          ${fixture.organizationId}, ${fixture.organizationName}, 'SGD', 'SG',
          ${`{${ZOHO_SCOPES.map((s) => `"${s}"`).join(",")}}`}::text[], '{}'::jsonb, '[]'::jsonb,
          ${refresh.ciphertext}, ${refresh.nonce}, ${refresh.tag},
          ${access.ciphertext}, ${access.nonce}, ${access.tag},
          now() + interval '7 days', 1,
          'cf_crm_quote_key', 'fixture-field-id', 'fixture-template-id',
          ${OWNER_ID}::uuid, now(), now()
        )
        on conflict (environment) do update set
          status = excluded.status,
          accounts_server = excluded.accounts_server,
          api_domain = excluded.api_domain,
          organization_id = excluded.organization_id,
          organization_name = excluded.organization_name,
          currency_code = excluded.currency_code,
          country_code = excluded.country_code,
          requested_scopes = excluded.requested_scopes,
          refresh_token_ciphertext = excluded.refresh_token_ciphertext,
          refresh_token_nonce = excluded.refresh_token_nonce,
          refresh_token_tag = excluded.refresh_token_tag,
          access_token_ciphertext = excluded.access_token_ciphertext,
          access_token_nonce = excluded.access_token_nonce,
          access_token_tag = excluded.access_token_tag,
          access_token_expires_at = excluded.access_token_expires_at,
          estimate_crm_key_api_name = excluded.estimate_crm_key_api_name,
          estimate_crm_key_id = excluded.estimate_crm_key_id,
          estimate_template_id = excluded.estimate_template_id,
          last_error = null, last_verified_at = now()
      `.execute(trx);
    });

    console.log(`invoice journey fixture ready:`);
    console.log(`  order ${ORDER_ID} (order_recorded, total S$4730.00, deposit S$2365.00)`);
    console.log(`  linked fixture invoice ${fixture.invoice.invoice_id} (${fixture.invoice.invoice_number}) — matched + verified`);
    console.log(`  zoho connection env "${fixture.environment}" org ${fixture.organizationId}`);
    console.log(`  journey: http://localhost:3005/orders/${ORDER_ID} → Customer invoice → Continue to manufacturing → confirm → /orders/${ORDER_ID}/manufacture`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
