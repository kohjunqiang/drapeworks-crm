# Phase 4 — Consultation Form + Order Creation (No Photos Yet)

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. A static prototype lives at `docs/prototype/` showing the target UX.

Phases 1-3 are complete: auth works, the app shell is up, and the fabric catalog is fully functional. This phase is the **largest and most complex** — it implements the consultation form (the main data-entry screen) and the order creation flow end-to-end. Photos are deferred to Phase 5; everything else about an order is built here.

**Read these first**:
- `docs/specs/README.md` — global conventions (mandatory)
- `docs/prototype/consultation.html` — the form to mirror. Pay close attention to:
  - Customer details section (name, mobile, email, property type dropdown, development, unit type, move-in date)
  - Pricing section (quoted, deposit, balance auto-calc)
  - Rooms section: dynamic add/remove via "Quick add" chips, label customisation, multiple windows per room
  - Toilet rooms have a different window schema (single curtain code, no day/night/draw) — driven by `isToilet(room.type)`
  - Fabric dropdowns filtered by type (Day curtain dropdown shows Day + Both, Night curtain dropdown shows Night + Both)
- `docs/prototype/order-detail.html` — the read-only view that the form's data feeds into (for Phase 4 we render a static version; interactive timeline comes in Phase 6)
- `docs/specs/phase-3-fabrics.md` — fabric schema (Phase 4 windows FK to fabrics.code)

## Goal

Consultants can fill in a multi-room consultation form (matching the prototype exactly) and submit it to create an order. The order persists as a nested structure (order → rooms → windows). After submission they land on a read-only order detail page. Photos are dropped in Phase 4 (placeholder UI showing "Photo upload in Phase 5" inside each room card).

## Prerequisites

- Phases 1-3 complete
- Fabric catalog is seeded
- User is `consultant` or `admin` role for testing the form
- Have a second test user with `consultant` role to verify "edit only own orders" behaviour later

## Scope (in)

- Migration creating enums (`property_type`, `room_type`, `draw_direction`, `fulfilment_status`) and tables (`customers`, `orders`, `rooms`, `windows`, `order_status_events`) with triggers (display_id, window_shape, status_sync) and RLS
- Postgres RPC function `public.create_order(jsonb)` for atomic creation
- `/orders/new` page with the full consultation form (Client Component using RHF + Zod discriminated union)
- `createOrder` Server Action that calls the RPC
- Per-room "photo placeholder" UI (the actual upload comes in Phase 5)
- `/orders/[orderId]` page rendering a **read-only static view** (not yet interactive — timeline shown but Advance button disabled)
- Customer creation is inlined into order creation (always-new for v1)
- Display ID format `DW-YYYY-NNNN` with per-year counter
- "Save as draft" (sets `is_draft = true`, allows partial data) vs "Create order" (full validation)
- Optional: stub of `/orders/[orderId]/edit` (defer real edit flow to Phase 6 if too large)

## Out of scope

- Photos (Phase 5)
- Status advancement / interactive timeline (Phase 6)
- Orders list / dashboard (Phase 6)
- Edit existing orders (Phase 6)
- Customer dedup / merge (deferred)
- Search across orders (Phase 6)

## Data model changes

