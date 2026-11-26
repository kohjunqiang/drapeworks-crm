// scripts/zoho-fixture-preload.mjs
//
// Loaded into the LOCAL dev server via NODE_OPTIONS=--import by
// scripts/start-invoice-journey-local.mjs. Intercepts global fetch at the
// network boundary: only the seeded fixture reads below are answered — every
// other call to a Zoho host (payments, writes, token refreshes, unexpected
// paths) throws loudly instead of touching the network. No production
// credentials exist in this environment; nothing real can ever be reached.
//
// The fixture data is shared with scripts/seed-local-invoice-journey.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/invoice-journey-fixture.json", import.meta.url)),
    "utf8",
  ),
);
const invoice = fixture.invoice;

function envelope(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function fixtureFetch(input, init) {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw);
  const host = url.hostname;
  const isZoho =
    host === "accounts.zoho.com" ||
    host.endsWith(".zoho.com") ||
    host.endsWith(".zohoapis.com") ||
    host.endsWith(".zohoapis.eu") ||
    /\.zohoapis\.[a-z.]+$/i.test(host) ||
    /\.zoho\.[a-z.]+$/i.test(host);
  if (!isZoho) return realFetch(input, init);

  const method = String(init && init.method ? init.method : "GET").toUpperCase();
  const path = url.pathname;

  if (host === "www.zohoapis.com" && method === "GET") {
    if (path === "/books/v3/organizations") {
      return envelope({
        code: 0,
        organizations: [
          {
            organization_id: fixture.organizationId,
            name: fixture.organizationName,
            currency_code: "SGD",
            is_default_org: true,
          },
        ],
      });
    }
    if (path === `/books/v3/invoices/${invoice.invoice_id}`) {
      return envelope({ code: 0, invoice });
    }
    if (path === "/books/v3/invoices") {
      return envelope({ code: 0, invoices: [invoice], page_context: { has_more_page: false } });
    }
    if (path === "/books/v3/contacts") {
      return envelope({ code: 0, contacts: fixture.contacts, page_context: { has_more_page: false } });
    }
    const contactMatch = path.match(/^\/books\/v3\/contacts\/(.+)$/);
    if (contactMatch) {
      const contact = fixture.contacts.find(
        (c) => c.contact_id === decodeURIComponent(contactMatch[1]),
      );
      return contact
        ? envelope({ code: 0, contact })
        : envelope({ code: 4, message: "Contact not found" });
    }
    if (path === "/books/v3/items") {
      return envelope({ code: 0, items: [] });
    }
  }

  // Payment endpoints and every write are forbidden in this fixture: the
  // recorded-deposit handoff must never touch Zoho payments, and no invoice
  // write is part of the QA journey.
  throw new Error(
    `[zoho-fixture] BLOCKED ${method} ${url.href} — the local fixture only serves ` +
      `the seeded invoice/contact/organization reads; payment and write calls must never fire`,
  );
};

console.log(
  "[zoho-fixture] fetch interception armed: /books/v3 fixture reads only; every other Zoho call throws",
);
