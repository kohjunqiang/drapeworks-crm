# Lead priority: local test and data impact

## Open the test app

Use **http://localhost:3003/leads**. It uses synthetic records in `drapeworks_priority_local` on `127.0.0.1:55439`. This is separate from the existing app on port 3000. No production database was read, migrated, copied or updated during this implementation.

Restart the test app from the repository:

```sh
node scripts/start-priority-local.mjs
```

If the isolated PostgreSQL server has stopped:

```sh
pg_ctl -D /tmp/drapeworks-priority-pg -l /tmp/drapeworks-priority-pg.log -o '-p 55439 -h 127.0.0.1' start
```

The database lives in `/tmp/drapeworks-priority-pg`; it is disposable and may be removed by OS temporary-file cleanup. The current local fixture is already provisioned. For a fresh cluster, first initialize PostgreSQL and create an empty database with minimal local auth/storage schemas (the bootstrap used for this session is `/tmp/priority-bootstrap.sql`), then run the setup command below. The local auth/storage placeholders are for lead workflow testing, not a full Supabase installation.

The launcher overrides every key from local environment files and clears inherited integration credentials. It supplies only local database/auth endpoints and uses the existing development-only auth bypass with a synthetic consultant. No real login, calendar, Zoho, Telegram or storage account is connected. Output is isolated in `.next-priority` so the existing dev server's build cache is not overwritten.

**Do not use plain `npm run db:migrate` for these tests:** the repository's `.env` targets the remote database. Use explicit local commands:

```sh
DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local node --import tsx scripts/setup-priority-local.ts
DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local node --import tsx scripts/verify-priority-local.ts
```

Both tools reject other host/port/database combinations. Setup preserves tester edits on reruns. Verification rolls back every test mutation. Setup skips historical customer import/repair migrations and separately retains the schema column from the mixed schema/repair migration. Test tools are excluded from the Docker build context and are never application startup hooks.

## Test cases

Sample letters refer to acceptance-test names, not expected categories:

| Lead | Expected score | Category |
| --- | --- | --- |
| Priority test A | 68 | B |
| Priority test B | 84 | A |
| Priority test C | 60 | C |
| Priority test D | 52 | C |
| Priority test E | Pending: Order Value missing | Pending |
| Priority test Overdue | 20 | D; ahead of all future A leads |
| Priority test Upcoming | 100 | A; behind overdue/today |
| Priority test Unassessed | Pending: all dimensions missing | Pending |

Due dates were seeded relative to the setup date in Singapore. They become overdue as time passes, just like real leads. Rerunning setup does not reset dates or overwrite manual testing.

1. Open a lead by clicking its name. Check the weighted breakdown and explanation.
2. Edit stage, engagement and quotation, save, and reopen to verify persistence.
3. For case C, change stage to Move-In Within 2 Months: 60/C becomes 84/A.
4. Clear quotation: the total becomes Pending. Enter 0 explicitly: commercial score is 1.
5. Filter by A/B/C/D/Pending. Applying filters preserves sorting.
6. Active Queue defaults to overdue, today, upcoming, unscheduled; descending priority within each category. Selecting Priority Score here retains due category first. All Leads defaults to descending priority with closed leads after open leads. Closure is determined from the actual funnel stage, not the derived action: Customer Declined alone does not classify an open lead as closed.
7. Close a synthetic lead as Lost with a reason: it leaves the Active Queue, remains in All Leads, and keeps its assessment. Existing Won/deposit and closure guards remain in force.
8. Create a new lead, edit its detail page, and log interactions. Priority does not alter funnel/status/action derivation.

## Fields and existing data

- New nullable manual fields: `renovation_buying_stage`, `engagement_quality`.
- Reused monetary input: `latest_quote_cents`. No new competing order-value field.
- New stored, generated fields: `readiness_score`, `commercial_value_score`, `engagement_quality_score`, `priority_score`, `priority_class`.
- Database columns recalculate on every write, including external quotation updates. Display, filtering and sorting consume the generated database fields directly; there is no second runtime scoring formula. An independent test-only oracle verifies the database results across 264 combinations.
- Formula: readiness × 8 + commercial × 8 + engagement × 4. Classes: A ≥80, B ≥65, C ≥45, D <45.
- Prices are integer cents; fractional-dollar thresholds are continuous: $899.99 is score 2, $900 is score 3.
- Missing inputs stay null; totals/classes stay null until all three dimensions exist. Zero is an explicit low value, not missing. Negative legacy quotation values also remain unscored rather than being silently accepted.
- Existing leads receive no guessed stage or engagement. Their quotation, keys flag, move-in date, workflow fields, timestamps, interactions and legacy snapshots are preserved. Existing records initially show Pending.
- Keys Collected remains an existing factual field. It cannot establish the furthest stage reached. The old funnel-derived readiness label is now named Funnel Readiness in detail displays to distinguish it from priority Buying Readiness.
- Move-in dates do not override the manually selected stage. Engagement is never inferred from message counts.
- Closed assessments are retained, not frozen: editing their inputs still recalculates them. They are excluded from active prioritisation.

## Review and future release

The [rollback runbook](lead-priority-rollback.md) contains the backup, application
rollback, guarded single migration-down command and post-rollback checks.

Implementation is local only; no deployment or production migration has been performed. Apply the additive migration before deploying code that selects the new columns. Adding stored generated columns can rewrite/lock the leads table, so plan the eventual migration for a suitable maintenance window. Lead priority is the only new production schema change; two already-applied historical migration files are also restored to reconcile history. Before applying, verify that no older migrations are pending on the target database; the migration runner applies all pending migrations.

Keep the existing application and database backup available before a future release. Prefer rolling back application code while retaining the additive columns; running this migration's `down` deletes the newly entered assessments. No automatic backfill, qualification change, historical rewrite or production fixture seeding is included.

Verification completed: all original tests plus priority unit tests; 264 rollback-only SQL/application comparisons; migration up/down preservation checks; browser creation/edit/clear/filter/close flows; desktop and 375px mobile layout; TypeScript; production build. ESLint has no errors and two existing unrelated warnings. Calendar, Zoho and storage network integrations were deliberately not exercised against live services.
