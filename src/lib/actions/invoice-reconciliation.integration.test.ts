import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "kysely";
const mocks = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), estimate: vi.fn(), invoice: vi.fn(), payments: vi.fn(), payment: vi.fn(), put: vi.fn(), convert: vi.fn(), createPayment: vi.fn(), ready: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireSession: mocks.session, requireRole: mocks.role }));
vi.mock("@/lib/zoho/books", async original => ({ ...await original<typeof import("@/lib/zoho/books")>(), getZohoEstimate: mocks.estimate, getZohoInvoice: mocks.invoice, listZohoCustomerPayments: mocks.payments, getZohoCustomerPayment: mocks.payment, updateZohoInvoiceCommercial: mocks.put, convertZohoEstimateToInvoice: mocks.convert, createZohoCustomerPayment: mocks.createPayment, assertZohoCustomerPaymentsReady: mocks.ready, getZohoBooksBinding: async () => ({ crmKeyFieldId: "key", crmKeyApiName: "crm_key" }), getZohoDepositPaymentConfig: () => ({ accountId: "bank", paymentMode: "PayNow" }) }));
import { db } from "@/lib/db/kysely";
import { applyInvoiceReconciliation, previewInvoiceReconciliation, confirmInvoiceDeposit } from "./invoice-reconciliation";
import { ensureZohoInvoiceForOrder } from "./quotations";
import { loadCommercialSnapshot } from "@/lib/quotations/commercial-store";
import { estimateSnapshotHash } from "@/lib/quotations/hash";
import type { ZohoInvoice } from "@/lib/zoho/books";

