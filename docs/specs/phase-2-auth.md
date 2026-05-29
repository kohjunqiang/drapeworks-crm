# Phase 2 — Auth + Profile + App Shell + Role Helpers

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. The CRM has 3 roles: `consultant`, `ops`, `admin`. A static prototype lives at `docs/prototype/` showing the target UX.

Phase 1 has been completed: the app is scaffolded, deployed to Railway, Supabase project is linked with a `profiles` table that auto-populates when a user signs up (defaulting to `consultant` role).

**Read these first**:
- `docs/specs/README.md` — global stack decisions and conventions (mandatory)
- `docs/specs/phase-1-scaffold.md` — confirms what already exists
- `docs/prototype/index.html` — copy the nav structure (hamburger mobile menu, logo, links, user avatar) — use this layout 1:1 in `(app)/layout.tsx`

## Goal

Authenticated app shell. Users log in via Supabase magic link. The `(app)` route group is protected by a layout that redirects unauthenticated visitors to `/login`. Top nav (with mobile hamburger) renders the user's name + role and links to stub pages. Role helpers are in place for later phases.

## Prerequisites

- Phase 1 complete
- Railway domain known and added to Supabase Auth → URL Configuration (Site URL + Redirect URLs include `<domain>/auth/callback` and `http://localhost:3000/auth/callback`)
- Supabase Auth provider: Email (magic link) enabled (it is by default)

## Scope (in)

- shadcn primitives added: `card`, `dropdown-menu`, `sheet` (mobile menu), `avatar` (optional fallback to manual circle)
- `/(auth)/login` page with email-only magic-link form
- `/(auth)/layout.tsx` — minimal centred card layout
- `/auth/callback` route handler that exchanges the OTP code for a session
- `/(app)/layout.tsx` — protected layout; redirects to `/login` if no session; renders top nav
- `/(app)/orders/page.tsx`, `/(app)/orders/new/page.tsx`, `/(app)/fabrics/page.tsx` — **stub pages** (titles only — full implementation is in later phases)
- `/` redirects to `/orders` if signed in, otherwise `/login`
- `src/components/nav/top-nav.tsx` — Server Component rendering the desktop nav
- `src/components/nav/mobile-menu.tsx` — Client Component with shadcn `Sheet` for the hamburger
- `src/components/nav/user-menu.tsx` — Client Component dropdown for logout
- `src/lib/auth/get-session.ts` — `cache()`-wrapped helper that returns `{ user, profile }` or `null`
- `src/lib/auth/require-role.ts` — throws `redirect('/login')` or `notFound()` if role doesn't match
- SQL helper functions: `public.current_role()`, `public.is_admin()`, `public.is_ops()`
- RLS policies on `profiles` (select all authenticated, update own row excluding role unless admin)
- Sign-out Server Action

## Out of scope

- Password-based auth (magic link only for v1)
- Social/SSO providers
- Password reset (Supabase handles internally for magic link)
- User invitation by admin (Phase 7)
- Role assignment UI (Phase 7; for now, change roles directly in Supabase dashboard for testing)
- Any business data / orders / fabrics tables (later phases)

## Data model changes

Single migration adding RLS policies + role helper functions.

```sql
-- supabase/migrations/YYYYMMDDHHMM_auth_helpers_and_profiles_rls.sql

-- Role helper: read role from profiles for the current auth user.
create or replace function public.current_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.is_ops() returns boolean
language sql stable as $$
  select coalesce(public.current_role() = 'ops', false);
$$;

create or replace function public.is_consultant() returns boolean
language sql stable as $$
  select coalesce(public.current_role() = 'consultant', false);
$$;

-- RLS policies for profiles.
-- Read: any authenticated user can read any profile (needed for consultant filter dropdowns later).
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated
  using (true);

-- Insert: only the system trigger handles this (security definer). Block direct insert from clients.
-- (No insert policy means inserts via the anon/authenticated role are denied. The handle_new_auth_user
-- trigger runs as definer so it bypasses RLS.)

-- Update: users can update their own row, but cannot change the role column unless admin.
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Trigger to block role mutation by non-admins.
create or replace function public.guard_profile_role_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role) and not public.is_admin() then
    raise exception 'only admins can change role';
  end if;
  return new;
end
$$;

create trigger profiles_guard_role_update
  before update on public.profiles
  for each row execute function public.guard_profile_role_update();

-- Admin-only delete (rarely used).
create policy "profiles_delete_admin"
  on public.profiles for delete to authenticated
  using (public.is_admin());
```

