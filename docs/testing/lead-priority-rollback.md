# Lead priority rollback runbook

Prepared for the release containing `20260915160000_lead_priority`.
These are operator commands for a future rollback decision. Preparing this file
does not execute a production rollback.

## Scope and data impact

Run **one** migration down: it removes the seven priority columns and two enums.
Original lead fields, quotations, timestamps and stage history remain intact.
New stage/engagement assessments are deleted, so take a backup first.
Reapplying `up` recreates empty assessment fields; it does not restore assessments.

The only new database change in this release is lead priority. Two historical
migration files are restored because production already records them as applied;
they must remain present for Kysely history validation. Four other schema changes
were verified in production and their missing history entries reconciled.
Run down once; additional down commands would revert older, unrelated migrations.

## Execution sequence

1. Pause writes and deployments, including integrations, scheduled jobs and other
   migration operators. Keep maintenance in place until verification finishes.
2. Set `DATABASE_URL` explicitly in the operator terminal using the intended
   database's secret. Do not rely on the repository `.env`. Verify the destination
   in the database dashboard. Use a direct or session-pooler connection.
3. Create a private backup outside the repository. With compatible PostgreSQL
   client tools installed, run the following in a bash terminal:

   ```bash
   set -euo pipefail
   : "${DATABASE_URL:?Set the intended database connection explicitly}"
   export DATABASE_URL
   umask 077
   rollback_dir=$(mktemp -d "${TMPDIR:-/tmp}/drapeworks-rollback.XXXXXX")
   pg_dump --dbname="$DATABASE_URL" --format=custom --file="$rollback_dir/before-down.dump"
   pg_restore --list "$rollback_dir/before-down.dump" > "$rollback_dir/backup-contents.txt"
   test -s "$rollback_dir/backup-contents.txt"
   printf 'Backup directory: %s\n' "$rollback_dir"
   ```

   Copy the backup into durable, access-controlled storage before continuing.
   Listing the archive checks readability, not a complete restore. Confirm the
   established database recovery procedure is available; restore into a separate
   database first if the backup is needed. Do not overwrite newer production data.
4. Redeploy the previous application version in Railway (the release based on
   commit `029f765`), and wait for every new-version instance to stop. The old app
   can run while the additive priority columns still exist. Retain this release's
   source checkout for the migration command; do not delete its migration files.
5. From that checkout, in the same bash terminal, verify the migration head and
   run down exactly once. The guard refuses if another migration is now latest:

   ```bash
   latest=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
     'select name from public.kysely_migration order by name desc limit 1')
   if [ "$latest" != '20260915160000_lead_priority' ]; then
     printf 'STOP: migration head is %s; review the newer migrations first.\n' "$latest" >&2
     exit 1
   fi
   npm run db:migrate:down
   ```

   Expected output: `reverted 20260915160000_lead_priority`. Kysely executes
   PostgreSQL migrations and their bookkeeping transactionally. If the command
   fails, keep maintenance in place and inspect the error; do not proceed to
   additional down commands. The head check assumes other migration operators
   remain paused throughout this sequence.
6. Verify the database before restoring traffic:

   ```bash
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
   select name from public.kysely_migration order by name desc limit 3;
   select column_name from information_schema.columns
   where table_schema='public' and table_name='leads'
     and column_name in ('renovation_buying_stage','engagement_quality',
       'readiness_score','commercial_value_score','engagement_quality_score',
       'priority_score','priority_class');
   select to_regtype('public.lead_buying_stage'),
          to_regtype('public.lead_engagement_quality');
   SQL
   ```

   The priority migration must be absent, the column query must return zero rows,
   and both enum results must be null. Verify login, All Leads, Active Queue,
   lead detail and an existing order in the old app. Check application logs for
   missing-column errors. `/api/health` alone does not check database compatibility.
7. Resume traffic and integrations only after those checks pass. Reconcile Git
   with the rollback before the next push so automatic deployment cannot bring
   back code requiring the dropped columns. Revert the lead-prioritisation release commit
   (resolve later changes if any), rather than resetting shared history.

## Local verification

```bash
DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
  node --import tsx scripts/verify-priority-local.ts
```

This tool rejects other destinations. It exercises the actual `down` and `up`
functions inside a transaction that always rolls back, checking original lead
fields and history, removal of all columns/enums, and Pending assessments after
reapplication. It leaves the local preview usable and does not access production.
