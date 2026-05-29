# Migrations

## Location and naming

- Live in `supabase/migrations/`
- Named `YYYYMMDDHHMM_descriptive_snake_case.sql` (UTC time)
- Created with `npx supabase migration new <name>`

## Granularity

**One migration = one logical change.** Don't pile schema + RLS + seed into one file. Typical phase migration set:

```
20260601_1200_orders_core.sql        # tables, enums, triggers
20260601_1201_orders_rls.sql         # policies
20260601_1202_create_order_rpc.sql   # RPC function
20260601_1203_seed_data.sql          # if needed
```

This makes failures easier to diagnose and rollback safer.

## Append-only after push

Once a migration is on the remote (`supabase db push`), **never edit it**. Fix mistakes with a new migration that corrects the previous one. Editing pushed migrations causes drift between local and remote and breaks future `db push` operations.

## Applying

```bash
npx supabase db push --linked
```

Verify in the Supabase dashboard → Table Editor / SQL Editor that the change took effect.

## Type generation (mandatory after every migration)

```bash
npx supabase gen types typescript --linked > src/lib/supabase/types.ts
```

**Non-negotiable.** Code that compiles against stale types blows up at runtime. Verify your new columns/enums appear in the regenerated file before continuing.

## Common migration patterns

**Enum**:
```sql
create type public.my_enum as enum ('a', 'b', 'c');
```

**Table with audit columns**:
```sql
create table public.thing (
  id uuid primary key default gen_random_uuid(),
  -- ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger thing_set_updated_at
  before update on public.thing
  for each row execute function public.set_updated_at();
```

The `set_updated_at` function is created in Phase 1 and reusable across all tables.

**Generated column** (e.g. balance):
```sql
balance_cents int generated always as (greatest(price_quoted_cents - deposit_cents, 0)) stored
```

**Trigger that enforces invariants**: write a `language plpgsql` function, then a `before insert/update` trigger. See `validate_window_shape` (Phase 4) and `validate_status_transition` (Phase 6) for examples.

## Forbidden

- Editing migrations after push
- Hand-editing `src/lib/supabase/types.ts`
- Combining 5 unrelated changes in one migration
- `drop table` without first archiving data (we don't hard-delete anyway)
- `alter type ... drop value` on enums in use — Postgres doesn't support it cleanly; rename the value via a multi-step migration if you must