Run `supabase db push` then regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `signOut()` | `src/lib/actions/auth.ts` | none | session required | `void` (redirects to `/login`) | none (redirect) |

The login form submits to a Server Action too, but it's defined inline in the login page.

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/` | `src/app/page.tsx` (replace placeholder) | RSC — redirect based on session |
| `/(auth)/layout.tsx` | `src/app/(auth)/layout.tsx` | RSC — minimal centred layout |
| `/login` | `src/app/(auth)/login/page.tsx` | RSC with form Server Action |
| `/auth/callback` | `src/app/auth/callback/route.ts` | Route handler — OTP exchange |
| `/(app)/layout.tsx` | `src/app/(app)/layout.tsx` | RSC — auth guard + top nav |
| `/orders` | `src/app/(app)/orders/page.tsx` | RSC stub — "Orders (coming in Phase 6)" |
| `/orders/new` | `src/app/(app)/orders/new/page.tsx` | RSC stub — "New Consultation (coming in Phase 4)" |
| `/fabrics` | `src/app/(app)/fabrics/page.tsx` | RSC stub — "Fabrics (coming in Phase 3)" |

Notes:
- Phase 1's placeholder `src/app/page.tsx` is replaced.
- The previous root layout (`src/app/layout.tsx`) stays; just contains `<html><body>` + global font.

## Components added

| Component | File | Type |
|---|---|---|
| `TopNav` | `src/components/nav/top-nav.tsx` | RSC — receives `profile` prop, renders desktop nav + delegates mobile to `MobileMenu` |
| `MobileMenu` | `src/components/nav/mobile-menu.tsx` | Client — shadcn `Sheet` triggered by hamburger button |
| `UserMenu` | `src/components/nav/user-menu.tsx` | Client — shadcn `DropdownMenu` with name, role badge, sign-out button |
| `RoleBadge` | `src/components/nav/role-badge.tsx` | RSC — small coloured pill showing role (admin = red-100, ops = blue-100, consultant = teal-100) |

## UI references

- `docs/prototype/index.html` — copy the entire `<nav>` block. Translate Alpine.js `x-data="{ navOpen: false }"` and `@click="navOpen = !navOpen"` to React `useState`. The hamburger button + slide-down menu pattern must work on mobile (< `md` breakpoint).
- The user avatar in the prototype is a simple coloured circle with initials. Replace with shadcn `Avatar` (with `AvatarFallback`) or keep the manual circle — either is fine.
- Active link highlight: the prototype uses `bg-slate-100 text-slate-900 font-medium` for the active link. Use Next.js `usePathname()` in a small Client wrapper or compute active state in the RSC and pass down.

## Implementation tasks

Execute in order.

1. **Add shadcn primitives**:
   ```bash
   npx shadcn@latest add card dropdown-menu sheet avatar
   ```

2. **Write the migration** for role helpers + profiles RLS (SQL above). Apply with `supabase db push`. Regenerate types: `supabase gen types typescript --linked > src/lib/supabase/types.ts`.

3. **Create `src/lib/auth/get-session.ts`**:
   ```ts
   import 'server-only';
   import { cache } from 'react';
   import { createClient } from '@/lib/supabase/server';

   export type SessionData = {
     user: { id: string; email: string };
     profile: { id: string; email: string; full_name: string | null; role: 'consultant' | 'ops' | 'admin'; is_active: boolean };
   };

   export const getSession = cache(async (): Promise<SessionData | null> => {
     const supabase = await createClient();
     const { data: { user } } = await supabase.auth.getUser();
     if (!user) return null;
     const { data: profile } = await supabase
       .from('profiles')
       .select('id, email, full_name, role, is_active')
       .eq('id', user.id)
       .single();
     if (!profile || !profile.is_active) return null;
     return { user: { id: user.id, email: user.email! }, profile };
   });
   ```

4. **Create `src/lib/auth/require-role.ts`**:
   ```ts
   import 'server-only';
   import { redirect } from 'next/navigation';
   import { getSession, type SessionData } from './get-session';

   type Role = SessionData['profile']['role'];

   export async function requireSession(): Promise<SessionData> {
     const session = await getSession();
     if (!session) redirect('/login');
     return session;
   }

   export async function requireRole(allowed: Role[]): Promise<SessionData> {
     const session = await requireSession();
     if (!allowed.includes(session.profile.role)) {
       // Don't reveal whether the page exists; throw not-found.
       const { notFound } = await import('next/navigation');
       notFound();
     }
     return session;
   }
   ```

5. **Replace `src/app/page.tsx`** with a redirect:
   ```tsx
   import { redirect } from 'next/navigation';
   import { getSession } from '@/lib/auth/get-session';

   export default async function RootPage() {
     const session = await getSession();
     redirect(session ? '/orders' : '/login');
   }
   ```

6. **Create `src/app/(auth)/layout.tsx`** — minimal centred card layout:
   ```tsx
   export default function AuthLayout({ children }: { children: React.ReactNode }) {
     return (
       <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
         <div className="w-full max-w-sm">{children}</div>
       </main>
     );
   }
   ```

7. **Create `src/app/(auth)/login/page.tsx`** with magic-link form + Server Action:
   ```tsx
   import { createClient } from '@/lib/supabase/server';
   import { Button } from '@/components/ui/button';
   import { Input } from '@/components/ui/input';
   import { Label } from '@/components/ui/label';

   async function sendMagicLink(formData: FormData) {
     'use server';
     const email = String(formData.get('email') || '').trim();
     if (!email) return;
     const supabase = await createClient();
     const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
     await supabase.auth.signInWithOtp({
       email,
       options: { emailRedirectTo: `${siteUrl}/auth/callback` },
     });
     // Redirect to a "check your email" view (can be ?sent=1 search param)
     const { redirect } = await import('next/navigation');
     redirect('/login?sent=1');
   }

   export default function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
     return (
       <form action={sendMagicLink} className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
         <div className="flex items-center gap-2 mb-6">
           <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">D</div>
           <span className="font-semibold text-slate-900">Drapeworks CRM</span>
         </div>
         <h1 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h1>
         <p className="text-sm text-slate-500 mb-4">We&apos;ll email you a magic link.</p>
         <SearchParamsAwareNotice />
         <Label htmlFor="email" className="text-xs">Email</Label>
         <Input id="email" name="email" type="email" required className="mt-1 mb-4" />
         <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700">Send magic link</Button>
       </form>
     );
   }

   // Helper to read sent param without async at page top:
   async function SearchParamsAwareNotice() {
     // ...alternatively pass searchParams in and conditionally render
   }
   ```
   Simplify: use `searchParams` in the page signature to show a "Check your inbox" notice when `?sent=1` is present.

8. **Create `src/app/auth/callback/route.ts`** to exchange the OTP token:
   ```ts
   import { NextResponse, type NextRequest } from 'next/server';
   import { createClient } from '@/lib/supabase/server';

   export async function GET(request: NextRequest) {
     const { searchParams, origin } = new URL(request.url);
     const code = searchParams.get('code');
     const next = searchParams.get('next') ?? '/orders';
     if (code) {
       const supabase = await createClient();
       const { error } = await supabase.auth.exchangeCodeForSession(code);
       if (!error) return NextResponse.redirect(`${origin}${next}`);
     }
     return NextResponse.redirect(`${origin}/login?error=callback`);
   }
   ```
   Place this OUTSIDE the `(auth)` route group so it's just `/auth/callback`, not `/(auth)/auth/callback`.

9. **Create `src/app/(app)/layout.tsx`** as the protected app shell:
   ```tsx
   import { requireSession } from '@/lib/auth/require-role';
   import { TopNav } from '@/components/nav/top-nav';

   export default async function AppLayout({ children }: { children: React.ReactNode }) {
     const session = await requireSession();
     return (
       <div className="min-h-screen bg-slate-50 text-slate-800">
         <TopNav profile={session.profile} />
         {children}
       </div>
     );
   }
   ```

10. **Create `src/components/nav/top-nav.tsx`** mirroring the prototype's `<nav>`:
    - Logo block on the left (teal D + "Drapeworks CRM")
    - Desktop links (hidden under `md`): Orders / New Consultation / Fabrics
    - Right side: user name (hidden on `sm`), avatar/initials, hamburger button (visible under `md`)
    - Active link logic: read `headers()` to get current path, or accept `pathname` from a child Client wrapper. Simplest: use a small Client `<NavLink>` component that reads `usePathname()` and applies active classes.
    - Embed `<MobileMenu />` (Client) for the slide-down menu
    - Embed `<UserMenu />` (Client) for the dropdown with sign-out

11. **Create `src/components/nav/mobile-menu.tsx`**:
    - Use shadcn `Sheet` with `SheetTrigger` (hamburger icon from `lucide-react`)
    - Inside: vertical list of nav links + sign-out
    - Active link styling via `usePathname()`

12. **Create `src/components/nav/user-menu.tsx`**:
    - Use shadcn `DropdownMenu`
    - Trigger: avatar (initials in teal circle)
    - Items: full name (read-only), email, role badge, separator, "Sign out" (form with Server Action)

13. **Create the sign-out Server Action** `src/lib/actions/auth.ts`:
    ```ts
    'use server';
    import { createClient } from '@/lib/supabase/server';
    import { redirect } from 'next/navigation';

    export async function signOut() {
      const supabase = await createClient();
      await supabase.auth.signOut();
      redirect('/login');
    }
    ```

14. **Stub pages**:
    - `src/app/(app)/orders/page.tsx` — `<div className="max-w-7xl mx-auto px-4 sm:px-6 py-6"><h1>Orders</h1><p className="text-sm text-slate-500">Coming in Phase 6.</p></div>`
    - `src/app/(app)/orders/new/page.tsx` — similar stub mentioning Phase 4
    - `src/app/(app)/fabrics/page.tsx` — similar stub mentioning Phase 3

15. **Smoke test locally**:
    - `npm run dev`
    - Open `/` → redirected to `/login`
    - Submit form with your email → redirected to `/login?sent=1` with notice
    - Click magic link from inbox → lands on `/orders` (stub) with nav rendered
    - Click avatar → user menu → Sign out → back to `/login`
    - On mobile width: hamburger opens slide-down menu

16. **Verify RLS in Supabase SQL editor** by running:
    ```sql
    -- as the magic-link user, this should return your profile row
    select * from public.profiles;
    -- attempting to change own role should fail
    update public.profiles set role = 'admin' where id = auth.uid();  -- expect error
    ```

17. **Manually promote yourself to admin in Supabase dashboard** for testing later phases:
    - Table Editor → `profiles` → find your row → change `role` to `admin`
    - (In production this would happen via the user-invite flow in Phase 7.)

18. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(auth): magic-link login + protected app shell + role helpers"
    git push
    ```
    Verify on the Railway URL that login works end-to-end. Check that the magic link in your email uses the Railway domain (not localhost) — if not, double-check `NEXT_PUBLIC_SITE_URL` in Railway build args.