```sql
-- supabase/migrations/YYYYMMDDHHMM_orders_core.sql

create type public.property_type as enum ('HDB', 'Condo', 'Landed', 'Commercial');

create type public.room_type as enum (
  'Living Room', 'Master Bedroom', 'Bedroom',
  'Master Toilet', 'Common Toilet',
  'Kitchen', 'Study Room', 'Balcony', 'Other'
);

create type public.draw_direction as enum ('Double', 'Single Left', 'Single Right');

create type public.fulfilment_status as enum (
  'order_made', 'sent_logistic', 'shipping_sg',
  'delivered_checked', 'fulfilment', 'completed'
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text not null,
  email text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create index customers_mobile_idx on public.customers (mobile);
create index customers_name_lower_idx on public.customers (lower(name));

-- Per-year order sequence table (avoids race conditions).
create table public.order_year_counters (
  year int primary key,
  last_seq int not null default 0
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  display_id text not null unique,
  seq_year int not null,
  seq_num int not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  consultant_id uuid not null references public.profiles(id),
  property_type public.property_type,
  development text,
  unit_type text,
  move_in_date date,
  price_quoted_cents int not null default 0,
  deposit_cents int not null default 0,
  balance_cents int generated always as (greatest(price_quoted_cents - deposit_cents, 0)) stored,
  current_status public.fulfilment_status not null default 'order_made',
  general_notes text,
  is_draft boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index orders_current_status_idx on public.orders (current_status);
create index orders_consultant_idx on public.orders (consultant_id);
create index orders_move_in_idx on public.orders (move_in_date);
create index orders_created_at_idx on public.orders (created_at desc);

-- Display ID trigger: read+bump per-year counter, format DW-YYYY-NNNN.
create or replace function public.assign_order_display_id() returns trigger
language plpgsql as $$
declare
  v_year int := extract(year from now())::int;
  v_seq int;
begin
  insert into public.order_year_counters (year, last_seq) values (v_year, 0)
    on conflict (year) do nothing;
  update public.order_year_counters
    set last_seq = last_seq + 1
    where year = v_year
    returning last_seq into v_seq;
  new.seq_year := v_year;
  new.seq_num := v_seq;
  new.display_id := 'DW-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  return new;
end
$$;

create trigger orders_assign_display_id
  before insert on public.orders
  for each row execute function public.assign_order_display_id();

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  type public.room_type not null,
  label text not null,
  position int not null,
  created_at timestamptz not null default now()
);

create index rooms_order_idx on public.rooms (order_id, position);

create table public.windows (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  position int not null,
  width_cm int,
  height_cm int,
  install_width_cm int,
  notes text,
  -- toilet variant
  curtain_code text references public.fabrics(code),
  -- regular variant
  day_curtain_code text references public.fabrics(code),
  night_curtain_code text references public.fabrics(code),
  draw public.draw_direction,
  created_at timestamptz not null default now()
);

create index windows_room_idx on public.windows (room_id, position);

-- Shape validator: toilet rooms use curtain_code only; non-toilet use day/night/draw.
create or replace function public.validate_window_shape() returns trigger
language plpgsql as $$
declare
  v_room_type public.room_type;
  v_is_toilet boolean;
begin
  select type into v_room_type from public.rooms where id = new.room_id;
  v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
  if v_is_toilet then
    if new.day_curtain_code is not null or new.night_curtain_code is not null or new.draw is not null then
      raise exception 'toilet windows must not have day_curtain_code/night_curtain_code/draw';
    end if;
  else
    if new.curtain_code is not null then
      raise exception 'non-toilet windows must not have curtain_code (use day/night)';
    end if;
  end if;
  return new;
end
$$;

create trigger windows_validate_shape
  before insert or update on public.windows
  for each row execute function public.validate_window_shape();

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.fulfilment_status not null,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index order_status_events_order_idx on public.order_status_events (order_id, created_at desc);

-- Whenever a new status event is inserted, denormalise current_status onto orders.
create or replace function public.sync_order_current_status() returns trigger
language plpgsql as $$
begin
  update public.orders set current_status = new.status, updated_at = now()
    where id = new.order_id;
  return new;
end
$$;

create trigger order_status_events_sync
  after insert on public.order_status_events
  for each row execute function public.sync_order_current_status();
```

