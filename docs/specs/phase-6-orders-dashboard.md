# Phase 6 — Orders Dashboard + Status Workflow

> ## Execution override (2026-05-29) — read this before the rest of the spec
>
> Phase 2 (auth) has been **deferred to the end of the milestone**. Implement this phase against the no-auth posture below. The rest of the spec was written assuming auth exists; reinterpret it through this lens:
>
> - **Drop the auth prerequisite.** Phase 1 + Phases 3-5 are the only prerequisites; `lib/auth` does not exist yet.
> - **No `requireRole` / `requireSession` in Server Actions.** All status transitions and edits run open until the auth retrofit. The role-based transition matrix in this spec (consultant can only X, ops can advance Y, admin can revert) still defines the *target* state, but enforce nothing in code yet — the auth retrofit will add the role checks in one pass.
> - **No role-based UI gating.** Render every action button regardless of viewer.
> - **No RLS policies.** Keep `enable row level security` on tables but skip every `create policy ...` block. Kysely connects as `postgres` and bypasses RLS.
> - **`changed_by` / `created_by` columns** on status events and orders: keep them as `uuid null`, no FK to `profiles`. Leave null on insert. The auth retrofit will tighten the FK and start populating from the session.
> - **Migrations use Kysely** (`data/migrations/*.ts`); apply with `npm run db:migrate`; regenerate types with `npm run db:codegen` → `src/lib/db/schema.ts`.
> - **Queries use Kysely** (`src/lib/db/kysely.ts`), not `supabase.from(...)`.
> - **Verification skips role tests.** Ignore "test as consultant", "as ops", "verify RLS denial", "as admin revert one step".
>
> **Execution order:** Phase 1 (done) → 3 → 4 → 5 → **Phase 6 (this)** → 7 → 2 (auth retrofit, last).

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. A static prototype lives at `docs/prototype/` showing the target UX.

Phases 1-5 are complete: auth, fabric catalog, consultation form + order creation, and per-room photos all work. The `/orders` route is currently a stub. This phase brings the dashboard to life and makes the status timeline interactive. It also upgrades the minimal edit page from Phase 5 to a full consultation-form editor.

**Read these first**:
- `docs/specs/README.md` — global conventions (mandatory)
- `docs/prototype/index.html` — the orders dashboard: stats cards (4-wide on desktop, 2-wide on mobile), filter bar, desktop table, mobile card list. Preserve the responsive pattern.
- `docs/prototype/order-detail.html` — interactive status timeline, "Advance →" button, "Add note" input under the timeline
- `docs/specs/phase-4-consultation.md` and `docs/specs/phase-5-photos.md` — confirms what exists

## Goal

`/orders` becomes a fully featured dashboard with stats, filters, and a responsive list. `/orders/[orderId]` becomes interactive: ops/admin can advance status, consultants and ops/admin can add notes to their own orders. The `/orders/[orderId]/edit` page is upgraded to allow editing the full consultation (not just photos).

## Prerequisites

- Phases 1-5 complete
- At least 5 orders created across multiple consultants and varied statuses (for testing the dashboard meaningfully)
- A user in each role (consultant, ops, admin) for testing the workflow

## Scope (in)

- Migration adding RLS policies for `order_status_events` insert (ops/admin advance; consultant can add notes on own orders)
- Migration adding a trigger `validate_status_transition` that enforces a linear flow: status can only advance to the next stage, OR stay at the current stage (for note-only events)
- Migration adding `pg_trgm` extension and trigram GIN indexes on `customers.name`, `customers.mobile`, `orders.development` for search
- `/orders` dashboard page:
  - Stat cards: Active orders / Awaiting shipment / Ready for installation / Completed this month
  - Filter bar: search (customer name / mobile / development / display_id), status select, consultant select
  - Desktop: shadcn `Table` with the same columns as the prototype
  - Mobile: card list (replicate the prototype layout)
  - URL query params drive filters (so back/forward and bookmarking work) — use `searchParams` in the RSC
- `/orders/[orderId]` interactive timeline:
  - Render all status events in chronological order with dates + author + notes
  - "Advance →" button: ops/admin only; calls `advanceOrderStatus`
  - "Add note" input under current step: ops/admin always; consultant only for own orders
  - Sonner toast on success
