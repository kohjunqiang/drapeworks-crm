# Drapeworks CRM — Implementation Specs

This folder contains one spec file per implementation phase. Each spec is **self-contained**: a fresh Claude Code session reading only that spec (plus the prototype HTML files it references) should be able to execute the phase end-to-end without further design questions.

## Project summary

Drapeworks is a curtain company in Singapore. This CRM gives:

- **Sales consultants** a mobile-friendly form to capture customer details and measurements on-site (rooms, windows, fabric codes, photos)
- **Ops** a way to advance fulfilment status as orders move through logistics
- **Admins** control over the fabric catalog and team users

A static HTML/Tailwind/Alpine.js prototype already exists at `docs/prototype/` covering 4 screens (orders dashboard, new consultation form, order detail with status timeline, fabric catalog). The prototype is the source of truth for layout, data shape, and interactions. Implementation should mirror the prototype's UX 1:1 while moving to Next.js + Supabase.

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
| Fabric code | Natural PK (`text`); FK target from `windows.*_curtain_code`; **immutable after creation** |

## Theme

The prototype uses **deep teal** as the accent colour (`teal-600` / `#0d9488`). Status badges retain their semantic colours (purple/blue/indigo/emerald/green/slate per fulfilment stage). Don't reintroduce amber.

## Phases

Linear dependency chain: each phase requires the previous ones.

```
1. Scaffold ──▶ 2. Auth ──▶ 3. Fabrics ──▶ 4. Consultation ──▶ 5. Photos ──▶ 6. Orders Dashboard ──▶ 7. Admin + Polish
```

| Phase | Spec file | Deliverable |
|---|---|---|
| 1 | `phase-1-scaffold.md` | Next.js scaffold + Supabase project + Railway deploy of a hello-world page with healthcheck |
| 2 | `phase-2-auth.md` | Magic-link login + profiles + app shell + role helpers |
| 3 | `phase-3-fabrics.md` | Fabric catalog CRUD (full vertical slice, de-risks RLS/forms/actions) |
| 4 | `phase-4-consultation.md` | New consultation form + order creation (rooms/windows, no photos yet) |
| 5 | `phase-5-photos.md` | Per-room photo upload + display via Supabase Storage |
| 6 | `phase-6-orders-dashboard.md` | Orders dashboard with stats/filters + status workflow (advance + notes) + edit |
| 7 | `phase-7-admin-polish.md` | Admin user management + polish (toasts, empty states, mobile QA) |

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
- `strict: true`. No `any` unless escaping into untyped library territory (rare with Supabase generated types).
- Generate DB types after every migration: `supabase gen types typescript --linked > src/lib/supabase/types.ts`.
- Import types via `import type { Database } from '@/lib/supabase/types'`.

### File naming
- kebab-case for files (`status-badge.tsx`, `consultation-form/`)
- PascalCase for React components
- camelCase for functions and variables
- SCREAMING_SNAKE for env vars

### Supabase migrations
- Live in `supabase/migrations/`
- Named `YYYYMMDDHHMM_descriptive_name.sql` (UTC)
- One migration = one logical change. Don't pile changes.
- Phase 1 creates `supabase/` and the first migration (`profiles` only). Subsequent phases add their own migrations.
- After writing a migration: `supabase db push --linked` then regenerate types.

### Components
- **Default to React Server Components.** Add `'use client'` only when the subtree needs state, effects, or browser APIs.
- Keep Client subtrees small — pass data in, push handlers down.
- The consultation form is the canonical Client subtree (RHF `useFieldArray`).

### Server Actions
- Live in `src/lib/actions/<feature>.ts` with `'use server'` at file top.
- First line of every action: `await requireRole([...])` (or `requireSession()` for non-role-gated reads).
- Validate inputs with the matching Zod schema before touching the DB.
- Use the RLS-respecting server client. The service-role admin client is **only** for `inviteUser` in Phase 7.
- Throw on error (don't return error envelopes). Use `useFormState` on the client for form-level error display.
- Call `revalidatePath(...)` after mutations; don't return data that the page can re-fetch.

### Forbidden
- Hard-coded `role === 'admin'` checks scattered in pages. Use `requireRole(['admin'])` or `currentRole()` helper.
- Bypassing RLS with the service-role client anywhere except the documented admin user invite flow.
- Storing money as floats or `numeric(_,2)` — always integer cents.
- Mutating the fabric `code` after a fabric exists.

### Critical references (every phase)

- `docs/prototype/consultation.html` — nested order→room→window data shape; toilet vs regular window variant
- `docs/prototype/order-detail.html` — 6-status flow keys + colour mapping + per-room photo layout
- `docs/prototype/fabrics.html` — fabric schema + seed data
- `docs/prototype/index.html` — orders list shape + responsive table-vs-cards pattern

When in doubt about UX, open the prototype file in a browser and look.
