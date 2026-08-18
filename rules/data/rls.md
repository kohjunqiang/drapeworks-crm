# Row-Level Security (RLS)

## Read this first: RLS is NOT currently enforced

Server Actions are the access-control surface. **Every action must guard with
`requireRole` / `requireSession` and check ownership itself.** Do not rely on a
policy to catch a missing check — it will not.

Why: the app talks to Postgres through Kysely on `DATABASE_URL`, as the role
`postgres`. That role owns every table and carries `rolbypassrls`, so policies
are never evaluated for the application's own queries. Separately, the role
`authenticated` holds **no grants on any table in `public`**, and `is_admin()` /
`is_ops()` / `is_consultant()` are not `SECURITY DEFINER`, so a query genuinely
running as `authenticated` fails on `permission denied` before RLS is even
reached. That is not theoretical — it is how Phase 13C's first upload broke.

This is a smaller problem than it sounds, because **the browser has no data path
to Supabase**: `src/lib/supabase/browser.ts` has no importers, the server client
is used only for auth, and everything else goes through Kysely server-side. No
untrusted client can reach the database, which is the threat RLS mainly exists
to stop. What remains is defence-in-depth against a bug in our own action —
worth having, not currently had.

## Keep writing policies anyway

Every new table still gets RLS enabled and policies written, in the patterns
below. They are the specification of who *should* be able to do what, they are
already correct, and they are what makes the fix below tractable rather than a
rewrite. Just do not treat them as a guarantee today.

## Making them real, if we ever need to

Needed only if Supabase is ever exposed directly to a browser. In order:

1. A dedicated `NOBYPASSRLS` role for the app, with explicit grants (no `DELETE`
   — see the no-hard-deletes rule), and `DATABASE_URL` pointed at it.
2. `is_admin` / `is_ops` / `is_consultant` become `SECURITY DEFINER`; they read
   `profiles`, which the app role would not be able to see.
3. An audit of the triggers that act on a user's behalf — `sync_order_current_status`,
   `validate_status_transition`, `assign_order_display_id`. This one has already
   bitten: a blanket RLS predicate on `orders` silently stranded every order at
   `sent_to_vendor`, because the status-sync trigger's UPDATE was filtered to
   zero rows with no error raised. See `data/migrations/202608181200_lock_sent_orders.ts`.
4. **The hard part.** Every policy keys on `auth.uid()`, which reads
   `request.jwt.claims` — set per request by PostgREST. A raw Postgres connection
   has no JWT, so `auth.uid()` is NULL and every policy denies. Each request would
   have to `SET LOCAL ROLE authenticated` and `SET LOCAL request.jwt.claims`
   inside its transaction, which means a `withUser(session, fn)` wrapper that
   every query and every action passes through.

Step 4 is a cross-cutting change with regression risk on every write path. Budget
days, not hours, and do it deliberately rather than incidentally.

## Helper functions

Defined in Phase 2 — use them everywhere instead of repeating the role-lookup logic:

```sql
public.current_role()    -- returns 'consultant' | 'ops' | 'admin'
public.is_admin()        -- boolean
public.is_ops()          -- boolean
public.is_consultant()   -- boolean
```

These read from `profiles` (joined on `auth.uid()`). We deliberately do NOT embed role in JWT custom claims — that would require token refresh on role changes.

## Canonical policy patterns

**Read by all authenticated**:
```sql
create policy "table_select_authenticated" on public.table
  for select to authenticated using (true);
```

**Owner OR admin writes**:
```sql
create policy "table_write_owner_admin" on public.table
  for all to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
```

**Insert restricted by role**:
```sql
create policy "table_insert_consultant_admin" on public.table
  for insert to authenticated
  with check (public.is_consultant() or public.is_admin());
```

**Parent-gated** (e.g. `windows` gated by `rooms` → `orders` ownership):
```sql
create policy "windows_write_owner_admin" on public.windows
  for all to authenticated
  using (exists (
    select 1 from public.rooms r
      join public.orders o on o.id = r.order_id
    where r.id = windows.room_id
      and (o.consultant_id = auth.uid() or public.is_admin())
  ))
  with check (...);  -- same predicate
```

**Append-only with role + ownership** (e.g. `order_status_events`):
```sql
create policy "ose_insert_advance_or_note" on public.order_status_events
  for insert to authenticated
  with check (
    public.is_ops()
    or public.is_admin()
    or (
      public.is_consultant()
      and exists (
        select 1 from public.orders o
        where o.id = order_status_events.order_id
          and o.consultant_id = auth.uid()
          and o.current_status = order_status_events.status
      )
      and order_status_events.note is not null
    )
  );
```

## Testing RLS

In the Supabase SQL editor, switch roles to verify:

```sql
-- Simulate being a specific authenticated user
select set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);

-- Now run the query you want to test
select * from public.orders;
insert into public.orders (...) values (...);  -- expect denial if unauthorised
```

Test both happy path (should succeed) and the negative case (should deny).

## Service-role isolation

The service-role client (`src/lib/supabase/admin.ts`) bypasses RLS.

It is used in seven modules today, all of them for **Supabase Storage** —
photos, curtain-type images, and the procurement PO — plus `inviteUser`. That is
not drift to be tidied away: storage policies are evaluated as `authenticated`,
which holds no table grants, so a session-scoped client cannot perform
server-side storage work at all (see the top of this file). The role guard on
the calling Server Action is the access control.

The rule that still holds: **do not reach for it to read or write application
tables.** Those go through Kysely, where the action's own guard is the check.
If you want it for a table, you are solving the wrong problem.

## Forbidden

- Disabling RLS on a table "to make things work"
- Adding `using (true)` for mutations without a real ownership check
- Using the service-role client to read or write application tables (storage is the documented exception)
- Inline role lookups (`select role from profiles where ...`) when the helper functions exist
- Granting policies to `public` or `anon` — every policy is `to authenticated`
