# Drapeworks CRM

A CRM for a Singapore curtain company. Sales consultants capture on-site measurements, ops track fulfilment, admins manage the fabric catalog and team.

## Stack

- **Framework**: Next.js 15+ App Router, TypeScript, Tailwind (`src/`)
- **UI**: shadcn/ui + Tailwind (`teal-600` accent on `slate` base)
- **Forms**: React Hook Form + Zod
- **Backend**: Supabase (Postgres + Auth + Storage + RLS) — Singapore region
- **Server access**: `@supabase/ssr` cookie-based clients
- **Hosting**: Railway via multi-stage Dockerfile (Next.js `output: 'standalone'`)

## Local development

1. Install Node 20+ and npm.
2. Copy env vars: `cp .env.example .env.local` then fill in the Supabase URL, anon key, service role key, and `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
3. Install dependencies: `npm install`.
4. Start the dev server: `npm run dev` → http://localhost:3000.

Health check: `curl http://localhost:3000/api/health` → `{"ok":true,...}`.

## Database workflow

We use **Kysely** for migrations and type generation. The Supabase Postgres database is still the source of truth; Kysely is just how we talk to it.

```bash
# create a new migration — name the file YYYYMMDDHHMM_<descriptive_name>.ts under data/migrations/
# (use the existing files as a template; export up(db) and down(db))

# apply all pending migrations against the database in DATABASE_URL
npm run db:migrate

# regenerate the Kysely schema types after a migration
npm run db:codegen
```

Migrations live in `data/migrations/`. Apply the migration to the remote DB **before** deploying app code that references the new columns.

`DATABASE_URL` should point at the Supabase **session pooler** (port 5432), not the deprecated direct hostname:

```
postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

## Deploy (Railway)

Push to `main` → Railway picks up the Dockerfile, builds, and serves. Build-time env vars must be marked as build-time in Railway:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

Runtime only:

- `SUPABASE_SERVICE_ROLE_KEY`

Healthcheck path: `/api/health`.

### Verify the Docker image locally

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  -t drapeworks-crm:test .

docker run --rm -p 3000:3000 --env-file .env.local drapeworks-crm:test
```

## Documentation

- `docs/specs/README.md` — implementation phases and global conventions
- `docs/prototype/*.html` — UX source of truth (open in a browser)
- `rules/` — short rule files Claude (and humans) should consult before writing code
- `CLAUDE.md` — quick-start instructions for Claude Code sessions
