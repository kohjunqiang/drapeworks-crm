# Phase 1 — Scaffold + Supabase + Railway Deploy Pipeline

## Context for a fresh chat

Drapeworks is a Singapore curtain company. We're building a CRM in Next.js + Supabase, deployed to Railway. A static HTML prototype lives at `docs/prototype/` showing the target UX. This is the first phase: stand up the deployment pipeline before any feature work, so every later phase can ship to a real URL.

**Read these first**:
- `docs/specs/README.md` — global stack decisions and conventions (mandatory)
- `docs/prototype/index.html` — visual reference for the colour palette and font choices (Tailwind `slate` + `teal-600` accent)

**State of the repo**: greenfield. Only `docs/prototype/` exists. No `package.json`, no git repo initialised yet.

## Goal

Provision a Next.js 15 app that builds in a Docker container, deploys to Railway, returns 200 at `/api/health`, and renders a "Drapeworks CRM" hello-world at `/`. Supabase project is created (Singapore region) and linked. First migration creates the `profiles` table only.

## Prerequisites

- User has a Railway account and is logged into `railway` CLI (or will create the service via the web UI)
- User has a Supabase account; either create the project via `supabase` CLI or the dashboard. Pick the Singapore region (`ap-southeast-1`).
- User has `node` 20+, `npm` (or `pnpm`), and `docker` installed locally

Ask the user to confirm these before starting. If Supabase project doesn't exist yet, walk them through `supabase projects create` or instruct them to create via dashboard and provide the project ref.

## Scope (in)

- `package.json`, `tsconfig.json`, Tailwind config, ESLint config, `next.config.ts` with `output: 'standalone'`
- shadcn/ui initialised; install Button, Input, Label
- `@supabase/ssr` + `@supabase/supabase-js` installed
- `src/lib/supabase/{server,browser}.ts` clients
- `src/middleware.ts` for Supabase session cookie refresh
- `src/app/layout.tsx` with global font + body classes
- `src/app/page.tsx` — "Drapeworks CRM — coming soon" placeholder (uses teal accent to match prototype)
- `src/app/api/health/route.ts` returning `{ ok: true }`
- `supabase/` directory + `supabase/config.toml`
- First migration `supabase/migrations/YYYYMMDDHHMM_init_profiles.sql` (profiles table + auth trigger only)
- Generated DB types at `src/lib/supabase/types.ts`
- Multi-stage `Dockerfile`
- `.dockerignore`, `.env.example`, `.gitignore`
- `README.md` at repo root with run/deploy instructions
- Git repo initialised, first commit
- Railway service deployed and healthcheck verified

## Out of scope

- No auth UI (Phase 2)
- No protected routes (Phase 2)
- No business tables beyond `profiles` (added in later phases)
- No Storage bucket (Phase 5)
- No CI/CD beyond Railway's built-in build (can add GitHub Actions later if desired)

## Data model changes

Single migration creating only the `profiles` table. Everything else comes in later phases.

```sql
-- supabase/migrations/YYYYMMDDHHMM_init_profiles.sql

create extension if not exists "pgcrypto";

create type public.user_role as enum ('consultant', 'ops', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'consultant',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Shared updated_at trigger function (reused in later phases)
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile row when a new auth user signs up.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Enable RLS but defer policies to Phase 2.
alter table public.profiles enable row level security;
```

## Server actions added

