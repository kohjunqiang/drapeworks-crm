# Drapeworks CRM

A Next.js + Supabase CRM for a Singapore curtain company. Three roles use it: **sales consultants** work the lead queue and capture measurements on-site, **ops** track shipment/installation, **admins** manage the product catalogue (curtains, blinds, mesh) and the team.

The app spans the whole funnel: a lead arrives on Telegram or WhatsApp, gets qualified and booked into a consultation (which lands on a shared Google Calendar), and becomes an order that is quoted, manufactured and delivered. Ops work begins at the order — leads are closed to them.

## Stack at a glance

| | |
|---|---|
| Framework | Next.js 15+ App Router, TypeScript strict, Tailwind, `src/` |
| UI | shadcn/ui + Tailwind; teal-600 accent on slate base |
| Forms | React Hook Form + Zod (discriminated unions for window variants) |
| Backend | Supabase (Postgres + Auth + Storage + RLS); Singapore region |
| Server | `@supabase/ssr` cookie-based clients for RSC + Server Actions |
| Hosting | Railway via multi-stage Dockerfile; `output: 'standalone'` |

## Read these first (every new session)

1. `rules/README.md` — index of focused rule files. Open the ones relevant to your task before writing code.
2. `docs/specs/README.md` — phase index + global conventions
3. `docs/specs/phase-N-*.md` — the current phase you're implementing (self-contained)
4. `docs/prototype/*.html` — the UX source of truth; mirror layout, classes, and interaction patterns exactly

The `rules/` folder is organised as:
- `rules/code/` — components, server actions, forms, TypeScript
- `rules/data/` — migrations, RLS, storage, queries
- `rules/ui/` — design tokens, responsive patterns, shadcn/icons
- `rules/workflow/` — git, deploy, verification

## Project structure

```
src/
  app/             # Next.js App Router (RSC by default)
    (auth)/        # /login, /auth/callback
    (app)/         # auth-protected
      orders/      # dashboard, detail, new consultation, edit
      admin/       # product/{curtains,blinds,mesh}, vendors, pricing-settings
    api/           # route handlers (health, etc.)
  components/
    ui/            # shadcn primitives (do not edit; regenerate via shadcn CLI)
    nav/           # top nav + mobile menu (links.ts is the single link list)
    orders/        # orders feature (consultation-form/, mesh-form/)
    curtain-types/ # curtain + blind catalogue (one table, split by product line)
    mesh/          # mesh catalogue
    vendors/       # vendor CRUD
    pricing/       # pricing settings
    admin/         # admin chrome (product tabs)
    leads/         # leads feature — table, detail form, booking + reschedule dialogs
  lib/
    supabase/      # server.ts, browser.ts, admin.ts (service-role; isolated) — auth/session only
    auth/          # get-session.ts, require-role.ts
    actions/       # 'use server' modules, one per feature
    validation/    # Zod schemas, shared client+server
    db/            # Kysely instance + generated schema.ts (kysely-codegen output)
    leads/         # queue-engine.ts (the ported funnel engine), sg-date.ts, types.ts
    calendar/      # Google Calendar: google.ts (OAuth client), sync.ts, event.ts,
                   # retry.ts + timeout.ts (bounded, backed off)
    status-flow.ts, money.ts, format.ts
  middleware.ts    # Supabase session cookie refresh

data/              # Kysely migrations live here (not in /supabase)
  migrate.ts       # `npm run db:migrate` runs all pending migrations
  migrations/      # YYYYMMDDHHMM_descriptive_name.ts (Kysely TS migrations)

scripts/           # one-off operator tools, never imported by the app
  db-query.ts             # throwaway query runner
  import-leads.ts         # one-shot spreadsheet import (not idempotent)
  verify-lead-engine.ts   # diffs the engine against the spreadsheet
  google-oauth-consent.ts # mints the Calendar refresh token

docs/
  prototype/       # HTML mockups (source of truth for UX)
  specs/           # one spec per implementation phase

rules/             # behavioural rules for Claude — READ BEFORE CODING
```

## Non-negotiable rules

