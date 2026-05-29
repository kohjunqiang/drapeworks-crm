# Phase 3 — Fabric Catalog (Full CRUD Vertical Slice)

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. A static prototype lives at `docs/prototype/` showing the target UX.

Phases 1 and 2 are complete: the app deploys to Railway, users sign in via magic link, and the `(app)` route group is auth-protected with a top nav. `profiles` table exists with 3 roles (consultant/ops/admin).

This phase implements the **fabric catalog** end-to-end. It's the simplest vertical slice (single table, no nested data, no photos) and de-risks the RLS + forms + Server Actions stack before tackling the more complex consultation form in Phase 4.

**Read these first**:
- `docs/specs/README.md` — global conventions (mandatory)
- `docs/prototype/fabrics.html` — visual + interaction reference; also the source of seed fabric data (extract the `fabrics: [...]` array from the Alpine.js script)
- `docs/specs/phase-1-scaffold.md` and `docs/specs/phase-2-auth.md` — confirms what already exists

## Goal

Admins can add, edit, and toggle (Active/Discontinued) fabric codes via a CRUD interface. Consultants and ops can browse but not modify. The fabric catalog drives dropdown options in the consultation form (Phase 4).

## Prerequisites

- Phases 1 and 2 complete
- The user testing has been promoted to `admin` role manually in Supabase dashboard
- shadcn primitives from Phase 2 installed (button, input, label, card, dropdown-menu, sheet, avatar)

## Scope (in)