None this phase.

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/` | `src/app/page.tsx` | RSC — placeholder "Drapeworks CRM — coming soon" |
| `/api/health` | `src/app/api/health/route.ts` | Route handler — returns `Response.json({ ok: true })` |

## Components added

None beyond shadcn primitives initialised by `npx shadcn@latest init`.

## UI references

- `docs/prototype/index.html` — use the same body bg (`bg-slate-50`), text colour (`text-slate-800`), teal accent (`bg-teal-600`)
- Reuse the logo block pattern: `<div class="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">D</div>`

## Implementation tasks

Execute in order. Don't skip steps.

1. **Create Next.js app** in repo root (not a subfolder):
   ```bash
   cd /Users/jason/work/drapeworks/drapeworks-crm
   npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias '@/*' --no-turbo
   ```
   If prompted about overwriting files (the `docs/` folder exists), say no. Verify `docs/` is preserved.

2. **Install dependencies**:
   ```bash
   npm install @supabase/ssr @supabase/supabase-js
   npm install -D supabase
   ```

3. **Init shadcn/ui**:
   ```bash
   npx shadcn@latest init -d
   ```
   Choose: Default style, Neutral base colour (we override accents to teal in Tailwind config).

4. **Add shadcn primitives** used immediately:
   ```bash
   npx shadcn@latest add button input label
   ```

5. **Configure Tailwind** — keep shadcn's generated config but ensure `slate` and `teal` colours work (they're in Tailwind by default; no change needed). Verify content paths include `./src/**/*.{ts,tsx}`.

6. **Update `next.config.ts`**:
   ```ts
   import type { NextConfig } from 'next';
   const config: NextConfig = {
     output: 'standalone',
     experimental: { serverActions: { bodySizeLimit: '12mb' } },
   };
   export default config;
   ```

7. **Create Supabase clients**:
   - `src/lib/supabase/server.ts` — exports `createClient()` using `cookies()` from `next/headers` and `createServerClient` from `@supabase/ssr`
   - `src/lib/supabase/browser.ts` — exports `createClient()` using `createBrowserClient` from `@supabase/ssr`

   Follow the pattern documented in `@supabase/ssr` README. Both clients should read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

8. **Create middleware** `src/middleware.ts` that refreshes the session cookie on every request. Use the pattern from `@supabase/ssr` docs (a `createServerClient` with cookies plumbed from `NextRequest`/`NextResponse`, calling `supabase.auth.getUser()` to refresh). Matcher should exclude `/_next/static`, `/_next/image`, `/favicon.ico`, `/api/health`.

9. **Create the placeholder page** `src/app/page.tsx`:
   ```tsx
   export default function HomePage() {
     return (
       <main className="min-h-screen flex items-center justify-center bg-slate-50">
         <div className="text-center">
           <div className="w-12 h-12 rounded bg-teal-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">D</div>
           <h1 className="text-2xl font-bold text-slate-900">Drapeworks CRM</h1>
           <p className="text-sm text-slate-500 mt-1">Coming soon.</p>
         </div>
       </main>
     );
   }
   ```

10. **Create health route** `src/app/api/health/route.ts`:
    ```ts
    export const dynamic = 'force-dynamic';
    export async function GET() {
      return Response.json({ ok: true, ts: new Date().toISOString() });
    }
    ```

11. **Initialise Supabase**:
    ```bash
    npx supabase init
    ```
    This creates `supabase/config.toml` and friends. Set `project_id` to a slug like `drapeworks-crm`.

12. **Create the Supabase project (cloud)** if not done:
    - Region: Singapore (`ap-southeast-1`)
    - Save the project ref, anon key, service role key, and DB password somewhere secure
    - Add the project ref to `supabase/config.toml` if needed

13. **Link local CLI to remote project**:
    ```bash
    npx supabase link --project-ref <project-ref>
    ```

14. **Create the first migration**:
    ```bash
    npx supabase migration new init_profiles
    ```
    Paste the SQL from "Data model changes" above into the generated file.

15. **Apply migration to remote**:
    ```bash
    npx supabase db push
    ```

16. **Generate TypeScript types**:
    ```bash
    npx supabase gen types typescript --linked > src/lib/supabase/types.ts
    ```

17. **Write `.env.example`**:
    ```
    NEXT_PUBLIC_SUPABASE_URL=
    NEXT_PUBLIC_SUPABASE_ANON_KEY=
    NEXT_PUBLIC_SITE_URL=http://localhost:3000
    SUPABASE_SERVICE_ROLE_KEY=
    ```

18. **Create `.env.local`** with the real values (do NOT commit; ensure `.gitignore` has `.env*` excluded except `.env.example`).

19. **Verify locally**:
    ```bash
    npm run dev
    ```
    Open `http://localhost:3000` — should see the placeholder. Open `http://localhost:3000/api/health` — should return JSON.

20. **Write `Dockerfile`** at repo root (multi-stage, alpine):
    ```dockerfile
    # syntax=docker/dockerfile:1

    FROM node:20-alpine AS deps
    RUN apk add --no-cache libc6-compat
    WORKDIR /app
    COPY package.json package-lock.json* ./
    RUN npm ci

    FROM node:20-alpine AS builder
    WORKDIR /app
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    ENV NEXT_TELEMETRY_DISABLED=1
    ARG NEXT_PUBLIC_SUPABASE_URL
    ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
    ARG NEXT_PUBLIC_SITE_URL
    ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
    ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
    ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
    RUN npm run build

    FROM node:20-alpine AS runner
    WORKDIR /app
    ENV NODE_ENV=production
    ENV NEXT_TELEMETRY_DISABLED=1
    RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
    COPY --from=builder /app/public ./public
    COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
    COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
    USER nextjs
    ENV PORT=3000
    ENV HOSTNAME=0.0.0.0
    EXPOSE 3000
    CMD ["node", "server.js"]
    ```