- `/orders/[orderId]/edit` becomes a full form (reuses `ConsultationForm` with `defaultValues` populated). Inside each room card, the photo manager from Phase 5 stays visible. Cancel → back to detail; Save → `updateOrder` Server Action then back to detail.
- Server Actions: `advanceOrderStatus`, `addStatusNote`, `updateOrder`
- (Optional) `revertOrderStatus` for admin — defer to Phase 7 if no immediate need

## Out of scope

- Customer dedup / merge (deferred)
- Bulk operations on orders (defer)
- Export to CSV / Excel (defer)
- Customer-facing portal (defer)
- Pagination on the orders list (use `limit 50` for v1; add cursor pagination later when needed)
- Notifications when status changes (Phase 7 if desired — currently scoped out per spec)

## Data model changes

```sql
-- supabase/migrations/YYYYMMDDHHMM_status_workflow.sql

-- Allow inserts on order_status_events with proper guards.
-- Phase 4 left this without insert policies (only the create_order RPC could insert).
create policy "ose_insert_advance_or_note" on public.order_status_events
  for insert to authenticated
  with check (
    -- ops/admin can insert any status (subject to transition trigger)
    public.is_ops()
    or public.is_admin()
    -- consultant can insert ONLY a note event matching current status, on own order
    or (
      public.is_consultant()
      and exists (
        select 1 from public.orders o
        where o.id = order_status_events.order_id
          and o.consultant_id = auth.uid()
          and o.current_status = order_status_events.status
      )
      and order_status_events.note is not null
      and length(order_status_events.note) > 0
    )
  );

-- Validate linear status transition.
create or replace function public.validate_status_transition() returns trigger
language plpgsql as $$
declare
  v_current public.fulfilment_status;
  v_flow text[] := array['order_made','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'];
  v_current_idx int;
  v_new_idx int;
begin
  select current_status into v_current from public.orders where id = new.order_id;
  v_current_idx := array_position(v_flow, v_current::text);
  v_new_idx := array_position(v_flow, new.status::text);

  if v_new_idx is null then
    raise exception 'unknown status';
  end if;

  -- Allow same-status (note) OR exactly +1.
  if v_new_idx <> v_current_idx and v_new_idx <> v_current_idx + 1 then
    raise exception 'invalid status transition: % -> %', v_current, new.status;
  end if;

  return new;
end
$$;

create trigger ose_validate_transition
  before insert on public.order_status_events
  for each row execute function public.validate_status_transition();

-- Trigram search indexes.
create extension if not exists pg_trgm;
create index customers_name_trgm on public.customers using gin (lower(name) gin_trgm_ops);
create index customers_mobile_trgm on public.customers using gin (mobile gin_trgm_ops);
create index orders_development_trgm on public.orders using gin (lower(development) gin_trgm_ops);
```

Apply migration and regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `advanceOrderStatus(orderId, note?)` | `src/lib/actions/status.ts` | `{ orderId: string, note?: string }` | ops or admin | `void` | `/orders/[id]`, `/orders` |
| `addStatusNote(orderId, note)` | `src/lib/actions/status.ts` | `{ orderId: string, note: string }` | consultant (own) or ops or admin | `void` | `/orders/[id]` |
| `updateOrder(orderId, input)` | `src/lib/actions/orders.ts` (extend Phase 4 file) | `{ orderId: string, input: OrderEditInput }` | owner or admin | `void` | `/orders/[id]`, `/orders/[id]/edit`, `/orders` |

`updateOrder` is the most complex action this phase — it needs to:
1. Update the customer row
2. Update the orders row
3. Diff rooms/windows: insert new rows, update existing (matched by id), delete removed ones
4. Do everything atomically — wrap in a Postgres RPC `public.update_order(jsonb)` similar to `create_order`

Sketch:

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';

const advanceSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().optional(),
});

export async function advanceOrderStatus(input: unknown) {
  const parsed = advanceSchema.parse(input);
  const session = await requireSession();
  if (!['ops', 'admin'].includes(session.profile.role)) throw new Error('forbidden');
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('current_status').eq('id', parsed.orderId).single();
  if (!order) throw new Error('not found');
  const flow = ['order_made','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'] as const;
  const idx = flow.indexOf(order.current_status);
  if (idx === flow.length - 1) throw new Error('already completed');
  const next = flow[idx + 1];
  const { error } = await supabase.from('order_status_events').insert({
    order_id: parsed.orderId,
    status: next,
    note: parsed.note ?? null,
    created_by: session.user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath('/orders');
}

const noteSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().min(1),
});

