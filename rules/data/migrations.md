# Migrations

This project uses **Kysely TypeScript migrations**, not the Supabase CLI. Supabase
provides the Postgres instance; every schema change goes through `data/migrations/`.

## Location and naming

- Live in `data/migrations/` (**not** `supabase/migrations/`)
- Named `YYYYMMDDHHMMSS_descriptive_snake_case.ts` — a 14-digit timestamp, then the name
- Created by hand: add the file. There is no generator.
- Ordering is lexicographic by filename, so the timestamp must be later than every
  applied migration. Check the last entry in `data/migrations/` before choosing one.

Each file exports `up` and `down`:

```ts
import { sql, type Kysely } from "kysely";

// Why this change exists. The diff shows what; this says why.
export async function up(db: Kysely<unknown>): Promise<void> { }
export async function down(db: Kysely<unknown>): Promise<void> { }
```

Use the Kysely schema builder (`db.schema.alterTable(...)`) for plain DDL and the
`` sql`...` `` tag for anything it can't express — enums, triggers, functions, RLS,
partial indexes.

> **Backticks inside `` sql`...` ``.** A backtick in a SQL comment terminates the
> template literal and produces a confusing parse error far from the real line. Write
> SQL comments without them.

## Granularity

**One migration = one logical change.** Don't pile schema + RLS + seed into one file:

```
20260601120000_orders_core.ts     # tables, enums, triggers
20260601120100_orders_rls.ts      # policies
20260601120200_seed_data.ts       # if needed
```

This makes failures easier to diagnose and rollback safer.

## Append-only after apply

Once a migration has run against the remote, **never edit it**. Fix mistakes with a new
migration that corrects the previous one. Editing an applied migration causes drift
between the file and the database, and Kysely will not re-run it.

This bites more than it looks: a column added as `text` + CHECK that should have been an
enum needs a *second* migration to convert it (see `20260817091000`).

## Writing `down()`

`down()` must leave the schema as it was. Two rules that are easy to get wrong:

- **Reverse order.** Restore a function body *before* dropping the column it references,
  or the rollback leaves a function that fails on the next insert rather than at
  migration time.
- **Some things can't be reversed.** Re-adding a `NOT NULL` fails if rows now hold null.
  Don't silently skip it — leave the column nullable and write a comment saying why, so
  the next person knows it's a data decision rather than an oversight
  (see `20260817090000` on `curtain_types.category`).

## Applying

```bash
npm run db:migrate        # apply all pending (migrateToLatest)
npm run db:migrate:up     # apply the next one only
npm run db:migrate:down   # revert the last one
```

Reads `DATABASE_URL` from `.env` and runs against the **remote** — there is no local
stack. Verify in the Supabase dashboard, or with a throwaway `tsx` script.

## Type generation (mandatory after every migration)

```bash
npm run db:codegen        # kysely-codegen → src/lib/db/schema.ts
```

**Non-negotiable.** Code that compiles against stale types blows up at runtime. Check
your new columns/enums appear in `src/lib/db/schema.ts` before continuing.

Note `src/lib/supabase/` holds auth/session clients only; it has no generated types file.

## Verifying a trigger or constraint

Schema guards are worth testing before code is built on them. Run the cases inside a
transaction that always rolls back:

```ts
await db.transaction().execute(async (trx) => {
  // …insert the rows each case needs, assert accept/reject…
  throw new Error("ROLLBACK");
}).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
```

Include the *unchanged* cases too — that's what proves you didn't regress the old rule.

## Common migration patterns

**Enum** — prefer a real enum over text + CHECK for any closed value set.
kysely-codegen turns an enum into a string-literal union and a text column into
`Generated<string>`, where a typo compiles fine and fails silently at runtime:

```ts
await sql`create type public.my_enum as enum ('a', 'b', 'c')`.execute(db);
```

Changing an existing column's type: drop the default, alter the type with `using`, then
restore the default. Postgres can't cast the default while the type is in flight.

**Table with audit columns**:

```ts
await db.schema.createTable("thing")
  .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .execute();

await sql`
  create trigger thing_set_updated_at
    before update on public.thing
    for each row execute function public.set_updated_at()
`.execute(db);
```

`set_updated_at` is created in Phase 1 and reusable across all tables.

**Trigger that enforces invariants**: write a `language plpgsql` function, then a
`before insert/update` trigger. Use `create or replace function` to change one — the
trigger keeps pointing at the same name, so there's no window where the table is
unguarded. See `validate_window_shape` and `validate_status_transition`.

**New RLS policies** go in their own migration — see `rules/data/rls.md`.

## Forbidden

- Editing a migration after it has been applied
- Hand-editing `src/lib/db/schema.ts` (it is generated)
- Combining unrelated changes in one migration
- `drop table` without first archiving data (we don't hard-delete anyway)
- `alter type ... drop value` on enums in use — Postgres doesn't support it cleanly;
  rename the value via a multi-step migration if you must