```sql
-- supabase/migrations/YYYYMMDDHHMM_orders_rls.sql

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.rooms enable row level security;
alter table public.windows enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_year_counters enable row level security;
-- order_year_counters only accessed via the security-definer trigger; no client policies needed.

-- customers
create policy "customers_select_authenticated" on public.customers
  for select to authenticated using (true);
create policy "customers_insert_consultant_admin" on public.customers
  for insert to authenticated with check (public.is_consultant() or public.is_admin());
create policy "customers_update_consultant_admin" on public.customers
  for update to authenticated using (public.is_consultant() or public.is_admin());
create policy "customers_delete_admin" on public.customers
  for delete to authenticated using (public.is_admin());

-- orders
create policy "orders_select_authenticated" on public.orders
  for select to authenticated using (true);
create policy "orders_insert_consultant_admin" on public.orders
  for insert to authenticated with check (
    (public.is_consultant() or public.is_admin())
    and consultant_id = auth.uid()
  );
create policy "orders_update_owner_admin" on public.orders
  for update to authenticated
  using (consultant_id = auth.uid() or public.is_admin())
  with check (consultant_id = auth.uid() or public.is_admin());

-- rooms: gate by parent order ownership
create policy "rooms_select_via_order" on public.rooms
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = rooms.order_id)
  );
create policy "rooms_write_owner_admin" on public.rooms
  for all to authenticated
  using (
    exists (
      select 1 from public.orders o where o.id = rooms.order_id
        and (o.consultant_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.orders o where o.id = rooms.order_id
        and (o.consultant_id = auth.uid() or public.is_admin())
    )
  );

-- windows: gate via rooms→orders chain
create policy "windows_select_via_order" on public.windows
  for select to authenticated using (
    exists (
      select 1 from public.rooms r where r.id = windows.room_id
    )
  );
create policy "windows_write_owner_admin" on public.windows
  for all to authenticated
  using (
    exists (
      select 1 from public.rooms r
        join public.orders o on o.id = r.order_id
       where r.id = windows.room_id
         and (o.consultant_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.rooms r
        join public.orders o on o.id = r.order_id
       where r.id = windows.room_id
         and (o.consultant_id = auth.uid() or public.is_admin())
    )
  );

-- order_status_events: select = same as order; insert = ops/admin OR (consultant for own order with note only)
create policy "ose_select_via_order" on public.order_status_events
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_status_events.order_id)
  );
-- Phase 4: only insertion path is the create_order RPC. Phase 6 will add the policy for advance/note.
```

Atomic creation RPC:

```sql
-- supabase/migrations/YYYYMMDDHHMM_create_order_rpc.sql

create or replace function public.create_order(payload jsonb)
returns table (order_id uuid, display_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_display_id text;
  v_consultant_id uuid := auth.uid();
  v_room jsonb;
  v_window jsonb;
  v_room_id uuid;
begin
  -- Authorisation: must be consultant or admin
  if v_consultant_id is null then
    raise exception 'not authenticated';
  end if;
  if not (public.is_consultant() or public.is_admin()) then
    raise exception 'role not permitted';
  end if;

  -- 1. Customer (always create new for v1)
  insert into public.customers (name, mobile, email, created_by)
  values (
    payload->'customer'->>'name',
    payload->'customer'->>'mobile',
    nullif(payload->'customer'->>'email', ''),
    v_consultant_id
  )
  returning id into v_customer_id;

  -- 2. Order
  insert into public.orders (
    customer_id, consultant_id, property_type, development, unit_type, move_in_date,
    price_quoted_cents, deposit_cents, general_notes, is_draft
  ) values (
    v_customer_id,
    v_consultant_id,
    nullif(payload->'order'->>'property_type', '')::public.property_type,
    nullif(payload->'order'->>'development', ''),
    nullif(payload->'order'->>'unit_type', ''),
    nullif(payload->'order'->>'move_in_date', '')::date,
    coalesce((payload->'order'->>'price_quoted_cents')::int, 0),
    coalesce((payload->'order'->>'deposit_cents')::int, 0),
    nullif(payload->'order'->>'general_notes', ''),
    coalesce((payload->'order'->>'is_draft')::boolean, false)
  )
  returning id, orders.display_id into v_order_id, v_display_id;

  -- 3. Insert initial status event 'order_made'
  insert into public.order_status_events (order_id, status, note, created_by)
  values (v_order_id, 'order_made', 'Order created from consultation', v_consultant_id);

  -- 4. Rooms + windows
  for v_room in select * from jsonb_array_elements(payload->'rooms') loop
    insert into public.rooms (order_id, type, label, position)
    values (
      v_order_id,
      (v_room->>'type')::public.room_type,
      v_room->>'label',
      (v_room->>'position')::int
    )
    returning id into v_room_id;

    for v_window in select * from jsonb_array_elements(v_room->'windows') loop
      insert into public.windows (
        room_id, position, width_cm, height_cm, install_width_cm, notes,
        curtain_code, day_curtain_code, night_curtain_code, draw
      ) values (
        v_room_id,
        (v_window->>'position')::int,
        nullif(v_window->>'width_cm', '')::int,
        nullif(v_window->>'height_cm', '')::int,
        nullif(v_window->>'install_width_cm', '')::int,
        nullif(v_window->>'notes', ''),
        nullif(v_window->>'curtain_code', ''),
        nullif(v_window->>'day_curtain_code', ''),
        nullif(v_window->>'night_curtain_code', ''),
        nullif(v_window->>'draw', '')::public.draw_direction
      );
    end loop;
  end loop;

  return query select v_order_id, v_display_id;
end
$$;

grant execute on function public.create_order(jsonb) to authenticated;
```