These come up constantly. Full detail in `rules/` (see `rules/README.md` for the structure).

- **Default to React Server Components.** Add `'use client'` only when the subtree needs state, effects, or browser APIs. (`rules/code/components.md`)
- **Every Server Action starts with `await requireRole([...])` or `await requireSession()` and validates input with Zod.** No exceptions. (`rules/code/server-actions.md`)
- **Server Actions are the access-control surface — RLS is not currently enforced.** The app connects as the table owner, which bypasses RLS entirely, so every action must guard with `requireRole`/`requireSession` and check ownership itself. Keep writing policies on new tables; just never rely on one to catch a missing check. (`rules/data/rls.md`)
- **Money is integer cents.** Never floats, never `numeric(_,2)`. (`rules/code/typescript.md`)
- **No hard deletes.** Use status toggles / archive flags. (`rules/data/migrations.md`)
- **Catalogue labels are stored verbatim.** Vendor codes are the customer's language — never strip a prefix, normalise case, or fix an apparent typo. (`rules/code/forms.md`)
- **A window is one covering.** Day/night curtains, a single toilet curtain, or a blind — never a mix. Enforced by the `windowSchema` discriminated union AND the `validate_window_shape` trigger; `windowValues` nulls the other variants' columns to keep them agreeing. (`rules/code/forms.md`)
- **Don't offer what can't be quoted.** A product with no sale price is hidden from the consultation form, not shown at S$0. Mesh and blinds both gate this way. (`rules/code/forms.md`)
- **Mirror the prototype exactly for UX.** Same classes, same breakpoints, same colours. Only diverge with explicit reason. (`rules/ui/design-tokens.md`, `rules/ui/responsive.md`)
- **After every migration, regenerate types** with `npm run db:codegen` (writes `src/lib/db/schema.ts`).
- **The lead queue is derived at read time, never stored.** Every rule in `queue-engine.ts` depends on today's date, so a stored copy is stale the moment the clock rolls over. The engine is a verbatim port of Alan's spreadsheet — including three bugs kept on purpose so the two can be diffed. Change a branch and `spreadsheet-parity.test.ts` (248 tests) will tell you.
- **`select` a `date` column as `::text`.** node-postgres hands `date` back as a JS `Date` at *local* midnight. The engine compares `YYYY-MM-DD` strings, and a `Date` silently ruins every due-status and priority band. See the cast in `src/app/(app)/leads/page.tsx`.
- **Calendar sync is a side effect, never a gate.** The appointment commits first; a Google outage costs a calendar entry, not a booking. Every call is bounded by a timeout and a total budget, and failures surface as a retry the consultant can press. Never make a booking `await` its way into failure.
- **The leads spreadsheet is PII and must never be committed.** 244 real names, 98 mobiles. `*.xlsx` is gitignored; import via `scripts/`, never a migration.

## Common commands

```bash
# Dev
npm run dev                          # http://localhost:3000
npm run build                        # production build (includes type check)
npm run lint

# Database (Kysely)
# create a new migration: add a file YYYYMMDDHHMM_<name>.ts under data/migrations/
npm run db:migrate                   # apply pending migrations to remote
npm run db:codegen                   # regenerate src/lib/db/schema.ts

# Leads / calendar (operator tools, run by hand)
npm run leads:verify                 # diff the engine against the spreadsheet
npm run leads:import                 # one-shot import — NOT idempotent
npm run calendar:consent             # mint GOOGLE_OAUTH_REFRESH_TOKEN (prints a secret;
                                     # run it in your own terminal)

# shadcn
npx shadcn@latest add <component>    # add a primitive

# Docker (verify locally before Railway)
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  -t drapeworks-crm:test .
docker run --rm -p 3000:3000 --env-file .env drapeworks-crm:test
```

## When you're unsure

- **UX question**: open the relevant `docs/prototype/*.html` in a browser.
- **Stack/architecture question**: check `docs/specs/README.md` then the relevant phase spec.
- **Pattern question** (how do I write a Server Action, where do components go, etc.): check `rules/`.
- **Still unsure**: ask the user before making it up.
