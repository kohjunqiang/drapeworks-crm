# Phase 7 — Admin (User Management) + Polish

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. A static prototype lives at `docs/prototype/` showing the target UX.

Phases 1-6 are complete: the app has full feature parity with the prototype. Auth, fabrics, consultation form with photos, dashboard, status workflow, and order editing all work. This final phase adds admin tooling (user invitation + role management) and polish (empty states, loading skeletons, optional status reversal, final mobile QA).

**Read these first**:
- `docs/specs/README.md` — global conventions (mandatory)
- `docs/specs/phase-2-auth.md` — `profiles` table and role helpers (mandatory)
- `docs/specs/phase-6-orders-dashboard.md` — status workflow + transition trigger
- All four prototype HTML files for final mobile QA reference

## Goal

Admins can invite new users with a specific role from the UI (no more "edit profiles in Supabase dashboard"). Admins can change other users' roles and deactivate users. The app gets a polish pass: empty states on every list, loading skeletons, optional status-reversal action, and a final mobile/accessibility QA pass. Ship v1.

## Prerequisites

- Phases 1-6 complete
- Supabase project has the service role key available (already required by the Dockerfile env vars from Phase 1)
- At least one user is `admin` (for testing the admin pages)

## Scope (in)

- `src/lib/supabase/admin.ts` — service-role admin client (used ONLY for `inviteUser`; documented and isolated)
- `/admin` layout that gates on `role === 'admin'` (returns `notFound()` otherwise)
- `/admin/users` page: list all profiles with email, name, role, status (Active/Inactive); admin actions (Edit role, Deactivate/Reactivate, Resend invite)
- "Invite user" dialog: email + full name + role; calls `inviteUser` action which uses `auth.admin.inviteUserByEmail`
- Server Actions: `inviteUser`, `updateUserRole`, `setUserActive`, `revertOrderStatus`
- Migration: `users_status` policy adjustments (admin can update any profile's role and `is_active`)
- `revertOrderStatus(orderId, reason)` — admin-only action that inserts a "compensating" event going back one stage. Requires updating the transition trigger to allow exactly -1 transition when role is admin.
- Polish:
  - Empty state on `/orders` ("No orders yet — create your first consultation")
  - Empty state on `/fabrics` (unlikely to be empty post-seed, but render gracefully)
  - Loading skeletons on `/orders` and `/orders/[orderId]` (Suspense + skeleton placeholders)
  - Active link state in nav is correct on all pages
  - All buttons have proper `disabled` and loading states during Server Action calls (use `useTransition` or shadcn `Form` patterns)
  - Final accessibility pass: focus rings visible (Tailwind default is fine), labels associated with inputs, semantic HTML, `aria-label` on icon-only buttons
  - Final mobile QA at iPhone SE width (375px) across every screen

## Out of scope

- Bulk user import
- Password-based login (still magic link)
- SSO / Google login
- Auditing (who changed what) beyond the existing `created_by` columns
- Customer-facing portal
- Email notifications on status change (decided no for v1)

## Data model changes

```sql
-- supabase/migrations/YYYYMMDDHHMM_admin_user_mgmt.sql

-- Admin must be able to update other profiles' role and is_active.
-- (Phase 2 only allowed users to update their own row, and blocked role change unless admin.)
-- Add an admin-update policy.

create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Update the role-guard trigger: allow role mutation by admin (already implemented in Phase 2).
-- No change needed — the trigger already permits if is_admin().

-- Allow admin to revert status by one step.
-- Update the validate_status_transition trigger to allow -1 when caller is admin.
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

  -- Same status (note), +1 (advance), or -1 (admin revert).
  if v_new_idx = v_current_idx then
    -- note event; allowed
    return new;
  end if;
  if v_new_idx = v_current_idx + 1 then
    -- advance; allowed
    return new;
  end if;
  if v_new_idx = v_current_idx - 1 and public.is_admin() then
    -- revert; admin only
    return new;
  end if;

  raise exception 'invalid status transition: % -> %', v_current, new.status;
end
$$;
```

Apply migration and regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `inviteUser(input)` | `src/lib/actions/users.ts` | `{ email, fullName, role }` | admin | `{ userId }` | `/admin/users` |
| `updateUserRole(userId, role)` | `src/lib/actions/users.ts` | `{ userId, role }` | admin (not self — block changing your own role) | `void` | `/admin/users` |
| `setUserActive(userId, active)` | `src/lib/actions/users.ts` | `{ userId, active: boolean }` | admin (not self) | `void` | `/admin/users` |
| `revertOrderStatus(orderId, reason)` | `src/lib/actions/status.ts` | `{ orderId, reason: string }` | admin | `void` | `/orders/[id]`, `/orders` |

`inviteUser` sketch (uses service-role client):

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/require-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: z.enum(['consultant', 'ops', 'admin']),
});