Apply all migrations, regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `createOrder(input)` | `src/lib/actions/orders.ts` | `OrderCreateInput` | consultant/admin | `{ orderId, displayId }` (then redirect to `/orders/[orderId]`) | `/orders` |

Sketch:

```ts
'use server';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { orderCreateSchema } from '@/lib/validation/order';

export async function createOrder(input: unknown) {
  await requireRole(['consultant', 'admin']);
  const parsed = orderCreateSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_order', { payload: parsed as unknown as Record<string, unknown> });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('create_order returned no row');
  redirect(`/orders/${row.order_id}`);
}
```

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/orders/new` | `src/app/(app)/orders/new/page.tsx` (replace stub) | RSC wrapper that fetches fabrics + renders `<ConsultationForm>` |
| `/orders/[orderId]` | `src/app/(app)/orders/[orderId]/page.tsx` | RSC — read-only static order view |

## Components added

| Component | File | Type | Responsibility |
|---|---|---|---|
| `ConsultationForm` | `src/components/orders/consultation-form/index.tsx` | Client | Top-level form, RHF + Zod, manages dynamic rooms |
| `CustomerSection` | `src/components/orders/consultation-form/customer-section.tsx` | Client (child) | Customer + property fields |
| `PricingSection` | `src/components/orders/consultation-form/pricing-section.tsx` | Client (child) | Quoted/deposit/balance |
| `RoomCard` | `src/components/orders/consultation-form/room-card.tsx` | Client (child) | One room with header + nested windows + photo placeholder |
| `WindowFields` | `src/components/orders/consultation-form/window-fields.tsx` | Client (child) | Branches on toilet vs regular variant |
| `QuickAddRoomBar` | `src/components/orders/consultation-form/quick-add-room-bar.tsx` | Client (child) | "Quick add" chip row |
| `PhotoPlaceholder` | `src/components/orders/consultation-form/photo-placeholder.tsx` | RSC/Client | Dashed box: "Photo upload coming in Phase 5" |
| `StatusTimeline` | `src/components/orders/status-timeline.tsx` | RSC | Visual timeline (static for now) |
| `StatusBadge` | `src/components/orders/status-badge.tsx` | RSC | Colour-coded pill per status |
| `RoomSummaryCard` | `src/components/orders/room-summary-card.tsx` | RSC | Read-only display of one room on order detail |

Shared validation:

| File | Contents |
|---|---|
| `src/lib/validation/order.ts` | `orderCreateSchema` with nested `customer`, `order`, `rooms[]` using `discriminatedUnion` for windows |
| `src/lib/status-flow.ts` | `STATUS_FLOW` array, `STATUS_LABELS` map, `STATUS_COLOURS` map, `nextStatus(current)` helper |
| `src/lib/money.ts` | `dollarsToCents(str): number`, `centsToDisplay(cents): string`, `formatSGD(cents): string` |

Zod schema sketch:

```ts
import { z } from 'zod';

const baseWindow = z.object({
  position: z.number().int().min(0),
  width_cm: z.coerce.number().int().positive().nullish(),
  height_cm: z.coerce.number().int().positive().nullish(),
  install_width_cm: z.coerce.number().int().positive().nullish(),
  notes: z.string().optional(),
});

const regularWindow = baseWindow.extend({
  variant: z.literal('regular'),
  day_curtain_code: z.string().nullish(),
  night_curtain_code: z.string().nullish(),
  draw: z.enum(['Double', 'Single Left', 'Single Right']).optional(),
});

