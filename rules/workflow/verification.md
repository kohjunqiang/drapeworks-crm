# Verification

## Per-phase verification

Every phase spec ends with a **Verification** checklist. Tick every item before declaring the phase done. If something fails, fix it before moving on.

## Standard verification tools

### TypeScript

```bash
npx tsc --noEmit
```

Or just `npm run build` (which includes type-check). Should pass cleanly with zero errors.

### Linting

```bash
npm run lint
```

Fix every warning. Don't add `// eslint-disable` to silence — fix the underlying issue.

### Local dev smoke test

```bash
npm run dev
```

Walk through the happy path for whatever the phase delivers. Use real data (or seed data) — not test fixtures.

### Mobile responsive

Open Chrome DevTools → device mode → iPhone SE (375×667). Walk through every page. Check:
- No horizontal scroll on the page
- Tap targets ≥ 44px tall
- Text is readable (not too small)
- Forms are usable (inputs zoom correctly, dropdowns work)

## RLS verification

Always verify with both happy path and negative cases.

In the Supabase SQL editor:

```sql
-- Simulate being a consultant
select set_config('request.jwt.claims', '{"sub":"<consultant-uuid>","role":"authenticated"}', true);

-- Happy: can read all orders
select count(*) from public.orders;

-- Negative: cannot update another consultant's order
update public.orders set general_notes = 'hack' where id = '<other-consultant-order-id>';
-- expect: RLS denial OR 0 rows affected
```

For Storage: try to upload to a path you don't own via browser DevTools (paste a snippet into the console while logged in as user B, target user A's path). Should fail with 4xx.

## Integration smoke test (after each phase)

Walk a real user journey end-to-end on the deployed Railway URL — not localhost. Catches env-var mismatches, missing build args, RLS surprises that only show up under the deployed JWT.

After all phases: full happy path:
1. Admin invites a new consultant
2. Consultant logs in (magic link from email)
3. Consultant creates an order with rooms, windows, photos
4. Ops advances status through all 6 stages
5. Admin reverts once
6. Admin views the order detail on mobile — everything renders

If any step breaks, that's the verification gap.

## Pre-merge checklist

Before merging a phase to `main`:

- [ ] All "Verification" items in the phase spec pass
- [ ] `npm run build` passes locally
- [ ] `npm run lint` passes
- [ ] Mobile QA at 375px done
- [ ] RLS positive + negative tests done
- [ ] Migration applied to remote AND types regenerated AND both committed
- [ ] No `console.log` / `console.error` left in production code paths
- [ ] No `TODO` / `FIXME` left without an issue link
- [ ] No `any` introduced without a comment
- [ ] No new dependencies added without telling the user

## Post-deploy checklist

After Railway deploy:

- [ ] `curl https://<railway-domain>/api/health` returns 200
- [ ] Visit the home page in incognito → redirects to `/login` (if not signed in)
- [ ] Smoke-test the new functionality on production
- [ ] Watch Railway logs for the first 60s after deploy for unexpected errors

## What "done" means

- The feature works as the spec describes
- The verification checklist passes
- The deployment is live and verified
- The codebase is in a state another developer (or fresh Claude session) can pick up cleanly

If any of those isn't true, the phase is not done.

## Forbidden

- Declaring a phase done without running the verification checklist
- Skipping mobile QA because "the desktop looks fine"
- Skipping the post-deploy smoke test because "it worked locally"
- Suppressing TypeScript or ESLint errors instead of fixing them
