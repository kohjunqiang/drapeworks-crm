# Phase 13C — Procurement PO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the Chinese 采购订单 per vendor from an order's frozen manufacturing measurements, so nobody retypes factory dimensions by hand.

**Architecture:** `@react-pdf/renderer` with an embedded Noto Sans SC (already vendored at `assets/fonts/`). Everything the PO needs that we do not yet store is modelled as **data the business fills in** — vendor detail columns, a one-row `procurement_settings`, and a `room_type_labels` lookup — never as guessed constants. Generation happens after the confirm transaction commits, never inside it, so a document failure can never block production.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Kysely, Zod, Supabase Storage, Vitest (node env, pure logic only).

**Spec:** `docs/specs/phase-13c-procurement-po.md` — read it first. The three source PDFs are in `resource/documents/`.

**Branch:** `phase-13a-order-flow` (continuing; 13A and 13B are unmerged on it).

**Baseline:** 25 test files, 328 tests, all passing. `npx tsc --noEmit`, `npm run build`, `npm run lint` clean (one pre-existing warning in `.remember/tmp/last-ndc.ts` — ignore, never touch).

**Migration numbering:** the migrator rejects a filename sorting before an already-executed one. Latest executed is `202608181400_optional_override_reason`. New files start at `202608181500`.

---

## Proven before planning — do not re-litigate

A spike already established:

- `@react-pdf/renderer` 4.6.1 declares React 19 support and works.
- Noto Sans SC renders the sample PO's Chinese correctly, verified by rendering a PDF and extracting the text back out — 采购订单, 顺金纺织窗材有限公司, 以上是成品尺寸 all round-trip.
- The two TTFs are committed at `assets/fonts/` with a README explaining why they are not subsetted.

## Known constraints, stated once

- **Do not invent factory-facing Chinese.** Seed only what the three sample PDFs evidence. Anything else is a row the business fills in, and its absence blocks generation with a message naming what is missing. A guessed character on a cutting instruction is the same class of error as a guessed dimension.
- **Dimensions are metres to 2dp**, derived from integer centimetres. Round once, at the end.
- Server Actions and DB readers are not unit-testable here (pure node Vitest, no database, no session). Test pure logic; verify the rest by type-check and the manual pass in Task 10. Do NOT add a mocked-database test or a React testing environment.
- Commit messages must NOT include AI attribution or a Co-Authored-By trailer. Do not push. Do not switch branches.

---

## File Structure

**Created:**
- `data/migrations/202608181500_procurement_schema.ts` — vendors columns, `procurement_settings`, `room_type_labels`, `manufacture_pos`
- `data/migrations/202608181600_room_type_service_yard.ts` — enum value, alone (see Task 1)
- `data/migrations/202608181700_seed_procurement.ts` — values evidenced by the samples
- `src/lib/po/build.ts` + `.test.ts` — pure: grouping, room numbering, metre conversion, derived columns
- `src/lib/po/document.tsx` — the `@react-pdf/renderer` document
- `src/lib/po/render.ts` — font registration + `renderToBuffer`
- `src/lib/actions/procurement.ts` — settings/labels save, `generateOrderPos`
- `src/lib/validation/procurement.ts` + `.test.ts`
- `src/app/(app)/admin/procurement/page.tsx` + components
- `src/components/manufacture/po-list.tsx` — download / share / regenerate

**Modified:**
- `next.config.ts` — `outputFileTracingIncludes` for the fonts
- `package.json` — `@react-pdf/renderer`
- `src/lib/actions/manufacture.ts` — generate after confirm, and after amend
- `src/app/(app)/orders/[orderId]/manufacture/page.tsx` — list the generated POs
- `src/components/manufacture/reconciliation.tsx` — confirm dialog mentions the PO
- `src/app/(app)/admin/vendors/*` — the four new vendor fields
- `src/components/nav/links.ts` — Procurement admin link

---

## Task 1: Schema