export async function inviteUser(input: unknown) {
  await requireRole(['admin']);
  const parsed = inviteSchema.parse(input);
  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.email, {
    redirectTo: `${siteUrl}/auth/callback`,
    data: { full_name: parsed.fullName },
  });
  if (error) throw new Error(error.message);
  const userId = data.user!.id;
  // The handle_new_auth_user trigger created a profile with default 'consultant'.
  // If the requested role differs, update it via the regular server client (which RLS allows because we're admin).
  if (parsed.role !== 'consultant') {
    const supabase = await createClient();
    const { error: roleErr } = await supabase
      .from('profiles')
      .update({ role: parsed.role, full_name: parsed.fullName })
      .eq('id', userId);
    if (roleErr) throw new Error(roleErr.message);
  }
  revalidatePath('/admin/users');
  return { userId };
}
```

`updateUserRole` and `setUserActive` use the regular server client (RLS-respecting; admin policy permits).

`revertOrderStatus`:

```ts
const revertSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
});

export async function revertOrderStatus(input: unknown) {
  const parsed = revertSchema.parse(input);
  const session = await requireRole(['admin']);
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('current_status').eq('id', parsed.orderId).single();
  if (!order) throw new Error('not found');
  const flow = ['order_made','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'] as const;
  const idx = flow.indexOf(order.current_status);
  if (idx === 0) throw new Error('cannot revert further');
  const prev = flow[idx - 1];
  const { error } = await supabase.from('order_status_events').insert({
    order_id: parsed.orderId,
    status: prev,
    note: `[REVERTED] ${parsed.reason}`,
    created_by: session.user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath('/orders');
}
```

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/admin/layout.tsx` | `src/app/(app)/admin/layout.tsx` | RSC — calls `requireRole(['admin'])`; renders a sub-nav with "Users" link |
| `/admin/users` | `src/app/(app)/admin/users/page.tsx` | RSC — fetches all profiles + renders table |
| Loading files | `src/app/(app)/orders/loading.tsx`, `src/app/(app)/orders/[orderId]/loading.tsx`, `src/app/(app)/fabrics/loading.tsx` | RSC — render shadcn `Skeleton` placeholders |

## Components added

| Component | File | Type | Responsibility |
|---|---|---|---|
| `AdminSubnav` | `src/components/admin/admin-subnav.tsx` | Client (uses pathname) | Sub-nav for `/admin/*` |
| `UsersTable` | `src/components/admin/users-table.tsx` | Client | Table + edit/deactivate actions |
| `InviteUserDialog` | `src/components/admin/invite-user-dialog.tsx` | Client | Form to invite |
| `RoleSelect` | `src/components/admin/role-select.tsx` | Client | Inline role editor for a row |
| `RevertStatusDialog` | `src/components/orders/revert-status-dialog.tsx` | Client | Admin-only button + dialog on order detail |
| `EmptyState` | `src/components/ui/empty-state.tsx` | RSC | Reusable empty-state component with icon, title, description, optional CTA |

Update existing:
- Add `<EmptyState>` rendering when `/orders` list is empty
- Add `<RevertStatusDialog>` to the order detail page for admins
- Add `loading.tsx` files for Suspense boundaries

Supabase admin client:

```ts
// src/lib/supabase/admin.ts
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

This file must include a comment at the top: `// DANGER: this client bypasses RLS. Only use for admin user invites.`

## UI references

- `/admin/users` table: same pattern as `/fabrics` (desktop table + mobile cards under `md`)
- Invite dialog: shadcn `Dialog` with form, single-column layout (mobile-friendly)
- Role select: shadcn `Select` inline in the row (or a small dropdown)
- Empty state: centred icon + title + description + CTA, generous padding (`py-16`)

## Implementation tasks

1. **Write the migration** (admin profile update policy + transition trigger update), apply, regenerate types.

2. **Create the admin Supabase client** at `src/lib/supabase/admin.ts`. Add prominent comment about RLS bypass.

3. **Create the Server Actions** at `src/lib/actions/users.ts` (invite, updateRole, setActive) and extend `src/lib/actions/status.ts` with `revertOrderStatus`.

4. **Build `/admin/layout.tsx`** with role gate + sub-nav.

5. **Build `/admin/users/page.tsx`**:
   - Fetch all profiles ordered by created_at
   - Render `<UsersTable>` with rows
   - Top-right: "+ Invite user" button → opens `<InviteUserDialog>`

6. **Build `UsersTable`**:
   - Columns: Avatar + Name | Email | Role (inline `<RoleSelect>`) | Status (badge + toggle button) | Created
   - Don't allow admin to demote themselves (disable the role select on own row)
   - Don't allow admin to deactivate themselves
   - Confirmation dialog before deactivating any user

7. **Build `InviteUserDialog`** with RHF + Zod form (email + full name + role select). On submit: call `inviteUser`; toast success.

8. **Build `RevertStatusDialog`** for the order detail page. Admin sees a small "Revert status" button below the timeline. Click opens a dialog with reason input + confirm. Calls `revertOrderStatus`.

9. **Add `loading.tsx` files** with shadcn `Skeleton` placeholders for each list/detail route.

10. **Add `EmptyState` component** and use it on `/orders` and (defensively) on `/fabrics`.

11. **Polish pass**:
    - All Server Action buttons use `useTransition` to show a loading spinner / disable during submission
    - Hover/focus states on every interactive element (Tailwind defaults work; verify with keyboard nav)
    - `<title>` on every page via Next.js `metadata` exports
    - Mobile QA: walk through every screen at 375px width, fix any clipping or wrapping issues
    - Accessibility: every `<button>` without text has `aria-label`; every form input has an associated `<Label>`; every `<a>` not styled as a button has visible underline on focus

12. **End-to-end smoke test** as described in `docs/specs/README.md`:
    - Admin invites a new consultant via UI → invitee receives email → clicks magic link → signs in → lands on `/orders` (empty state shown)
    - Consultant creates an order with photos
    - Ops advances status to `completed` through all stages
    - Admin reverts status once to test revert
    - All mobile + desktop layouts work

13. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(admin): user management + polish (v1 ready)"
    git push
    ```

## Verification

- [ ] Non-admin cannot visit `/admin/users` (gets 404)
- [ ] Admin can invite a new user with a chosen role
- [ ] Invitee receives email, clicks link, signs in successfully with the assigned role
- [ ] Admin can change another user's role (badge updates immediately after save)
- [ ] Admin cannot demote themselves (UI disables; backend rejects)
- [ ] Admin can deactivate another user; deactivated user is logged out on next request (since `getSession` returns null when `is_active = false`)
- [ ] Admin can reactivate a user
- [ ] Admin can revert order status by one step; reason recorded in the event note
- [ ] Status reversal beyond `order_made` is blocked (trigger raises)
- [ ] Non-admin cannot call `revertOrderStatus` (action returns 403)
- [ ] Empty states render with CTAs ("Create your first consultation")
- [ ] Loading skeletons appear during slow loads (test by throttling network in DevTools)
- [ ] Mobile QA pass: no horizontal scroll on any page at 375px
- [ ] Keyboard navigation: can tab through all interactive elements with visible focus

## Hand-off

Drapeworks CRM v1 is shipped. Future versions can pick up:
- Email notifications on status change
- Print-friendly spec sheet for orders
- Customer dedup and merge tooling
- Bulk operations on orders
- Export to CSV/Excel
- Customer-facing portal for order tracking
- PWA offline support for consultants on-site
- Native mobile app (React Native or Flutter)
