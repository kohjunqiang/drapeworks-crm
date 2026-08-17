# Drapeworks CRM — Implementation Specs

This folder contains one spec file per implementation phase. Each spec is **self-contained**: a fresh Claude Code session reading only that spec (plus the prototype HTML files it references) should be able to execute the phase end-to-end without further design questions.

## Project summary

Drapeworks is a curtain company in Singapore. This CRM gives:

- **Sales consultants** a mobile-friendly form to capture customer details and measurements on-site (rooms, windows, curtain/blind/mesh selections, photos)
- **Ops** a way to advance fulfilment status as orders move through logistics
- **Admins** control over the product catalogue (curtains, blinds, mesh), pricing, vendors and team users

A static HTML/Tailwind/Alpine.js prototype already exists at `docs/prototype/` covering 4 screens (orders dashboard, new consultation form, order detail with status timeline, and a fabric catalog screen since superseded by the Product section). The prototype is the source of truth for layout, data shape, and interactions. Implementation should mirror the prototype's UX 1:1 while moving to Next.js + Supabase.

## Stack (locked — applies to all phases)

| Area | Decision |
|---|---|
| Framework | Next.js 15+ App Router, TypeScript, Tailwind, `src/` directory |
| UI primitives | shadcn/ui |
| Forms | React Hook Form + Zod (discriminated unions for window variants) |
| Backend | Supabase (Postgres + Auth + Storage + RLS); Singapore region |
| Server access | `@supabase/ssr` for cookie-based RSC + Server Action clients |
| Roles | `consultant`, `ops`, `admin` |
| Order visibility | All authenticated users read all orders. Consultants edit only their own. Ops only advance status (cannot edit consultation data). Admins do everything. |
| Photos | Supabase Storage private bucket, signed upload URLs, client-side HEIC→JPEG via `heic2any` + compression via `browser-image-compression` |
| Money | Integer cents (SGD) |
| Deletes | No hard deletes; status toggle / archive only |
| Print spec sheet | Skip for v1 |
| Email notifications | None for v1 (only Supabase auth emails) |
| Hosting | Railway via multi-stage Dockerfile, Next.js `output: 'standalone'` |
| Customer dedup | v1 always creates new customer row; merge tool deferred |
| Catalogue | `curtain_series` → `curtain_types`, split by `product_line` (`curtain` \| `blind`); mesh has its own tables. Windows reference type **ids**, not codes — the Phase-3 fabric-code scheme was decommissioned in Phase 8. Labels are stored verbatim. |

## Theme

The prototype uses **deep teal** as the accent colour (`teal-600` / `#0d9488`). Status badges retain their semantic colours (purple/blue/indigo/emerald/green/slate per fulfilment stage). Don't reintroduce amber.

## Phases

> **Reordered 2026-05-29.** Auth is deferred to the end of the milestone. We build the feature set first, validate it in a live environment, then retrofit auth + admin user management as the final phase. File numbers are kept intact (so `phase-3-fabrics.md` is still `phase-3-fabrics.md`), but the execution order is no longer monotonic. See the **Execution override** block at the top of each phase-3..7 spec for the no-auth posture, and the **Deferred** banner at the top of `phase-2-auth.md` for what the final auth phase now covers.

**Execution order:**

```
1. Scaffold ──▶ 3. Fabrics ──▶ 4. Consultation ──▶ 5. Photos ──▶ 6. Orders Dashboard ──▶ 7. Polish ──▶ 2. Auth + Admin (retrofit)
```