const toiletWindow = baseWindow.extend({
  variant: z.literal('toilet'),
  curtain_code: z.string().nullish(),
});

const windowSchema = z.discriminatedUnion('variant', [regularWindow, toiletWindow]);

const roomSchema = z.object({
  type: z.enum(['Living Room', 'Master Bedroom', 'Bedroom', 'Master Toilet', 'Common Toilet', 'Kitchen', 'Study Room', 'Balcony', 'Other']),
  label: z.string().min(1),
  position: z.number().int().min(0),
  windows: z.array(windowSchema).min(1),
});

export const orderCreateSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    mobile: z.string().min(1),
    email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  }),
  order: z.object({
    property_type: z.enum(['HDB', 'Condo', 'Landed', 'Commercial']).optional(),
    development: z.string().optional(),
    unit_type: z.string().optional(),
    move_in_date: z.string().optional(), // YYYY-MM-DD
    price_quoted_cents: z.number().int().min(0).default(0),
    deposit_cents: z.number().int().min(0).default(0),
    general_notes: z.string().optional(),
    is_draft: z.boolean().default(false),
  }),
  rooms: z.array(roomSchema).min(1),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
```

Note: the RPC payload doesn't include `variant` — strip it before sending to the RPC. The Zod discriminator is purely for client-side type narrowing.

## UI references

- `docs/prototype/consultation.html` is the visual + interaction reference. Match exactly:
  - Section cards: white background, `rounded-lg border border-slate-200 p-4 sm:p-6 mb-4`
  - Customer section grid: `grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4`
  - Pricing section grid: `grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4`; balance is read-only with `bg-slate-50`
  - Quick-add chip row: white pills with hover border-teal-500
  - Each room card: `border border-slate-200 rounded-lg p-3 sm:p-4 bg-slate-50/50`
  - Window grids (regular): `grid grid-cols-2 sm:grid-cols-6 gap-3` with `col-span-2` / `col-span-3` etc.
  - Window grids (toilet): `grid grid-cols-2 sm:grid-cols-4 gap-3`
  - Action bar: `flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pb-12` with primary button bg-teal-600
- `docs/prototype/order-detail.html` for the read-only view (skip the interactive Advance button; render it disabled with tooltip "Coming in Phase 6")

## Implementation tasks

1. **Add shadcn primitives** (most are from Phase 3):
   ```bash
   npx shadcn@latest add textarea calendar popover
   ```

2. **Write migrations** (orders core, RLS, RPC), apply with `supabase db push`, regenerate types.

3. **Create helpers**:
   - `src/lib/status-flow.ts` — `STATUS_FLOW: FulfilmentStatus[]`, `STATUS_LABELS`, `STATUS_COLOURS` mirroring the prototype's colour map
   - `src/lib/money.ts` — money helpers
   - `src/lib/validation/order.ts` — Zod schema as above

4. **Create the Server Action** `src/lib/actions/orders.ts` with `createOrder` (as above). Strip the `variant` discriminator from windows before sending to the RPC.

5. **Build the form components**:
   - Use `useForm` with `zodResolver(orderCreateSchema)` and a default of `{ customer: {...}, order: {...}, rooms: [{ type: 'Living Room', label: 'Living Room', windows: [emptyRegularWindow()], position: 0 }] }`
   - Use `useFieldArray` for `rooms`
   - For each room card, a nested `useFieldArray` keyed on the room field for `windows`
   - Watch `room.type` per room and switch the window form to toilet vs regular variant; when toggling, reset the relevant window fields to avoid stale data
   - Watch `pricing.quoted` and `pricing.deposit` and compute balance live
   - Show shadcn `Sonner` toast on submit success/error
   - On submit: call `createOrder(values)` Server Action; the action redirects to `/orders/[orderId]`

6. **Quick-add bar**: hardcoded list of room templates (Living Room, Master Bedroom, Bedroom, Master Toilet, Common Toilet, Kitchen, Study Room, Balcony). On click, append a new room (auto-label "Bedroom 2" if multiple Bedrooms, etc., per prototype logic).

7. **Photo placeholder** inside each room card — render a dashed box with text "Photo upload coming in Phase 5". This keeps layout parity with the prototype but no functionality yet.

8. **Save as draft** vs **Create order**:
   - "Save as draft" sets `is_draft: true` and uses a relaxed Zod variant (just `customer.name` required; everything else optional). Easiest: have two top-level submit handlers — one passes `{ is_draft: true }` and uses `orderDraftSchema`; the other validates with `orderCreateSchema`. Or: always validate with the same schema but allow `min(0)` rooms when `is_draft`.
   - For v1 keep it simple: if you don't have time, drop "Save as draft" entirely and only ship "Create order". Add a note to Phase 7 polish.

9. **Build the read-only `/orders/[orderId]` page**:
   - Fetch order with nested rooms + windows + customer + consultant + status events via Supabase server client
   - Use a `select` with joins (e.g. `orders(*, customers(*), profiles!consultant_id(*), rooms(*, windows(*)), order_status_events(*))`)
   - Render header (customer name, badge for current status), customer/payment/consultant sidebar (mirror the prototype layout — 3-col on desktop, stacked on mobile with sidebar above on mobile)
   - Render `StatusTimeline` (static; Phase 6 makes it interactive)
   - Render `RoomSummaryCard` per room (room name header, table of windows on desktop, scrollable on mobile)
   - Add placeholder "Photos (Phase 5)" inside each room card

10. **Smoke test as consultant**:
    - `/orders/new` → fill customer + 3 rooms (1 toilet, 2 regular) → submit
    - Land on `/orders/<uuid>` showing the data
    - `display_id` follows `DW-2026-0001` pattern
    - Add a second order, `display_id` increments
    - Try invalid combos to trip the window-shape trigger (e.g. set day_curtain on a toilet via direct SQL — should error)

11. **Smoke test as a second consultant**:
    - Log in as user B (consultant)
    - Visit `/orders/<order-by-user-A>` → can read it
    - Direct API attempt to update: `supabase.from('orders').update({ general_notes: 'hack' }).eq('id', orderA)` → expect RLS denial

12. **Mobile QA** at 375px: all sections stack to single column, window field grids collapse to 2-col, action bar buttons stack vertically with primary on top.

13. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(orders): consultation form + atomic order creation"
    git push
    ```