export async function addStatusNote(input: unknown) {
  const parsed = noteSchema.parse(input);
  const session = await requireSession();
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('current_status, consultant_id').eq('id', parsed.orderId).single();
  if (!order) throw new Error('not found');
  const isOwner = order.consultant_id === session.user.id;
  const role = session.profile.role;
  if (!(role === 'ops' || role === 'admin' || (role === 'consultant' && isOwner))) throw new Error('forbidden');
  const { error } = await supabase.from('order_status_events').insert({
    order_id: parsed.orderId,
    status: order.current_status,
    note: parsed.note,
    created_by: session.user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/orders/${parsed.orderId}`);
}
```

`updateOrder` via RPC:

```sql
-- supabase/migrations/YYYYMMDDHHMM_update_order_rpc.sql

create or replace function public.update_order(p_order_id uuid, payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session_user uuid := auth.uid();
  v_existing record;
  v_room jsonb;
  v_window jsonb;
  v_room_id uuid;
  v_keep_room_ids uuid[] := '{}';
  v_keep_window_ids uuid[] := '{}';
begin
  if v_session_user is null then raise exception 'not authenticated'; end if;

  select consultant_id, customer_id into v_existing from public.orders where id = p_order_id;
  if v_existing is null then raise exception 'not found'; end if;
  if v_existing.consultant_id <> v_session_user and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- Update customer.
  update public.customers set
    name = payload->'customer'->>'name',
    mobile = payload->'customer'->>'mobile',
    email = nullif(payload->'customer'->>'email', '')
  where id = v_existing.customer_id;

  -- Update order fields.
  update public.orders set
    property_type = nullif(payload->'order'->>'property_type','')::public.property_type,
    development = nullif(payload->'order'->>'development',''),
    unit_type = nullif(payload->'order'->>'unit_type',''),
    move_in_date = nullif(payload->'order'->>'move_in_date','')::date,
    price_quoted_cents = coalesce((payload->'order'->>'price_quoted_cents')::int, 0),
    deposit_cents = coalesce((payload->'order'->>'deposit_cents')::int, 0),
    general_notes = nullif(payload->'order'->>'general_notes',''),
    is_draft = coalesce((payload->'order'->>'is_draft')::boolean, false)
  where id = p_order_id;

  -- Upsert rooms.
  for v_room in select * from jsonb_array_elements(payload->'rooms') loop
    if v_room ? 'id' and (v_room->>'id') is not null then
      v_room_id := (v_room->>'id')::uuid;
      update public.rooms set
        type = (v_room->>'type')::public.room_type,
        label = v_room->>'label',
        position = (v_room->>'position')::int
      where id = v_room_id and order_id = p_order_id;
    else
      insert into public.rooms (order_id, type, label, position)
      values (p_order_id, (v_room->>'type')::public.room_type, v_room->>'label', (v_room->>'position')::int)
      returning id into v_room_id;
    end if;
    v_keep_room_ids := array_append(v_keep_room_ids, v_room_id);

    -- Upsert windows under this room.
    for v_window in select * from jsonb_array_elements(v_room->'windows') loop
      if v_window ? 'id' and (v_window->>'id') is not null then
        update public.windows set
          position = (v_window->>'position')::int,
          width_cm = nullif(v_window->>'width_cm','')::int,
          height_cm = nullif(v_window->>'height_cm','')::int,
          install_width_cm = nullif(v_window->>'install_width_cm','')::int,
          notes = nullif(v_window->>'notes',''),
          curtain_code = nullif(v_window->>'curtain_code',''),
          day_curtain_code = nullif(v_window->>'day_curtain_code',''),
          night_curtain_code = nullif(v_window->>'night_curtain_code',''),
          draw = nullif(v_window->>'draw','')::public.draw_direction
        where id = (v_window->>'id')::uuid and room_id = v_room_id
        returning id into v_window;
        v_keep_window_ids := array_append(v_keep_window_ids, (v_window->>'id')::uuid);
      else
        insert into public.windows (
          room_id, position, width_cm, height_cm, install_width_cm, notes,
          curtain_code, day_curtain_code, night_curtain_code, draw
        ) values (
          v_room_id,
          (v_window->>'position')::int,
          nullif(v_window->>'width_cm','')::int,
          nullif(v_window->>'height_cm','')::int,
          nullif(v_window->>'install_width_cm','')::int,
          nullif(v_window->>'notes',''),
          nullif(v_window->>'curtain_code',''),
          nullif(v_window->>'day_curtain_code',''),
          nullif(v_window->>'night_curtain_code',''),
          nullif(v_window->>'draw','')::public.draw_direction
        )
        returning id into v_window;
        v_keep_window_ids := array_append(v_keep_window_ids, (v_window->>'id')::uuid);
      end if;
    end loop;

    -- Delete windows of this room that weren't in the payload.
    delete from public.windows w
     where w.room_id = v_room_id
       and not (w.id = any(v_keep_window_ids));
  end loop;

  -- Delete rooms of this order that weren't in the payload (cascades windows).
  delete from public.rooms r
   where r.order_id = p_order_id
     and not (r.id = any(v_keep_room_ids));
end
$$;

grant execute on function public.update_order(uuid, jsonb) to authenticated;
```

Server Action:

```ts
export async function updateOrder(orderId: string, input: unknown) {
  const parsed = orderEditSchema.parse(input);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_order', { p_order_id: orderId, payload: parsed as unknown as Record<string, unknown> });
  if (error) throw new Error(error.message);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  revalidatePath('/orders');
}
```

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/orders` | `src/app/(app)/orders/page.tsx` (replace stub) | RSC — reads `searchParams`, fetches counts and list |
| `/orders/[orderId]` | `src/app/(app)/orders/[orderId]/page.tsx` (update) | RSC — interactive timeline buttons |
| `/orders/[orderId]/edit` | `src/app/(app)/orders/[orderId]/edit/page.tsx` (replace minimal) | RSC — full edit form with photo manager |

## Components added / updated

| Component | File | Type | Responsibility |
|---|---|---|---|
| `OrdersStats` | `src/components/orders/orders-stats.tsx` | RSC | 4 stat cards driven by counts |
| `OrdersFilters` | `src/components/orders/orders-filters.tsx` | Client | Filter bar; pushes URL params |
| `OrdersTable` | `src/components/orders/orders-table.tsx` | RSC | Desktop table (`hidden md:block`) |
| `OrdersCards` | `src/components/orders/orders-cards.tsx` | RSC | Mobile card list (`md:hidden`) |
| `OrderStatusBadge` | (Phase 4) | RSC | already exists |
| `StatusTimeline` | `src/components/orders/status-timeline.tsx` | RSC | Update to accept events with notes + authors |
| `AdvanceStatusButton` | `src/components/orders/advance-status-button.tsx` | Client | Calls `advanceOrderStatus` |
| `AddStatusNoteForm` | `src/components/orders/add-status-note-form.tsx` | Client | Input + button; calls `addStatusNote` |
| `ConsultationForm` | `src/components/orders/consultation-form/index.tsx` | Client | Accept `mode: 'create' \| 'edit'` and `defaultValues`; submit calls `createOrder` or `updateOrder` |

## UI references

- `docs/prototype/index.html`:
  - Stat cards: `grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4`
  - Filter bar: `flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3`; selects sit in a 2-col grid on mobile
  - Desktop table columns and class names — match exactly
  - Mobile cards: customer name + dev/order# + price + status badge + move-in line + consultant
- `docs/prototype/order-detail.html`:
  - Status timeline with vertical line, numbered dots, ✓ for completed, ring for current
  - "Add note" input + button under the timeline (stacks vertically on mobile)
  - Status colours: `bg-emerald-500` for completed dots, `bg-teal-500 ring-teal-100` for current, `bg-slate-200` for upcoming

## Implementation tasks

1. **Write the status-workflow migration + update-order RPC migration**, apply, regenerate types.

2. **Extend `src/lib/actions/status.ts`** with `advanceOrderStatus` and `addStatusNote`.

3. **Extend `src/lib/actions/orders.ts`** with `updateOrder`. Define `orderEditSchema` in `src/lib/validation/order.ts` — same shape as `orderCreateSchema` but rooms/windows may have an optional `id` field.

4. **Build the dashboard page** `/orders`:
   - `searchParams: { q?, status?, consultant? }`
   - Stats: aggregate queries on `orders` table:
     - Active = `current_status not in ('completed')`
     - Awaiting shipment = `current_status in ('order_made','sent_logistic','shipping_sg')`
     - Ready for installation = `current_status in ('delivered_checked','fulfilment')`
     - Completed this month = `current_status = 'completed' and updated_at >= date_trunc('month', now())`
   - List query: join `customers`, `profiles!consultant_id`; apply filters via `ilike` on customer name / mobile / development / `display_id`; order by `created_at desc`; limit 50
   - Render `<OrdersStats counts={...} />`, `<OrdersFilters defaults={searchParams} consultants={...} />`, then `<OrdersTable orders={...} />` + `<OrdersCards orders={...} />`

5. **Build `OrdersFilters` Client Component**:
   - Inputs: search text, status select, consultant select
   - On change, `router.push('/orders?q=...&status=...&consultant=...')`
   - Debounce search input by ~300ms

6. **Update `StatusTimeline`** to render events from `order_status_events` ordered ascending:
   - For each event, render the dot (✓ if status < current, ring if equal, number if upcoming), label, date (formatted with `Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })`), author full name, and the note if present
   - Below the timeline:
     - `<AdvanceStatusButton orderId={...} disabled={isCompleted || !canAdvance} />`
     - `<AddStatusNoteForm orderId={...} canAdd={canAddNote} />`
   - Pass `canAdvance` (role-derived) and `canAddNote` (role + ownership-derived) as props from the RSC

7. **Build `AdvanceStatusButton`**:
   - shadcn `Button` (teal-600), label "Advance →" or "Completed" if at end
   - On click: open a small confirm dialog with a note input → confirm → calls `advanceOrderStatus({ orderId, note })`
   - Toast on success

8. **Build `AddStatusNoteForm`**:
   - Input + button (stacked on mobile)
   - On submit: calls `addStatusNote({ orderId, note })` → clear input → toast

9. **Refactor `ConsultationForm`** to accept `mode` and `defaultValues`:
   - In create mode: empty defaults, submit calls `createOrder`
   - In edit mode: populated, submit calls `updateOrder(orderId, ...)` and redirects back to `/orders/[orderId]`
   - In edit mode, each `RoomCard` ALSO renders the `PhotoUploader` from Phase 5 (use `room.id` from defaultValues)
   - New rooms (no id yet) hide the photo uploader with a note "Save first to add photos to this room"

10. **Implement `/orders/[orderId]/edit`** as a wrapper:
    - Auth: owner or admin
    - Fetch full order with rooms + windows + customer + photos (with signed URLs)
    - Render `<ConsultationForm mode="edit" orderId={...} defaultValues={...} />`

11. **Smoke test**:
    - As consultant: visit `/orders` → see your stats + list
    - Filter by status, by consultant, by search → URL updates
    - Click an order → see interactive timeline
    - Try to advance status: button hidden / disabled (consultant)
    - Add a note to your own order: works
    - Edit the order: change customer name, add a room, remove a window, save → all persists; photos preserved
    - As ops: status advance works; cannot edit consultation
    - As admin: everything works
    - Try to advance past `completed`: button shows "Completed" disabled
    - Try to send a non-sequential status via SQL: trigger rejects

12. **Mobile QA**: dashboard cards render at 375px, filter bar collapses, timeline stays readable.

13. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(orders): dashboard + interactive status workflow + edit"
    git push
    ```

## Verification

- [ ] `/orders` lists orders with correct stat counts
- [ ] Search by customer name finds matching orders (case-insensitive)
- [ ] Status filter narrows results correctly
- [ ] Consultant filter narrows results correctly
- [ ] Filter changes update the URL (?q=...&status=...) so back/forward works
- [ ] Desktop shows table; mobile shows cards (375px)
- [ ] Order detail timeline shows all status events in chronological order with author + note
- [ ] Ops can advance status; transition trigger enforces linear flow
- [ ] Consultant cannot advance status (button hidden)
- [ ] Consultant can add a note to their own order; appears in timeline
- [ ] Ops/admin can add notes to any order
- [ ] Direct SQL attempt by consultant to insert advance event for someone else's order is denied by RLS
- [ ] Edit page: owner/admin can edit and save; non-owner consultant cannot access
- [ ] Editing preserves room IDs (and therefore photos)
- [ ] Adding a new room in edit mode persists; deleting a room cascade-deletes its windows and photos
- [ ] Search trigram indexes used (verify with `explain` on a sample query)

## Hand-off to next phase

After Phase 6, the next phase (Phase 7 — Admin + Polish) can assume:

- All prototype-feature parity is achieved
- `advanceOrderStatus`, `addStatusNote`, `updateOrder` actions exist and are tested
- The `pg_trgm` extension is enabled and search performs well
- The `ConsultationForm` supports both create and edit modes
- Phase 7's scope is purely additive: admin user management UI, optional polish (empty states, skeleton loaders, optional `revertOrderStatus`, mobile QA pass)