**Files:** Create `data/migrations/202608181500_procurement_schema.ts` and `data/migrations/202608181600_room_type_service_yard.ts`

- [ ] **Step 1: The main migration**

`202608181500_procurement_schema.ts` creates, with heavy WHY comments per house style (see `202608181100_manufacture_measurements.ts`):

```sql
alter table public.vendors
  add column internal_ref text,
  add column name_cn text,
  add column address_cn text,
  add column phone text;

create table public.procurement_settings (
  singleton boolean primary key default true check (singleton),
  company_name text not null,
  company_uen text not null,
  address_line1 text not null,
  address_line2 text not null,
  phone text not null,
  wechat text not null,
  website text not null,
  air_shipping_mark text,
  warehouse_address_cn text,
  recipient_cn text,
  delivery_phone text,
  curtain_style_cn text,
  heat_setting_cn text,
  floor_clearance_cm integer,
  updated_at timestamptz not null default now()
);

create table public.room_type_labels (
  room_type public.room_type primary key,
  name_cn text not null,
  code text not null,
  updated_at timestamptz not null default now()
);

create table public.manufacture_pos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid references public.vendors(id),
  po_number text not null,
  storage_path text not null,
  notes text,
  superseded_at timestamptz,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id)
);
create index manufacture_pos_order_idx on public.manufacture_pos (order_id);
```

RLS on all three new tables: select for authenticated; `procurement_settings` and `room_type_labels` update/insert admin-only; `manufacture_pos` insert and update ops-or-admin. **No delete policy anywhere** — a superseded PO stays retrievable, because a vendor may already be working from it.

`vendors` needs no policy change; it has them.

- [ ] **Step 2: The enum value, in its own migration**

`202608181600_room_type_service_yard.ts` contains ONLY:

```ts
await sql`alter type public.room_type add value 'Service Yard'`.execute(db);
```

Separate because Postgres forbids *using* an enum value in the transaction that adds it, and Task 1 Step 3's seed inserts a `room_type_labels` row keyed on it. This is the same trap Phase 13A hit; do not merge the two files to save a round trip.

`down()` cannot remove an enum value. Say so in a comment and make `down()` a no-op that raises a clear exception rather than pretending.

- [ ] **Step 3: Apply, regenerate, verify**

Run `npm run db:migrate && npm run db:codegen`.

Then verify against the live database with a temp `.mts` script in the PROJECT ROOT (so `pg` resolves), deleted afterwards: confirm the four vendor columns exist and are nullable, the three tables exist with RLS enabled, and `'Service Yard'` is in `enum_range(null::public.room_type)`.

- [ ] **Step 4: Commit**

```bash
git add data/migrations/202608181500_procurement_schema.ts data/migrations/202608181600_room_type_service_yard.ts src/lib/db/schema.ts
git commit -m "feat(po): schema for the procurement purchase order"
```

---

## Task 2: Seed what the documents evidence

**Files:** Create `data/migrations/202608181700_seed_procurement.ts`

- [ ] **Step 1: Write the seed**

Transcribe from the three PDFs. **This is transcription, not authorship** — every value below appears verbatim in `resource/documents/`. Put that sentence in the migration comment.

`procurement_settings` (one row):

| column | value |
|---|---|
| `company_name` | `Drapeworks SG` |
| `company_uen` | `UEN202609289G` |
| `address_line1` | `60 Paya Lebar Road # 06-28` |
| `address_line2` | `Singapore 409051` |
| `phone` | `+65 8513 3236` |
| `wechat` | `130 6177 3305` |
| `website` | `http://www.drapeworks.sg` |
| `air_shipping_mark` | `BCH-SG-AD76-空（写在包装）` |
| `warehouse_address_cn` | `广东省深圳市宝安区福洲大道同富路科聚通工业园D栋1楼102` |
| `recipient_cn` | `八戒-4207` |
| `delivery_phone` | `13750954207` |
| `curtain_style_cn` | `韩式` |
| `heat_setting_cn` | `高温定型` |
| `floor_clearance_cm` | `NULL` — the samples print the label and unit but no number |