## Verification

- [ ] Unauthenticated GET `/orders` redirects to `/login`
- [ ] GET `/` redirects to `/login` (no session) or `/orders` (signed in)
- [ ] Magic-link email arrives within 30 seconds of submitting the form
- [ ] Clicking the link returns the user to `/orders` and a session cookie is set
- [ ] Top nav renders the user's name and role badge
- [ ] Hamburger menu opens on mobile widths and contains the same nav links
- [ ] User menu sign-out clears the session and returns to `/login`
- [ ] Direct SQL test confirms `current_role()`, `is_admin()`, `is_ops()` return correct values when called as authenticated user
- [ ] A non-admin attempting `update profiles set role = 'admin'` fails with the guard trigger
- [ ] All three stub routes render under the app shell

## Hand-off to next phase

After Phase 2, the next phase can assume:

- `getSession()` and `requireRole([...])` helpers exist and work
- `public.current_role()`, `public.is_admin()`, `public.is_ops()` SQL functions exist
- `profiles` table has working RLS (any authenticated can read; only admin can mutate role; users can update own non-role fields)
- The `(app)` route group is auth-protected
- The top nav is rendered for every signed-in page (sub-routes don't need to render their own nav)
- The `(auth)` route group has a working `/login` and `/auth/callback`
- `signOut` Server Action exists at `src/lib/actions/auth.ts`
- shadcn primitives `button, input, label, card, dropdown-menu, sheet, avatar` are installed
- The user can manually be promoted to `admin` in Supabase dashboard for testing