| Order | Phase file | Deliverable |
|---|---|---|
| 1 | `phase-1-scaffold.md` | ✅ Next.js scaffold + Supabase project + Kysely migrator + Railway deploy with healthcheck |
| 2 | `phase-3-fabrics.md` | Fabric catalog CRUD (full vertical slice). **Superseded** — fabrics were replaced by the curtain-type catalogue in Phase 8 and the tables dropped. Kept for history. |
| 3 | `phase-4-consultation.md` | New consultation form + order creation (rooms/windows, no photos yet) |
| 4 | `phase-5-photos.md` | Per-room photo upload + display via Supabase Storage (service-role for now) |
| 5 | `phase-6-orders-dashboard.md` | Orders dashboard with stats/filters + status workflow (advance + notes) + edit |
| 6 | `phase-7-admin-polish.md` | Polish only — empty states, loading skeletons, mobile QA. (Admin user management migrates to the auth phase.) |
| 7 | `phase-2-auth.md` | **Auth retrofit (last)** — magic-link login, `(auth)`/`(app)` route groups, `lib/auth/*` helpers, RLS policies on every existing table, `requireRole/requireSession` insertion pass through every Server Action, admin user invite + role management UI. |
| 8 | `phase-8-curtain-types.md` + `phase-8b-series-index-page.md` | Digital curtain-type catalog (Day/Night taxonomy, photo uploads, series/index/page). |
| 9 | `phase-9-pricing-foundation.md` | **Pricing foundation** — vendors + per-curtain cost (RMB)/curated sale (SGD), global pricing assumptions + add-on price list. Data + admin UI only; calculator deferred to Phase 10. |
| 10 | `phase-10-promotions-combos.md` | **Promotions & combo pricing** — order-level promo (preset tier or custom %) + per-window combo bundle price (explicit pick, overrides sale). ✅ Implemented. |
| 11 | `phase-11-mesh-product-line.md` | **Mesh product line** — window mesh (AirGuard/PetGuard/MaxGuard) as a second product. `orders.product_line` discriminator + separate `mesh_panels` line items; priced per ft² by category + colour surcharge (the m²-band grid in the spec was superseded — see `20260814100000`). ✅ Implemented. |
| 12 | `phase-12-product-section-and-blinds.md` | **Product section & blinds** — merges the Digital Catalogue and Mesh nav tabs into one **Product** section (Curtains / Blinds / Mesh), and makes blinds a real product: `curtain_series.product_line`, a third `blind` window variant, per-width pricing and the `handyman_blinds` install rate. **Implemented 2026-08-17**; catalogue seeded (420 blinds, 7 series) but unpriced, so blinds are not yet offered on consultations. |

## How to use a spec in a fresh chat

Start a new Claude Code session in this repo (`cd` to repo root first). Open the spec for the phase you want to execute, then prompt:

```
Read docs/specs/phase-N-<name>.md and implement it end-to-end.
```

Claude should:
1. Read the spec
2. Read the prototype HTML files it references
3. Read any code from previous phases that it needs to extend
4. Execute the implementation tasks in order
5. Run the verification steps before declaring done

If anything is genuinely ambiguous, the spec is incomplete — fix the spec rather than making up an answer.

## Conventions (apply to all phases)

### Repo / git
- Single `main` branch. Commit per logical unit of work (not per phase). Conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `chore:`, `db:` for migrations).
- After each phase, push to Railway and verify the deploy.

### TypeScript
- `strict: true`. No `any` unless escaping into untyped library territory.
- Generate DB types after every migration: `npm run db:codegen` (writes `src/lib/db/schema.ts` via `kysely-codegen`).
- Import the Kysely DB type via `import type { DB } from '@/lib/db/schema'`.

### File naming
- kebab-case for files (`status-badge.tsx`, `consultation-form/`)
- PascalCase for React components
- camelCase for functions and variables
- SCREAMING_SNAKE for env vars

### Migrations
- Live in `data/migrations/` as TypeScript files using Kysely's migrator.
- Named `YYYYMMDDHHMMSS_descriptive_name.ts` (UTC). Export `up(db)` and `down(db)`. See `rules/data/migrations.md`.
- One migration = one logical change. Don't pile changes.
- Phase 1 creates `data/` and the first migration (`init_profiles`). Subsequent phases add their own migrations.
- After writing a migration: `npm run db:migrate` (applies via `data/migrate.ts` against `DATABASE_URL`, which points at the Supabase session pooler), then `npm run db:codegen`.

### Components
- **Default to React Server Components.** Add `'use client'` only when the subtree needs state, effects, or browser APIs.
- Keep Client subtrees small — pass data in, push handlers down.
- The consultation form is the canonical Client subtree (RHF `useFieldArray`).

### Server Actions
- Live in `src/lib/actions/<feature>.ts` with `'use server'` at file top.
- **During the no-auth window (Phases 3-7):** no `requireRole`/`requireSession` calls. Mutations run open. The auth retrofit phase inserts guards in a single pass.
- Validate inputs with the matching Zod schema before touching the DB.
- Query through the **Kysely** singleton (`src/lib/db/kysely.ts`), not the `@supabase/ssr` clients. The Supabase clients are reserved for auth, which doesn't exist yet.
- Throw on error (don't return error envelopes). Use `useFormState` on the client for form-level error display.
- Call `revalidatePath(...)` after mutations; don't return data that the page can re-fetch.

### Forbidden
- Storing money as floats or `numeric(_,2)` — always integer cents.
- Changing a series' `product_line` after creation — it retroactively reprices every window that references it.
- Hard deletes — use status toggles / archive flags.
- Offering a product with no sale price on the consultation form — it quotes at S$0 while still charging install.

### Critical references (every phase)

- `docs/prototype/consultation.html` — nested order→room→window data shape; toilet vs regular window variant
- `docs/prototype/order-detail.html` — 6-status flow keys + colour mapping + per-room photo layout
- `docs/prototype/fabrics.html` — fabric schema + seed data
- `docs/prototype/index.html` — orders list shape + responsive table-vs-cards pattern

When in doubt about UX, open the prototype file in a browser and look.