21. **Write `.dockerignore`**:
    ```
    node_modules
    .next
    .git
    .env*
    !.env.example
    docs
    Dockerfile
    .dockerignore
    README.md
    ```

22. **Build and test Docker image locally**:
    ```bash
    docker build \
      --build-arg NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
      --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
      -t drapeworks-crm:test .
    docker run --rm -p 3000:3000 \
      -e NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
      -e NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
      -e SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
      drapeworks-crm:test
    ```
    Verify `curl http://localhost:3000/api/health` returns `{"ok":true,...}`.

23. **Initialise git**:
    ```bash
    git init
    git add .
    git commit -m "feat: scaffold Next.js + Supabase + Docker"
    ```

24. **Create Railway service**:
    - Either via `railway init` + `railway up`, or via the Railway web UI (New Project → Deploy from GitHub repo / Empty service → connect repo)
    - Railway will detect the `Dockerfile` automatically
    - Set env vars in Railway dashboard:
      - **Build-time** (Variables → mark as build-time): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`
      - **Runtime only**: `SUPABASE_SERVICE_ROLE_KEY`
      - `NEXT_PUBLIC_SITE_URL` should be the Railway-provided domain (set after first deploy then redeploy)
    - Set healthcheck path to `/api/health` in Railway service settings
    - Trigger deploy

25. **Verify Railway deploy**:
    - Wait for build to complete (check Railway logs)
    - `curl https://<your-railway-domain>/api/health` returns 200 with JSON
    - Open the domain in a browser, see the "Drapeworks CRM — coming soon" placeholder

26. **Add Railway domain to Supabase Auth redirect allow-list** (in Supabase dashboard → Authentication → URL Configuration):
    - Site URL: `https://<your-railway-domain>`
    - Redirect URLs: `https://<your-railway-domain>/auth/callback` (this is used in Phase 2)
    - Also add `http://localhost:3000/auth/callback` for local dev

27. **Update `NEXT_PUBLIC_SITE_URL`** env var in Railway to the actual deploy URL and redeploy.

28. **Write `README.md`** at repo root with:
    - Project description (one line)
    - Tech stack
    - Local dev quickstart (`npm install`, `.env.local`, `npm run dev`)
    - Migration workflow (`supabase db push`, `supabase gen types`)
    - Deploy workflow (push to git → Railway auto-deploys)
    - Link to `docs/specs/README.md` for implementation specs

29. **Commit and push**:
    ```bash
    git add .
    git commit -m "chore: add README and docker config"
    git push  # if a remote exists; otherwise push to GitHub manually
    ```

## Verification

All of these must pass before declaring the phase done:

- [ ] `npm run dev` starts and `/` renders placeholder
- [ ] `curl localhost:3000/api/health` returns `{"ok":true,...}`
- [ ] `docker build` succeeds with all three `NEXT_PUBLIC_*` build args
- [ ] `docker run` container responds at `localhost:3000`
- [ ] Railway deploy is green
- [ ] `curl https://<railway-domain>/api/health` returns 200 with JSON `{"ok":true,...}`
- [ ] Browsing `https://<railway-domain>/` shows the placeholder with the teal D logo
- [ ] Supabase dashboard → Table Editor shows `public.profiles` exists with columns `id, email, full_name, role, is_active, created_at, updated_at`
- [ ] `src/lib/supabase/types.ts` exists and contains a `Database` type with `profiles`
- [ ] Supabase Auth → URL Configuration has the Railway domain in Site URL and redirect allow-list

## Hand-off to next phase

After Phase 1, the next phase can assume:

- The Next.js app is deployed to Railway and reachable at a known domain
- Supabase project exists, is linked, and has the `profiles` table + auto-create-on-signup trigger
- `src/lib/supabase/{server,browser}.ts` exist and work
- `src/middleware.ts` exists and refreshes sessions
- DB types are generated at `src/lib/supabase/types.ts`
- The `set_updated_at` trigger function exists and can be reused
- No auth UI exists yet, no protected routes, no business data
- Tailwind + shadcn are wired up; `Button`, `Input`, `Label` are installed