// Explicit opt-in, exact disposable local database only. Never uses DATABASE_URL
// as opt-in and never contacts the real Zoho transport.
const url = process.env.INVOICE_FLOW_TEST_DATABASE_URL;
const enabled = Boolean(url);
const actor = "00000000-0000-4000-8000-000000000099";
let orderId: string, quoteId: string, customerId: string, invoice: ZohoInvoice;
describe.skipIf(!enabled)("real Postgres invoice reconciliation transactions", () => {
  beforeAll(() => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439" || parsed.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-disposable database");
    process.env.DATABASE_URL = url;
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    orderId = randomUUID(); quoteId = randomUUID(); customerId = randomUUID();
    mocks.session.mockResolvedValue({ user: { id: actor }, profile: { role: "admin" } });
    mocks.role.mockImplementation(async (roles:string[])=>{const session=await mocks.session();if(!roles.includes(session.profile.role))throw new Error("Forbidden");return session;});
    invoice = { invoice_id: `invoice-${quoteId}`, invoice_number: "INV-4730", status: "partially_paid", customer_id: `contact-${customerId}`, currency_code: "SGD", total: 4730, payment_made: 2365, balance: 2365, credits_applied: 0, write_off_amount: 0, ach_payment_initiated: false, line_items: [{ item_id: "curtain", name: "Current curtain", description: "Approved invoice", quantity: 1, rate: 4730, discount: "0%" }] };
    mocks.invoice.mockImplementation(async () => structuredClone(invoice));
    mocks.estimate.mockImplementation(async () => ({ estimate_id: `estimate-${quoteId}`, estimate_number: "QT-HISTORICAL", status: "invoiced", customer_id: invoice.customer_id, currency_code: "SGD", invoice_ids: [invoice.invoice_id], total: 4390 }));
    mocks.payments.mockResolvedValue([{ payment_id: `payment-${quoteId}` }]);
    mocks.payment.mockResolvedValue({ payment_id: `payment-${quoteId}`, payment_number: "PAY-2365", customer_id: invoice.customer_id, payment_mode: "PayNow", account_id: "bank", amount: 2365, invoices: [{ invoice_id: invoice.invoice_id, amount_applied: 2365 }] });
    await sql`insert into public.customers(id,name,mobile,created_by) values(${customerId}::uuid,'Invoice flow test','90000000',${actor}::uuid)`.execute(db);
    await sql`insert into public.orders(id,customer_id,consultant_id,seq_year,seq_num,display_id,property_type,development,site_address,unit_type,price_quoted_cents,deposit_cents,freight_mode,channel,extra_install_sgd_cents,discount_bps,is_draft,product_line)
      values(${orderId}::uuid,${customerId}::uuid,${actor}::uuid,2026,${Math.floor(Math.random()*900000000)+100000000},'','HDB','Synthetic','1 Test Way','4-room',473000,236500,'air','standard',0,0,false,'curtain')`.execute(db);
    await sql`insert into public.order_status_events(order_id,status,note,created_by) values(${orderId}::uuid,'order_recorded','Synthetic invoice test',${actor}::uuid)`.execute(db);
    await sql`insert into public.order_quotations(id,order_id,revision,crm_quote_key,status,issue_date,lines,quoted_total_cents,zoho_contact_id,zoho_estimate_id,zoho_estimate_number,pdf_storage_path,pdf_sha256,created_by,updated_by)
      values(${quoteId}::uuid,${orderId}::uuid,1,${`test:${quoteId}`},'conflict','2026-11-01',${JSON.stringify([{ zohoItemId: "curtain", name: "Old curtain", description: "Historical", quantity: 1, rateCents: 439000, discountPercent: 0 }])}::jsonb,439000,${invoice.customer_id},${`estimate-${quoteId}`},'QT-HISTORICAL','historical.pdf','historical-hash',${actor}::uuid,${actor}::uuid)`.execute(db);
  });
  afterEach(async () => {
    if (orderId) await db.transaction().execute(async trx => {
      // Isolated, opt-in DB only; delete exactly this test's generated order.
      // Match the existing confirmed-admin cleanup mechanism for locked rows.
      await sql`select set_config('app.allow_locked_order_delete','on',true)`.execute(trx);
      await sql`delete from public.orders where id=${orderId}::uuid and customer_id=${customerId}::uuid`.execute(trx);
    });
    if (customerId) await sql`delete from public.customers where id=${customerId}::uuid`.execute(db);
  });
  afterAll(async () => { await db.destroy(); });
  const review = () => previewInvoiceReconciliation(orderId);
  const adopt = async () => { const r = await review(); await applyInvoiceReconciliation({ orderId, fingerprint: r.fingerprint, choice: "zoho", confirm: true }); };
  it("remote-only adoption persists, reloads and recovers4730/2365 without fake send or remote writes", async () => {
    expect((await review()).equal).toBe(false);
    await adopt();
    const reopened = await review();
    expect(reopened.synced).toBe(true);
    expect(reopened.crm?.totalCents).toBe(473000);
    expect((await loadCommercialSnapshot(orderId))?.state).toBe("synced");
    const quote = await db.selectFrom("order_quotations").selectAll().where("id", "=", quoteId).executeTakeFirstOrThrow();
    expect(quote.invoice_created_at).not.toBeNull();
    expect(quote).toMatchObject({ quoted_total_cents: 439000, pdf_storage_path: "historical.pdf", sent_at: null, status: "conflict" });
    await confirmInvoiceDeposit({ orderId, fingerprint: reopened.fingerprint, confirm: true });
    expect(await db.selectFrom("orders").select(["current_status", "price_quoted_cents", "deposit_cents"]).where("id", "=", orderId).executeTakeFirstOrThrow()).toEqual({ current_status: "deposit_received", price_quoted_cents: 473000, deposit_cents: 236500 });
    const events = await db.selectFrom("order_status_events").select("status").where("order_id", "=", orderId).execute();
    expect(events.map(e => e.status)).toEqual(["order_recorded", "deposit_received"]);
    const retry = await review(); await confirmInvoiceDeposit({ orderId, fingerprint: retry.fingerprint, confirm: true });
    expect((await db.selectFrom("order_status_events").select("status").where("order_id", "=", orderId).execute()).filter(e => e.status === "deposit_received")).toHaveLength(1);
    expect(mocks.convert).not.toHaveBeenCalled(); expect(mocks.createPayment).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it("shared legacy ensure gate rejects equal total different commercial items", async () => {
    await adopt(); invoice.line_items![0].name = "Different same-total item";
    await expect(ensureZohoInvoiceForOrder(orderId, { recoverExistingInvoice: true })).rejects.toThrow("items or totals differ");
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
  it("rejects stale CRM/remote reviews and preserves the historical quote", async () => {
    const r = await review(); invoice.line_items![0].description = "Changed remotely";
    await expect(applyInvoiceReconciliation({ orderId, fingerprint: r.fingerprint, choice: "zoho", confirm: true })).rejects.toThrow("changed");
    expect(await loadCommercialSnapshot(orderId)).toBeNull();
  });
  it("PUTs only same verified unpaid invoice and reconciles a lost response without repeating", async () => {
    await adopt(); invoice = { ...invoice, status: "sent", payment_made: 0, balance: 4730, line_items: [{ name: "Other invoice item", quantity: 1, rate: 4730, discount: "0%" }] };
    mocks.payments.mockResolvedValue([]);
    mocks.put.mockImplementation(async (id, lines) => { expect(id).toBe(invoice.invoice_id); invoice.line_items = lines; throw new Error("response lost"); });
    const r = await review(); expect(r.updateIssues).toEqual([]);
    await applyInvoiceReconciliation({ orderId, fingerprint: r.fingerprint, choice: "crm", confirm: true });
    expect(mocks.put).toHaveBeenCalledTimes(1); expect((await review()).synced).toBe(true);
    expect(mocks.convert).not.toHaveBeenCalled(); expect(mocks.createPayment).not.toHaveBeenCalled();
  });
  it("blocks paid source update before PUT", async () => { await adopt(); invoice.line_items![0].name = "Changed"; const r = await review(); await expect(applyInvoiceReconciliation({ orderId, fingerprint: r.fingerprint, choice: "crm", confirm: true })).rejects.toThrow("cannot safely"); expect(mocks.put).not.toHaveBeenCalled(); });
  it("direct skip remains prohibited without narrowly verified recovery", async () => { await expect(sql`insert into public.order_status_events(order_id,status,created_by) values(${orderId}::uuid,'deposit_received',${actor}::uuid)`.execute(db)).rejects.toThrow("invalid status transition"); });
  it("shows no invoice normally and prohibits creation recovery from Order Recorded", async () => {
    mocks.estimate.mockResolvedValue({ estimate_id: `estimate-${quoteId}`, estimate_number: "QT-1", status: "sent", customer_id: invoice.customer_id, currency_code: "SGD", invoice_ids: [] });
    const r = await review(); expect(r.hasInvoice).toBe(false); expect(r.canConfirmDeposit).toBe(false);
    await expect(confirmInvoiceDeposit({ orderId, fingerprint: r.fingerprint, confirm: true })).rejects.toThrow("Refresh the quotation review");
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it("normal no-invoice path validates the sent quotation then creates once", async () => {
    const lines = [{ item_id: "curtain", name: "Current curtain", description: "Approved invoice", quantity: 1, rate: 4730, discount: "0%" }];
    const remote = { estimate_id: `estimate-${quoteId}`, estimate_number: "QT-1", status: "sent", customer_id: invoice.customer_id, currency_code: "SGD", invoice_ids: [] as string[], total: 4730, date: "2026-11-01", line_items: lines };
    mocks.estimate.mockImplementation(async () => structuredClone(remote));
    invoice = { ...invoice, status: "sent", payment_made: 0, balance: 4730 };
    await sql`update public.order_quotations set status='sent',sent_at=now(),sent_by=${actor}::uuid,sent_channel='Synthetic test',lines=${JSON.stringify([{zohoItemId:"curtain",name:"Current curtain",description:"Approved invoice",quantity:1,rateCents:473000,discountPercent:0}])}::jsonb,quoted_total_cents=473000,synced_payload_hash=${estimateSnapshotHash(remote as unknown as Record<string, unknown>)} where id=${quoteId}::uuid`.execute(db);
    await sql`insert into public.order_status_events(order_id,status,created_by) values(${orderId}::uuid,'quotation_sent',${actor}::uuid)`.execute(db);
    mocks.convert.mockImplementation(async () => { remote.invoice_ids=[invoice.invoice_id]; return {invoice_id:invoice.invoice_id}; });
    mocks.payments.mockResolvedValue([]);
    mocks.createPayment.mockImplementation(async () => { invoice.payment_made=2365;invoice.balance=2365;return {payment_id:`payment-${quoteId}`}; });
    const r=await review();expect(r.hasInvoice).toBe(false);expect(r.canConfirmDeposit).toBe(true);
    await confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true});
    expect(mocks.convert).toHaveBeenCalledTimes(1);expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    expect((await db.selectFrom("orders").select("current_status").where("id","=",orderId).executeTakeFirstOrThrow()).current_status).toBe("deposit_received");
  });
  it("blocks hidden allocations and rechecks CRM after slow payment lookup before PUT", async () => {
    await adopt(); invoice={...invoice,status:"sent",payment_made:0,balance:4730,line_items:[{name:"Different",quantity:1,rate:4730}]};
    let r=await review();
    await expect(applyInvoiceReconciliation({orderId,fingerprint:r.fingerprint,choice:"crm",confirm:true})).rejects.toThrow("allocations");
    expect(mocks.put).not.toHaveBeenCalled();
    await adopt(); invoice.line_items=[{name:"Another",quantity:1,rate:4730}];
    mocks.payments.mockImplementation(async()=>{await sql`update public.orders set deposit_cents=240000 where id=${orderId}::uuid`.execute(db);return [];});
    r=await review();
    await expect(applyInvoiceReconciliation({orderId,fingerprint:r.fingerprint,choice:"crm",confirm:true})).rejects.toThrow("CRM changed");
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("allows consultant review but forbids source mutations and deposit confirmation", async () => {
    mocks.session.mockResolvedValue({user:{id:actor},profile:{role:"consultant"}});
    const r=await review();expect(r.operator).toBe(false);expect(r.admin).toBe(false);
    await expect(applyInvoiceReconciliation({orderId,fingerprint:r.fingerprint,choice:"zoho",confirm:true})).rejects.toThrow("Only an admin");
    await expect(confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true})).rejects.toThrow("Forbidden");
    expect(await loadCommercialSnapshot(orderId)).toBeNull();
  });
  it("keeps later financial stages read-only", async () => {
    await adopt();let r=await review();await confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true});
    await sql`insert into public.order_status_events(order_id,status,created_by) values(${orderId}::uuid,'po_ready',${actor}::uuid)`.execute(db);
    r=await review();expect(r.sourceAllowed).toBe(false);expect(r.canConfirmDeposit).toBe(false);
    await expect(applyInvoiceReconciliation({orderId,fingerprint:r.fingerprint,choice:"zoho",confirm:true})).rejects.toThrow("read-only");
  });
  it("serializes duplicate applies with one audit record", async () => {
    const r=await review();const input={orderId,fingerprint:r.fingerprint,choice:"zoho",confirm:true};
    const results=await Promise.allSettled([applyInvoiceReconciliation(input),applyInvoiceReconciliation(input)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const events=await sql<{count:string}>`select count(*)::text as count from public.order_invoice_commercial_events where order_id=${orderId}::uuid`.execute(db);expect(events.rows[0].count).toBe("1");
  });
  it("uncertain payment recovery remains reachable and reuses an existing payment", async () => {
    await adopt();await sql`update public.order_quotations set payment_sync_state='uncertain',payment_uncertain_at=now() where id=${quoteId}::uuid`.execute(db);
    const r=await review();expect(r.busy).toBe(false);expect(r.mutationBlocked).toBe(true);expect(r.canConfirmDeposit).toBe(true);
    await confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true});
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect((await db.selectFrom("orders").select("current_status").where("id","=",orderId).executeTakeFirstOrThrow()).current_status).toBe("deposit_received");
  });
  it("uncertain payment plus mismatched items can adopt verified Zoho details then safely reuse payment", async () => {
    await sql`update public.order_quotations set payment_sync_state='uncertain',payment_uncertain_at=now() where id=${quoteId}::uuid`.execute(db);
    const before=await review();expect(before.equal).toBe(false);expect(before.mutationBlocked).toBe(true);
    await applyInvoiceReconciliation({orderId,fingerprint:before.fingerprint,choice:"zoho",confirm:true});
    expect((await db.selectFrom("order_quotations").select("payment_sync_state").where("id","=",quoteId).executeTakeFirstOrThrow()).payment_sync_state).toBe("uncertain");
    const after=await review();await confirmInvoiceDeposit({orderId,fingerprint:after.fingerprint,confirm:true});
    expect(mocks.createPayment).not.toHaveBeenCalled();expect(mocks.put).not.toHaveBeenCalled();
  });
  it.each(["void","link"])('rejects final invoice status/link change after payment verification (%s)',async change=>{
    await adopt();let reads=0;
    mocks.payment.mockImplementation(async()=>{if(++reads>=2){if(change==="void")invoice.status="void";else mocks.estimate.mockResolvedValue({estimate_id:`estimate-${quoteId}`,status:"invoiced",customer_id:invoice.customer_id,currency_code:"SGD",invoice_ids:["different"]});}return {payment_id:`payment-${quoteId}`,customer_id:invoice.customer_id,payment_mode:"PayNow",account_id:"bank",amount:2365,invoices:[{invoice_id:invoice.invoice_id,amount_applied:2365}]};});
    const r=await review();await expect(confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true})).rejects.toThrow("status or quotation link changed");
    expect((await db.selectFrom("orders").select("current_status").where("id","=",orderId).executeTakeFirstOrThrow()).current_status).toBe("order_recorded");
  });
  it("same-total item drift during payment lookup prevents payment creation", async () => {
    await adopt();invoice={...invoice,status:"sent",payment_made:0,balance:4730};
    let lookups=0;mocks.payments.mockImplementation(async()=>{if(++lookups===2)invoice.line_items![0].name="Changed while looking up payment";return [];});
    const r=await review();await expect(confirmInvoiceDeposit({orderId,fingerprint:r.fingerprint,confirm:true})).rejects.toThrow("commercial items changed");
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
  it.skipIf(process.env.INVOICE_FLOW_UI !== "1")("serves actual invoice panel and database actions for browser QA", async () => {
    const { createServer } = await import("node:http");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { build } = await import("esbuild");
    const directory = "/tmp/drapeworks-full-invoice-flow/browser";
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory,"actions.ts"), `async function call(method:string,input:unknown){return fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,input})}).then(r=>r.json());} export const previewInvoiceReconciliationUi=(id:string)=>call('preview',id);export const applyInvoiceReconciliationUi=(input:unknown)=>call('apply',input);export const confirmInvoiceDepositUi=(input:unknown)=>call('deposit',input);`);
    await fs.writeFile(path.join(directory,"navigation.ts"), `export const useRouter=()=>({refresh:()=>window.dispatchEvent(new Event('fixture-refresh'))});`);
    await fs.writeFile(path.join(directory,"entry.tsx"), `import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{InvoiceReconciliationPanel}from'@/components/orders/invoice-reconciliation-panel';function App(){const[fixture,setFixture]=useState<any>(null);useEffect(()=>{const load=()=>fetch('/fixture').then(r=>r.json()).then(setFixture);load();window.addEventListener('fixture-refresh',load);return()=>window.removeEventListener('fixture-refresh',load);},[]);return <main className="mx-auto max-w-5xl p-4"><p className="mb-4 text-sm">Local Postgres fixture · actual server actions · mocked Zoho and auth · no live writes</p>{fixture&&<InvoiceReconciliationPanel orderId={fixture.orderId} hasInvoice={fixture.hasInvoice} snapshot={fixture.snapshot}/>}<Toaster/></main>};createRoot(document.getElementById('root')!).render(<App/>);`);
    await build({ entryPoints:[path.join(directory,"entry.tsx")],outfile:path.join(directory,"app.js"),bundle:true,jsx:"automatic",platform:"browser",nodePaths:[path.join(process.cwd(),"node_modules")],alias:{"@":path.join(process.cwd(),"src"),"@/lib/actions/invoice-reconciliation":path.join(directory,"actions.ts"),"next/navigation":path.join(directory,"navigation.ts")},define:{"process.env.NODE_ENV":'"development"'} });
    let done!:()=>void;const finished=new Promise<void>(resolve=>{done=resolve;});
    const server=createServer(async(request,response)=>{try{
      response.setHeader("cache-control","no-store");
      if(request.url==="/finish"){response.end("done");done();return;}
      if(request.url==="/fixture"){const snapshot=await loadCommercialSnapshot(orderId);response.setHeader("content-type","application/json");response.end(JSON.stringify({orderId,hasInvoice:true,snapshot:snapshot?{document:snapshot.document,state:snapshot.state,invoiceId:snapshot.invoice_id}:null}));return;}
      if(request.url==="/action"){let body="";for await(const chunk of request){body+=chunk;if(body.length>10000)throw new Error("Request too large");}const parsed=JSON.parse(body);let data;try{if(parsed.method==="preview")data=await previewInvoiceReconciliation(orderId);else if(parsed.method==="apply")data=await applyInvoiceReconciliation({...parsed.input,orderId});else if(parsed.method==="deposit")data=await confirmInvoiceDeposit({...parsed.input,orderId});else throw new Error("Unknown fixture action");response.end(JSON.stringify({ok:true,data:data??null}));}catch(error){response.end(JSON.stringify({ok:false,error:error instanceof Error?error.message:"Action failed"}));}return;}
      if(request.url==="/app.js"){response.setHeader("content-type","text/javascript");response.end(await fs.readFile(path.join(directory,"app.js")));return;}
      if(request.url==="/app.css"){response.setHeader("content-type","text/css");response.end(await fs.readFile("/tmp/drapeworks-invoiced-reconcile/preview/app.css"));return;}
      response.setHeader("content-type","text/html");response.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }catch(error){response.statusCode=500;response.end(String(error));}});
    await new Promise<void>(resolve=>server.listen(4318,"127.0.0.1",resolve));
    console.log("ACTUAL DB BROWSER FIXTURE http://127.0.0.1:4318 ; visit /finish to clean up",orderId);
    try{await finished;}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }, 3600000);
  it("source adoption below deposit is rejected without persisting", async () => { invoice.total=2000; invoice.line_items=[{name:"Low",quantity:1,rate:2000}]; const r=await review(); await expect(applyInvoiceReconciliation({orderId,fingerprint:r.fingerprint,choice:"zoho",confirm:true})).rejects.toThrow("below"); expect(await loadCommercialSnapshot(orderId)).toBeNull(); });
});

// Optional browser fixture: actual React component -> actual server actions ->
// real disposable Postgres. Only Zoho/auth are mocked above. No app test route.
describe.skipIf(!enabled || process.env.INVOICE_FLOW_UI !== "1")("browser fixture prerequisite", () => {
  it("uses the main fixture suite via the serves-actual test", () => { expect(enabled).toBe(true); });
});