## Verification

- [ ] Migrations applied; all enums/tables/triggers/RLS exist
- [ ] `create_order` RPC callable from authenticated client
- [ ] Submitting the form creates an order with the expected `display_id` (`DW-YYYY-NNNN`)
- [ ] One row in `customers`, one in `orders`, N rows in `rooms`, M rows in `windows`, one row in `order_status_events` (`order_made`)
- [ ] `orders.current_status` is `order_made` (set by the status-sync trigger)
- [ ] Window shape trigger rejects toilet rows with day/night fields and vice versa
- [ ] `/orders/[orderId]` renders the data correctly desktop + mobile
- [ ] Second consultant can read the order but cannot update it via SQL or PostgREST
- [ ] Admin can update any order via SQL (e.g. change `general_notes`)
- [ ] Form validation: missing customer name shows inline error; empty rooms array shows error
- [ ] Toggling a room from Bedroom to Master Toilet clears day/night/draw on its windows (UI hides those fields and clears state)
- [ ] Balance auto-calc works as user types quoted/deposit
- [ ] Sonner toast appears on success ("Order DW-2026-0001 created")

## Hand-off to next phase

After Phase 4, the next phase (Phase 5 — Photos) can assume:

- `customers`, `orders`, `rooms`, `windows`, `order_status_events` tables exist with RLS
- `create_order(jsonb)` RPC works and is callable from server actions
- `/orders/new` form persists rooms; room IDs are available for attaching photos
- `/orders/[orderId]` renders a static read-only view; the `RoomSummaryCard` is where photo strips will be added in Phase 5
- `STATUS_FLOW`, `STATUS_LABELS`, `STATUS_COLOURS` helpers exist (used by `StatusTimeline` and `StatusBadge`)
- Photo upload UI placeholder is already in the form room cards — Phase 5 swaps the placeholder for the real uploader
- Money helpers (`src/lib/money.ts`) are available for Phase 6 dashboard formatting
