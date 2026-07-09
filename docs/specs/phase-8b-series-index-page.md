# Phase 8b — Curtain-type **series**, running **index**, and **page**

> Extends Phase 8 (curtain-type catalog). Adds three attributes that mirror the
> physical sample-book system: a managed **series** (collection), an
> auto-assigned running **index** number within each series, and a **page**
> reference that starts with `P`. Additive and non-destructive.

## Goal

Let admins group curtain types by **series** (their "physical category"),
number them with a **running index per series** (Series A → 1,2,3; Series B →
1,2,3), and record the sample-book **page** (`P12`, `P12a`, …). Surface these in
the admin catalogue, the consultation-form picker, and the order detail so a
consultant can identify a curtain by series/number/page on-site.

## Decisions (from brainstorming — flag if any are wrong)

- **Series = admin-managed list** (`curtain_series` table), not free text. Names
  recur across many curtain types; a managed list keeps them consistent and lets
  the running index key off a stable id.
- **Series is required** on a curtain type (Zod-required; DB column nullable so
  save-before-assign / future backfill stays possible).
- **Index = auto-assigned per series**, `max(index)+1` within the series at
  creation. **Not** reshuffled on archive. If an admin **changes** a type's
  series on edit, it gets a fresh next-index in the new series (the old sequence
  keeps its gap — stable references win over gapless sequences).
- **Page = optional free text, validated to start with `P`** when present
  (allows `P12a`, `P-3`). Stored as typed.
- **Series management** lives in a small "Manage series" dialog on the catalogue
  page (add / rename / archive). Inline "+ new series" in the curtain-type form
  is a future nicety, out of scope for v1.

## Data model

New migration `data/migrations/YYYYMMDDHHMM_curtain_series.ts` (Kysely, UTC ts).

```ts
// curtain_series — mirrors the fabrics/curtain_types RLS pattern.
await db.schema.createTable("curtain_series")
  .addColumn("id", "uuid", c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn("name", "text", c => c.notNull())
  .addColumn("is_active", "boolean", c => c.notNull().defaultTo(true)) // soft archive
  .addColumn("created_by", "uuid", c => c.references("profiles.id"))
  .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .execute();
// case-insensitive unique name (no duplicate series)
await sql`create unique index curtain_series_name_unique on public.curtain_series (lower(name))`.execute(db);
// updated_at trigger (reuse public.set_updated_at)

// curtain_types additions (additive, nullable)
await db.schema.alterTable("curtain_types")
  .addColumn("series_id", "uuid", c => c.references("curtain_series.id"))
  .addColumn("series_index", "integer")
  .addColumn("page", "text")
  .execute();
// integrity: one index per slot within a series
await sql`create unique index curtain_types_series_index_unique
          on public.curtain_types (series_id, series_index)
          where series_id is not null and series_index is not null`.execute(db);
```

RLS on `curtain_series`: authenticated read; admin insert/update (mirror
`curtain_types`). No delete policy — archive via `is_active`.

`down()`: drop the curtain_types columns + unique index, drop `curtain_series`.

After migrating: `npm run db:codegen`.

## Pure logic (TDD)

- `nextSeriesIndex(existing: number[]): number` — `max+1`, or `1` when empty.
- `curtainTypeSchema` (extend): `series_id` required uuid; `page` optional,
  `/^P/i` when non-empty.
- `curtainSeriesSchema`: `{ isNew, id?, name(1..120), is_active? }`.
- `formatCurtainOptionLabel({ series, index, page, label })` → e.g.
  `"Alfa #12 · P30 — Sheer Ivory"` (omit missing parts gracefully). Used by the
  consultation-form dropdown and order detail.

## Server actions — `src/lib/actions/curtain-series.ts` + extend `curtain-types.ts`

- `upsertCurtainSeries(input)` — admin; insert/rename; friendly "series already
  exists" on the unique-name violation.
- `toggleCurtainSeriesActive(id)` — admin; flip `is_active` (soft archive).
- `upsertCurtainType` (extend) — assign `series_index` inside the insert/update
  **transaction**: `nextSeriesIndex` over existing indexes for that series. On
  edit, only recompute when `series_id` changed. The `(series_id, series_index)`
  unique index is the backstop against a concurrent-add race → friendly retry
  message.

## UI

- **Catalogue page** (`/admin/digital-catalogue`): load series (active) + counts;
  add a "Manage series" button → `curtain-series-dialog` (list + add/rename +
  archive). Table gains **Series**, **#** (index), **Page** columns and a series
  filter.
- **Curtain-type form dialog**: add **Series** dropdown (active series; required)
  and **Page** text input (placeholder `P12`). Index is auto — shown read-only on
  edit, hidden on add.
- **Consultation form** (`window-fields.tsx`): dropdown option text uses
  `formatCurtainOptionLabel`; the loader (`loadActiveCurtainTypeOptions`) selects
  `series name, series_index, page` via a join.
- **Order detail** (`room-summary-card.tsx`): show series/#/page next to the
  curtain label.

## Task order

1. Migration + `db:codegen`.
2. TDD: `nextSeriesIndex`, schema additions, `curtainSeriesSchema`,
   `formatCurtainOptionLabel`.
3. Actions: `curtain-series.ts`; extend `upsertCurtainType` for index assignment.
4. Admin UI: series dialog; extend curtain-type form + table.
5. Consultation form dropdown label + loader join; order-detail display.
6. Verify: `npm run build`, `npm run lint`, `vitest`; then live Playwright check
   (add series, add types → auto index per series, page validation, dropdown
   label, archive).

## Verification

- Two series each get an independent `1,2,3…` index sequence.
- Page rejects a value not starting with `P`; accepts `P12`, `P12a`; empty is OK.
- Changing a type's series on edit reassigns its index in the new series.
- Archived series don't appear in the form dropdown or new-assignment dropdown;
  existing types keep their series reference.
- Consultation dropdown + order detail show `series #index · page — label`.
- Non-admin: `curtain-series` actions rejected; RLS `is_admin()` denies writes.
