# Deploy & Railway

## Deployment loop

1. Commit and push to `main`
2. Railway detects the push and starts a build (Dockerfile multi-stage)
3. Build completes → service restarts on the new image
4. Healthcheck `/api/health` returns 200 → traffic switches
5. You verify the deploy with a quick smoke test

The whole cycle is usually 2-3 minutes.

## Environment variables

Set in the Railway dashboard for the service:

| Variable | Build-time | Runtime | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | Public; must be passed as Docker ARG too |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | Public |
| `NEXT_PUBLIC_SITE_URL` | ✅ | ✅ | Railway domain, used for auth redirects |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | ✅ | Server-only; used by admin client for invites |
| `PORT` | — | (Railway sets) | Default 3000 |

In Railway, mark the three `NEXT_PUBLIC_*` vars as **build-time variables** in addition to runtime. Next.js inlines them into the client bundle at build time, so they must be present during `npm run build`.

## Dockerfile principles

- Multi-stage: `deps` → `builder` → `runner` on `node:20-alpine`
- `output: 'standalone'` in `next.config.ts` for slim runtime image
- `ENV HOSTNAME=0.0.0.0` — required for Railway to route to the container
- Run as non-root user (`nextjs:1001`)
- Healthcheck endpoint at `/api/health` (no DB call; cheap)

The full Dockerfile is in Phase 1 spec. Don't drift from it unless you have a specific reason.

## Verify locally before pushing

Build and run the Docker image locally before pushing a Dockerfile change:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  -t drapeworks-crm:test .

docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -e NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  -e SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  drapeworks-crm:test
```

Then `curl http://localhost:3000/api/health` to confirm.

## Migration deploy order

When a phase includes a migration:

1. Apply locally: `npx supabase db push --linked` (this applies to the linked **remote** project — there's only one Supabase project; local CLI is a tool, not a separate DB)
2. Regenerate types: `npx supabase gen types typescript --linked > src/lib/supabase/types.ts`
3. Commit both the migration file and the regenerated types
4. Push code to `main` → Railway redeploys

**The order matters**: the migration is live on Supabase BEFORE the new app code references the new columns. If you deploy app code first, Railway will boot a service that queries non-existent tables and crashes.

## Rollback

- App rollback: Railway → service → Deployments → click an older deployment → Redeploy
- DB rollback: Postgres doesn't auto-rollback. Write a new "down" migration that reverses the change, then `db push` again. Don't edit pushed migrations.

For a full disaster (broken migration that bricked the DB), restore from Supabase's Point-in-Time Recovery in the dashboard.

## Healthcheck

`/api/health` returns `{ ok: true, ts: <iso> }` without touching the DB. Railway uses this to decide when a new container is ready.

If you want a deep healthcheck that pings the DB (useful for monitoring), add `/api/health?deep=1` that does a `select 1` — but keep the default cheap so Railway's healthchecks don't pummel the DB.

## Logs

Railway: dashboard → service → Deployments → click a deploy → Logs. Watch during a deploy to catch build failures fast.

For ongoing logs (runtime errors): same UI. For more substantial monitoring, add Sentry in Phase 7 polish.

## Forbidden

- Pushing code before the migration is applied to remote
- Deploying without verifying `/api/health` works locally first (if Dockerfile changed)
- Storing secrets in the Dockerfile or in committed code
- Pinning Node version different from `node:20-alpine` without a reason
- Using `docker compose` for production (single-image deploy is the Railway model)
