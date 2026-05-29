# Drapeworks CRM

A Next.js + Supabase CRM for a Singapore curtain company. Three roles use it: **sales consultants** capture measurements on-site, **ops** track shipment/installation, **admins** manage the fabric catalog and team.

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
    (app)/         # auth-protected — orders, fabrics, admin
    api/           # route handlers (health, etc.)
  components/
    ui/            # shadcn primitives (do not edit; regenerate via shadcn CLI)
    nav/           # top nav + mobile menu
    orders/        # orders feature
    fabrics/       # fabrics feature
    admin/         # admin feature
  lib/
    supabase/      # server.ts, browser.ts, admin.ts (service-role; isolated) — auth/session only
    auth/          # get-session.ts, require-role.ts
    actions/       # 'use server' modules, one per feature
    validation/    # Zod schemas, shared client+server
    db/            # Kysely instance + generated schema.ts (kysely-codegen output)
    status-flow.ts, money.ts, format.ts
  middleware.ts    # Supabase session cookie refresh

data/              # Kysely migrations live here (not in /supabase)
  migrate.ts       # `npm run db:migrate` runs all pending migrations
  migrations/      # YYYYMMDDHHMM_descriptive_name.ts (Kysely TS migrations)

docs/
  prototype/       # HTML mockups (source of truth for UX)
  specs/           # one spec per implementation phase

rules/             # behavioural rules for Claude — READ BEFORE CODING
```

## Non-negotiable rules

These come up constantly. Full detail in `rules/` (see `rules/README.md` for the structure).

- **Default to React Server Components.** Add `'use client'` only when the subtree needs state, effects, or browser APIs. (`rules/code/components.md`)
- **Every Server Action starts with `await requireRole([...])` or `await requireSession()` and validates input with Zod.** No exceptions. (`rules/code/server-actions.md`)
- **RLS is the source of truth for access control.** Server Action guards are defence-in-depth. Never bypass with the service-role client except in `inviteUser`. (`rules/data/rls.md`)
- **Money is integer cents.** Never floats, never `numeric(_,2)`. (`rules/code/typescript.md`)
- **No hard deletes.** Use status toggles / archive flags. (`rules/data/migrations.md`)
- **Fabric codes are immutable PKs.** The trigger enforces this; the UI must disable the code field on edit. (`rules/code/forms.md`)
- **Mirror the prototype exactly for UX.** Same classes, same breakpoints, same colours. Only diverge with explicit reason. (`rules/ui/design-tokens.md`, `rules/ui/responsive.md`)
- **After every migration, regenerate types** with `npm run db:codegen` (writes `src/lib/db/schema.ts`).

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
