# Row-Level Security (RLS)

## RLS is the source of truth

Every table has RLS enabled. Every table has explicit policies for `select`, `insert`, `update`, `delete` per role. No table should be reachable by an authenticated client without a matching policy.

Server Action role checks are **defence-in-depth**. They give clearer errors and avoid wasted round trips, but RLS must hold even if a Server Action forgets a check.

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

The service-role client (`src/lib/supabase/admin.ts`) bypasses RLS. It is reserved for exactly one use: `inviteUser` in Phase 7. If you find yourself reaching for it elsewhere, you're solving the wrong problem — fix the RLS policy or fix the calling code.

## Forbidden

- Disabling RLS on a table "to make things work"
- Adding `using (true)` for mutations without a real ownership check
- Bypassing RLS via service-role client outside the documented exception
- Inline role lookups (`select role from profiles where ...`) when the helper functions exist
- Granting policies to `public` or `anon` — every policy is `to authenticated`