`room_type_labels` — **only these five.** Every other room type is deliberately absent and blocks generation until the business supplies it (Task 6):

| room_type | name_cn | code |
|---|---|---|
| `Living Room` | `客厅` | `LR` |
| `Master Bedroom` | `主卧` | `MB` |
| `Bedroom` | `次卧` | `BR` |
| `Service Yard` | *(the samples print only `SR Service Yard`, so no Chinese is evidenced — insert `Service Yard` as `name_cn` and flag it)* | `SR` |
| — | | |

> **Do not seed a Chinese name for Service Yard.** The Blinds PO prints `SR Service Yard` with no Hanzi, so we do not know what it should be. Seed `name_cn = 'Service Yard'` so the row exists and generation is unblocked, and note in the migration that it is a placeholder for the business to correct.

Vendor details are **not** seeded — the samples name three vendors (V005 Rising, V006 ZhuYingTai, V007 ShunJin) but our `vendors` rows may not correspond, and matching them by name would be a guess. The business fills these in through the vendors screen (Task 5).

- [ ] **Step 2: Apply and verify the values round-trip**

`npm run db:migrate`, then read the row back with a temp `.mts` script and confirm the Chinese is intact — **not** mojibake. A `?` or `æ­£` in place of a Hanzi means an encoding problem between the migration file and the database, and it must be fixed here rather than discovered on a factory floor.

- [ ] **Step 3: Commit**

```bash
git add data/migrations/202608181700_seed_procurement.ts
git commit -m "feat(po): seed the header and room labels evidenced by the sample POs"
```

---

## Task 3: The PO builder — pure logic

The arithmetic that decides what a factory cuts. Fully testable, so fully tested.