- shadcn primitives added: `dialog`, `form`, `select`, `badge`, `table`, `toast` (or `sonner`)
- Migration creating `fabric_type`, `fabric_status` enums and `fabrics` table
- RLS policies on `fabrics` (read all authenticated, write admin only)
- Seed migration with the 9 fabrics from the prototype
- `/fabrics` page: header, filter bar (search/type/status), desktop table + mobile cards (preserve prototype's `md:` breakpoint pattern)
- "Add fabric" button (admin only) opens a shadcn `Dialog` with form
- Click "Edit" row action opens the same dialog pre-filled
- Toggle status button on each row
- Zod schema for fabric validation (shared between server action and client form)
- Server Actions: `upsertFabric`, `toggleFabricStatus`
- Code field is **disabled when editing** (immutable PK)
- Sonner (or shadcn `toast`) notifications for success/error feedback

## Out of scope

- Fabric deletion (only toggle Active/Discontinued)
- Bulk import / CSV upload (defer)
- Image upload for fabric swatches (just hex colour for v1)
- Supplier as a separate table (free text for now)
- Search via `pg_trgm` (use `ilike` for v1 — small catalog, exact-or-prefix match is fine)

## Data model changes

```sql
-- supabase/migrations/YYYYMMDDHHMM_fabrics.sql

create type public.fabric_type as enum ('Day', 'Night', 'Both');
create type public.fabric_status as enum ('Active', 'Discontinued');

create table public.fabrics (
  code text primary key,
  name text not null,
  type public.fabric_type not null,
  supplier text,
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  status public.fabric_status not null default 'Active',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger fabrics_set_updated_at
  before update on public.fabrics
  for each row execute function public.set_updated_at();

-- Prevent code mutation after insert.
create or replace function public.guard_fabric_code_immutable() returns trigger
language plpgsql as $$
begin
  if (new.code is distinct from old.code) then
    raise exception 'fabric code is immutable';
  end if;
  return new;
end
$$;

create trigger fabrics_guard_code
  before update on public.fabrics
  for each row execute function public.guard_fabric_code_immutable();

-- Indexes for filtering.
create index fabrics_status_idx on public.fabrics (status);
create index fabrics_type_idx on public.fabrics (type);

alter table public.fabrics enable row level security;

create policy "fabrics_select_authenticated"
  on public.fabrics for select to authenticated
  using (true);

create policy "fabrics_insert_admin"
  on public.fabrics for insert to authenticated
  with check (public.is_admin());

create policy "fabrics_update_admin"
  on public.fabrics for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy (admins toggle status to Discontinued instead).
```

Second migration with seed data:

```sql
-- supabase/migrations/YYYYMMDDHHMM_seed_fabrics.sql

insert into public.fabrics (code, name, type, supplier, color, status, notes) values
  ('DW-D-101', 'Linen Sheer Ivory',           'Day',   'Textura SG',  '#f5ecd9', 'Active',       null),
  ('DW-D-102', 'Cotton Sheer White',          'Day',   'Textura SG',  '#fafafa', 'Active',       null),
  ('DW-D-115', 'Voile Champagne',             'Day',   'KH Fabrics',  '#e8d9b8', 'Active',       'Lead time 3 weeks'),
  ('DW-N-201', 'Velvet Blackout Charcoal',    'Night', 'KH Fabrics',  '#3a3a3a', 'Active',       null),
  ('DW-N-202', 'Cotton Blackout Beige',       'Night', 'Textura SG',  '#d4c2a0', 'Active',       null),
  ('DW-N-210', 'Dimout Navy',                 'Night', 'Asia Drapery','#1e2b4a', 'Active',       null),
  ('DW-N-220', 'Suede Blackout Olive',        'Night', 'KH Fabrics',  '#5a5d3a', 'Discontinued', 'Replaced by DW-N-225'),
  ('DW-T-301', 'Waterproof Roller White',     'Both',  'Rollco',      '#f3f3f3', 'Active',       'For wet areas'),
  ('DW-T-302', 'PVC Roller Grey',             'Both',  'Rollco',      '#9aa0a6', 'Active',       null)
on conflict (code) do nothing;
```

Apply migrations and regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `upsertFabric(input)` | `src/lib/actions/fabrics.ts` | `{ code, name, type, supplier, color, notes, isNew }` | admin | `void` | `/fabrics` |
| `toggleFabricStatus(code)` | `src/lib/actions/fabrics.ts` | `string` | admin | `void` | `/fabrics` |

Action sketch:

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { fabricSchema } from '@/lib/validation/fabric';

export async function upsertFabric(input: unknown) {
  await requireRole(['admin']);
  const parsed = fabricSchema.parse(input);
  const supabase = await createClient();
  const { error } = await supabase.from('fabrics').upsert({
    code: parsed.code,
    name: parsed.name,
    type: parsed.type,
    supplier: parsed.supplier ?? null,
    color: parsed.color,
    notes: parsed.notes ?? null,
    // status: keep existing on update; default 'Active' is in the DB for new rows
  });
  if (error) throw new Error(error.message);
  revalidatePath('/fabrics');
}

export async function toggleFabricStatus(code: string) {
  await requireRole(['admin']);
  const supabase = await createClient();
  const { data: current, error: readErr } = await supabase
    .from('fabrics').select('status').eq('code', code).single();
  if (readErr || !current) throw new Error(readErr?.message ?? 'not found');
  const next = current.status === 'Active' ? 'Discontinued' : 'Active';
  const { error } = await supabase.from('fabrics').update({ status: next }).eq('code', code);
  if (error) throw new Error(error.message);
  revalidatePath('/fabrics');
}
```

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/fabrics` | `src/app/(app)/fabrics/page.tsx` (replace stub) | RSC — fetches fabrics + role; renders table |

## Components added

| Component | File | Type | Responsibility |
|---|---|---|---|
| `FabricsTable` | `src/components/fabrics/fabrics-table.tsx` | Client | Search/filter state, renders desktop table or mobile cards depending on viewport |
| `FabricFormDialog` | `src/components/fabrics/fabric-form-dialog.tsx` | Client | shadcn Dialog wrapping the add/edit form; uses RHF + Zod |
| `FabricSwatch` | `src/components/fabrics/fabric-swatch.tsx` | RSC | Small coloured square preview |
| `FabricStatusBadge` | `src/components/fabrics/fabric-status-badge.tsx` | RSC | Active/Discontinued pill |
| `FabricTypeBadge` | `src/components/fabrics/fabric-type-badge.tsx` | RSC | Day/Night/Both pill (Day=teal, Night=indigo, Both=slate per prototype) |

Shared validation:

| File | Contents |
|---|---|
| `src/lib/validation/fabric.ts` | `fabricSchema = z.object({ code: z.string().regex(/^DW-[A-Z]-\d{3,}$/), name: z.string().min(1), type: z.enum(['Day','Night','Both']), supplier: z.string().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), notes: z.string().optional(), isNew: z.boolean().optional() })` |

## UI references

- `docs/prototype/fabrics.html` — full layout including:
  - Header with title + "Add fabric" button (button hidden for non-admins)
  - Filter bar: search input + type select + status select (stacks vertically under `sm`)
  - Desktop table with columns: Preview swatch | Code (mono font) | Name | Type badge | Supplier | Status badge | Actions
  - Mobile card layout: 12px square swatch | name + code stacked | type/status badges stacked on right | supplier line | edit/discontinue actions on bottom
  - Modal/dialog form: 2-col code+type, name (full width), 2-col supplier+colour picker, notes textarea
- Match colours exactly:
  - Type badges: Day = `bg-teal-100 text-teal-700`, Night = `bg-indigo-100 text-indigo-700`, Both = `bg-slate-200 text-slate-700`
  - Status badges: Active = `bg-emerald-100 text-emerald-700`, Discontinued = `bg-slate-100 text-slate-600`

## Implementation tasks

1. **Add shadcn primitives**:
   ```bash
   npx shadcn@latest add dialog form select badge table sonner
   ```
   Add `<Toaster />` to `src/app/layout.tsx` (root) so toasts work across the app.

2. **Write fabric migration + RLS migration + seed migration** (SQL above), apply with `supabase db push`, regenerate types.

3. **Create the Zod schema** at `src/lib/validation/fabric.ts`.

4. **Create the Server Actions** at `src/lib/actions/fabrics.ts` (sketch above).

5. **Create the badge + swatch components** (RSC, presentational).

6. **Create `FabricFormDialog`** as a Client Component using:
   - shadcn `Dialog` + `DialogTrigger` (pass `trigger` prop OR use controlled `open`/`onOpenChange`)
   - shadcn `Form` (uses RHF) bound to `fabricSchema`
   - Inputs: code (text, disabled when editing), name (text), type (select), supplier (text), colour (`<input type="color">`), notes (textarea)
   - On submit: call `upsertFabric(values)`; on success show toast + close dialog
   - Accept `defaultValues` prop (undefined = "Add" mode, populated = "Edit" mode)

7. **Create `FabricsTable`** as a Client Component:
   - Accept `fabrics: Fabric[]` and `isAdmin: boolean` props
   - State: `search`, `filterType`, `filterStatus`, `editingFabric`, `dialogOpen`
   - Derived: filtered list
   - Render: filter bar (search input + 2 selects in a grid on mobile, flex row on desktop) + desktop table (`hidden md:block`) + mobile cards (`md:hidden space-y-3`)
   - Each row/card: swatch + meta + badges + actions
   - Actions: "Edit" button (only when `isAdmin`) sets `editingFabric` and opens dialog; "Discontinue"/"Reactivate" button calls `toggleFabricStatus(code)` (only when `isAdmin`)
   - Render `<FabricFormDialog>` once, controlled by `dialogOpen` + `editingFabric`
   - For non-admins: hide both action buttons; show "View only" hint or just hide the actions column

8. **Implement `/fabrics` page** (RSC):
   ```tsx
   import { requireSession } from '@/lib/auth/require-role';
   import { createClient } from '@/lib/supabase/server';
   import { FabricsTable } from '@/components/fabrics/fabrics-table';
   import { Button } from '@/components/ui/button';

   export default async function FabricsPage() {
     const session = await requireSession();
     const supabase = await createClient();
     const { data: fabrics } = await supabase
       .from('fabrics')
       .select('*')
       .order('code', { ascending: true });
     const isAdmin = session.profile.role === 'admin';
     return (
       <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
         <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
           <div>
             <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Fabric Catalog</h1>
             <p className="text-sm text-slate-500 mt-1">Manage the curtain codes consultants can select from</p>
           </div>
           {/* "Add" button rendered inside FabricsTable so it can wire to the dialog */}
         </div>
         <FabricsTable fabrics={fabrics ?? []} isAdmin={isAdmin} />
       </main>
     );
   }
   ```
   The "+ Add fabric" button is part of `FabricsTable` (so it shares state with the dialog).

9. **Test as admin**:
   - Add a new fabric (e.g. DW-D-999, "Test Sheer", Day, supplier "X", colour `#aabbcc`)
   - Edit it (code field should be disabled)
   - Toggle to Discontinued, then back to Active
   - Toast appears on each successful save

10. **Test as consultant** (change your role temporarily in Supabase dashboard):
    - Cannot see "Add fabric" button
    - Cannot see Edit / Discontinue actions
    - Can read all fabrics including Discontinued ones
    - Direct API call test in browser console:
      ```js
      // expect failure
      fetch('/api/...').then(...)
      ```
      (Or call from Supabase JS client in browser DevTools using anon role.)

11. **Verify RLS in SQL editor**:
    ```sql
    -- as consultant
    select set_config('request.jwt.claims', '{"sub":"<consultant-uuid>"}', true);
    insert into fabrics (code, name, type, color) values ('TEST', 'x', 'Day', '#000000');  -- expect RLS denial
    ```

12. **Switch yourself back to admin** for upcoming phases.

13. **Mobile QA**: open `/fabrics` at iPhone SE width (375px), confirm:
    - Filter bar stacks vertically; type/status selects sit side-by-side in a 2-col grid
    - Each fabric renders as a card (no table)
    - Modal becomes a bottom-sheet style (the prototype uses `items-end sm:items-center` — replicate this)

14. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(fabrics): full CRUD vertical slice with RLS"
    git push
    ```
    Verify on Railway.

## Verification

- [ ] Migrations applied; `select * from public.fabrics` returns 9 seed rows
- [ ] `/fabrics` lists all 9 seed fabrics with swatches and badges
- [ ] Admin can add a new fabric and the list updates without reload
- [ ] Admin editing a fabric sees the code field disabled
- [ ] Admin toggle: Active → Discontinued (and back) works; badge updates
- [ ] Non-admin (consultant/ops): no Add/Edit/Toggle UI visible; direct RLS attempts denied
- [ ] Search filters by code or name (case-insensitive contains)
- [ ] Type filter narrows to Day/Night/Both
- [ ] Status filter narrows to Active/Discontinued
- [ ] Mobile: cards render under `md`, dialog renders as bottom sheet
- [ ] Toasts appear on success and on error (try submitting invalid colour like "red")
- [ ] Attempting to update code in Supabase SQL editor as admin still fails with "fabric code is immutable" trigger

## Hand-off to next phase

After Phase 3, the next phase can assume:

- `fabrics` table exists with seeded data; FKs from `windows` (Phase 4) will reference `fabrics.code`
- The RLS pattern (`is_admin()` / `is_ops()` / `is_consultant()` helpers) is proven and can be applied to other tables
- shadcn `dialog`, `form`, `select`, `badge`, `table`, `sonner` are installed
- The Zod-validation-and-Server-Action pattern is established at `src/lib/validation/*` and `src/lib/actions/*`
- The desktop-table-vs-mobile-cards responsive pattern is proven and should be copied for the orders list in Phase 6
- A reusable toast helper (Sonner) is wired and ready for Phase 4 to display "Order created" notifications