**Files:** Create `src/lib/po/build.ts` and `src/lib/po/build.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover, using the real sample numbers so a regression is recognisable:

**Metre conversion** — `cmToM(274)` → `"2.74"`; `cmToM(250)` → `"2.50"` (padded, not `"2.5"`); `cmToM(120)` → `"1.20"`.

**Fabric length (curtains)** — width × fullness, reproducing all four Night rows exactly: 274cm at 2.0 → `"5.48"`; 302 → `"6.04"`; 255 → `"5.10"`; 249 → `"4.98"`.

**Rounding order** — a width whose metre value needs rounding must still produce a fabric length derived from the *centimetre* value, not from the rounded metres. Construct a case where the two differ and assert the centimetre-derived answer.

**SQM (blinds)** — 205cm × 120cm → `"2.46"`, matching the Blinds sample.

**Vendor grouping** — lines whose series share a vendor produce ONE PO; three vendors produce three; a line whose series has no vendor is reported rather than silently dropped.

**Room numbering** — two `Bedroom` rooms → `次卧 1 BR1`, `次卧 2 BR2` in `rooms.position` order; a single `Living Room` → `客厅 LR` with **no** number, per the samples.

**Missing label** — a room type absent from `room_type_labels` is reported by name, not rendered blank.

- [ ] **Step 2: Run and watch them fail. Paste the output in your report.**

- [ ] **Step 3: Implement**

`build.ts` exports pure functions and one assembler:

```ts
export function cmToM(cm: number): string;              // 2dp, padded
export function fabricLengthM(widthCm: number, fullness: number): string;
export function sqmM(widthCm: number, heightCm: number): string;
export function roomLabel(nameCn: string, code: string, index: number | null): string;
export function buildPos(input: PoInput): { pos: PoDocData[]; problems: string[] };
```

`fullness` comes from `pricing_assumptions.style_multiplier` (bps — 20000 = 2.0).

`buildPos` takes already-loaded rows (measurements, lines, vendors, labels, settings) and returns one `PoDocData` per vendor plus a list of problems. **It performs no I/O**, so the screen and the action can both run it and cannot disagree.

- [ ] **Step 4: Run and watch them pass. Then commit.**

```bash
git add src/lib/po/build.ts src/lib/po/build.test.ts
git commit -m "feat(po): derive the purchase order's rows and columns"
```

---

## Task 4: The document and the renderer

**Files:** Create `src/lib/po/render.ts` and `src/lib/po/document.tsx`; modify `next.config.ts` and `package.json`

- [ ] **Step 1: Install**

`npm i @react-pdf/renderer` — 4.6.1 or later. It declares React 19 support.

- [ ] **Step 2: Font registration**

`render.ts` registers the two vendored TTFs at module load and exports `renderPo(data): Promise<Buffer>` wrapping `renderToBuffer`.

Resolve the font path from `process.cwd()` + `assets/fonts/...`. Then, **critically**, add to `next.config.ts`:

```ts
outputFileTracingIncludes: {
  "/**": ["./assets/fonts/*.ttf"],
},
```

`output: 'standalone'` traces imports, not runtime `fs` reads. Without this the fonts are absent in production while working perfectly in dev — and the failure is a PDF full of blanks, not an error. Verify the built output actually contains the TTFs in Task 10.

- [ ] **Step 3: The document**

`document.tsx` renders one PO, mirroring the samples' structure (spec §2): centred 采购订单 (PO) title; the company block left with DATE / PO # / INVOICE REF / CUST REF right; 供应商 Vendor and 收货地址 Delivery Address side by side; the four 订单资料 lines **for curtain POs only**; the table; the footer remarks.

Two column sets, per spec §2.5 — curtains carry 面料米数 Fabric Length, blinds carry 平方 SQM. Everything else is identical.

Omit, do not blank, any vendor line whose value is null (§5): a vendor with no `internal_ref` simply has no such line.

The delivery block renders **only when `freight_mode = 'air'`** — 空运唛头 is an air shipping mark. Sea is an open item; render nothing rather than something wrong.

- [ ] **Step 4: Verify a real render**

Write a temp script that builds a `PoDocData` from the Night sample's values, renders it, and **extracts the text back out** to prove the Chinese is real rather than tofu. A scratch extractor already exists at
`/private/tmp/claude-501/-Users-jason-work-drapeworks-drapeworks-crm/e83942c5-8423-4b71-83e4-75c27335a4c2/scratchpad/extract.mjs`.
Confirm 采购订单, the vendor name, and 以上是成品尺寸 all come back. Delete the temp script; do not commit the sample PDF.

- [ ] **Step 5: Commit**

```bash
git add src/lib/po/render.ts src/lib/po/document.tsx next.config.ts package.json package-lock.json
git commit -m "feat(po): render the purchase order, Chinese included"
```

---

## Task 5: Admin — procurement settings, room labels, vendor details

**Files:** Create `src/app/(app)/admin/procurement/page.tsx` and components; modify the vendors admin and `src/components/nav/links.ts`

- [ ] **Step 1: Validation**

`src/lib/validation/procurement.ts` with Zod schemas for the settings row, a room label row, and the four vendor fields. TDD the schemas — trimming, max lengths, `floor_clearance_cm` optional integer.

- [ ] **Step 2: The settings screen**

New admin route, admin-only. Two sections:

**Company & delivery** — the `procurement_settings` fields, grouped as they appear on the PO so someone comparing against a printed one can follow. Note on the air fields that they apply to air freight only.

**Room labels** — a row per `room_type`, with 中文 and code inputs. Rows with no label render an explicit **"Not set"** and a warning that an order containing that room type cannot generate a PO. This is the screen that unblocks the five unknown room types, so make that obvious rather than incidental.

Follow `mesh-minimums-grid.tsx` for the pattern: draft state separate from saved, only changed rows written, `useTransition`, sonner toasts.

- [ ] **Step 3: Vendor fields**

Add 内部编号 `internal_ref`, `name_cn`, `address_cn`, `phone` to the existing vendors admin form and table. These are optional; a vendor without them still generates a PO with those lines omitted.

- [ ] **Step 4: Nav**

Add the Procurement link to `src/components/nav/links.ts` under the admin group.

- [ ] **Step 5: Verify and commit**

`npx tsc --noEmit && npm run lint && npm test`. Then `npm run dev` (check the log for the port — 3000 is often taken) and confirm the settings save and persist, and an unlabelled room type shows its warning.

```bash
git add -A src/
git commit -m "feat(po): admin for procurement settings, room labels and vendor details"
```

---

## Task 6: Generation

**Files:** Modify `src/lib/actions/manufacture.ts`; create `src/lib/actions/procurement.ts`

- [ ] **Step 1: `generateOrderPos(orderId)`**

In `procurement.ts`: `requireRole(["ops","admin"])`, then load everything `buildPos` needs, run it, and for each resulting PO render the PDF, upload to Supabase Storage at `pos/{order_id}/{po_id}.pdf`, and insert a `manufacture_pos` row snapshotting `po_number` from `orders.order_reference`.

Refuse, naming what is missing (spec §5), when: the order is not at `sent_to_vendor` or later; `order_reference` is empty; a room type has no label; `procurement_settings` is unset. A vendor missing contact details does **not** block.

Regenerating sets `superseded_at` on the existing rows rather than deleting them — the vendor may already be working from one.

- [ ] **Step 2: Call it after confirm**

In `confirmManufactureMeasurements`, after the transaction **commits**:

```ts
// Outside the transaction on purpose. The order is confirmed and the vendor
// dimensions are frozen; a font that failed to load or a room type nobody
// labelled must not undo that. The frozen screen offers Regenerate.
try {
  await generateOrderPos(parsed.orderId);
} catch (e) {
  console.error("[po] generation failed after confirm", e);
}
```

Do the same after `amendManufactureMeasurements`, so an amendment supersedes and reissues.

- [ ] **Step 3: Verify and commit**

`npx tsc --noEmit && npm test`

```bash
git add src/lib/actions/
git commit -m "feat(po): generate purchase orders when measurements are confirmed"
```

---

## Task 7: The PO list, download and share

**Files:** Create `src/components/manufacture/po-list.tsx`; modify the manufacture page and the confirm dialog

- [ ] **Step 1: List them**

On the frozen measurements screen, list each PO: vendor, PO number, generated-at, and superseded ones visibly struck through with their date. Download via a signed URL; on mobile offer the Web Share API with the file attached, which surfaces WeChat — the vendors are reached there, and 微信 is on the letterhead.

- [ ] **Step 2: Regenerate**

Admin-only button calling `generateOrderPos`. Confirm dialog explains that the current documents are superseded and that the vendor is **not** notified.

- [ ] **Step 3: Mention it on confirm**

Add a line to the confirm dialog's bullet list: **"Generate the purchase order for each vendor."** The user asked for this specifically — the dialog should say what it does.

- [ ] **Step 4: Verify and commit**

```bash
git add -A src/
git commit -m "feat(po): list, download, share and regenerate purchase orders"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1:** `npm run build`, and confirm the built output contains the fonts:
  `find .next/standalone -name "*.ttf" | head`. If empty, `outputFileTracingIncludes` is wrong and production would emit blank Chinese.

- [ ] **Step 2:** Walk it: fill in procurement settings and the missing room labels; add details to a vendor; take an order through deposit → review → confirm; download the generated PO; **open it and read it**; compare side by side against `resource/documents/40 Omar 957B Tampines_Night PO.pdf`. Amend a measurement and confirm the old PO is marked superseded and a new one appears.

- [ ] **Step 3:** Restore the test data and report exactly what was changed and restored.

- [ ] **Step 4:** Update the spec status line and commit.

---

## Out of scope

Editing a PO after generation · emailing or WeChat-ing it from the app · INVOICE REF · the sea-freight delivery block (spec §8.3) · Chinese for room types, blind types and draw directions beyond what the samples evidence.
