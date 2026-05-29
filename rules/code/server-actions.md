# Server Actions

## Where they live

`src/lib/actions/<feature>.ts` with `'use server'` at the top of the file (not per-function). One file per feature area: `auth.ts`, `fabrics.ts`, `orders.ts`, `status.ts`, `photos.ts`, `users.ts`.

## Canonical shape

Every action follows this skeleton:

```ts
'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireRole, requireSession } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { mySchema } from '@/lib/validation/<feature>';

export async function myAction(input: unknown) {
  // 1. Role/auth guard (FIRST)
  await requireRole(['admin']);          // or requireSession() for any signed-in user

  // 2. Validate input with Zod
  const parsed = mySchema.parse(input);  // throws on invalid

  // 3. RLS-respecting Supabase client
  const supabase = await createClient();

  // 4. Mutate
  const { error } = await supabase.from('table').insert({ ... });
  if (error) throw new Error(error.message);

  // 5. Revalidate affected routes
  revalidatePath('/list-route');
  // OR redirect if appropriate
  // redirect('/somewhere');
}
```

Every one of these steps is required. Don't skip role checks on "read-only" actions either — even reads need a session.

## Rules

- **Throw on error.** Don't return `{ ok: false }` envelopes. The form uses `useFormState` or `useTransition` + try/catch to display errors.
- **`revalidatePath` over returning data.** Mutations should not return refreshed data; let RSC re-fetch.
- **Don't expose internal error messages.** When wrapping Supabase errors, throw a friendly message. (Phase 7 polish can refine.)
- **No silent failures.** If something goes wrong, throw.
- **Atomicity matters.** When a mutation touches multiple tables, write a Postgres function (RPC) and call it via `supabase.rpc(...)`. See `create_order` and `update_order` for the pattern.
- **Don't import client libraries** (RHF, browser APIs) into action files.
- **Don't `console.log` secrets.** Don't log user-provided content unless redacted.

## Role guards

```ts
await requireSession();                     // any signed-in user
await requireRole(['admin']);               // admin only
await requireRole(['consultant', 'admin']); // either
await requireRole(['ops', 'admin']);        // either
```

For ownership checks (e.g. "consultant can edit own orders only"), `requireRole` is not enough — fetch the row and compare `auth.uid()`:

```ts
const session = await requireRole(['consultant', 'admin']);
const { data: order } = await supabase.from('orders').select('consultant_id').eq('id', orderId).single();
if (!order) throw new Error('not found');
const isOwner = order.consultant_id === session.user.id;
const isAdmin = session.profile.role === 'admin';
if (!isOwner && !isAdmin) throw new Error('forbidden');
```

RLS will still reject the underlying query if you somehow bypass this, but explicit checks give clearer errors and avoid wasted round trips.

## The service-role client is reserved

`src/lib/supabase/admin.ts` exists for **exactly one use case**: `inviteUser` in Phase 7. Don't import it anywhere else. It bypasses RLS, which is the opposite of how this app is supposed to work.

If you find yourself reaching for the admin client to "make it work," step back and fix the RLS policy or the calling code instead.

## Revalidation patterns

```ts
revalidatePath('/orders');                 // list route
revalidatePath(`/orders/${orderId}`);      // detail route
revalidatePath(`/orders/${orderId}/edit`); // edit route
```

Revalidate every route that displays the mutated data. If you forget one, the user sees stale data until next navigation.

## Calling from client components

```tsx
'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { myAction } from '@/lib/actions/feature';

export function MyButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await myAction({ id });
            toast.success('Done');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Something went wrong');
          }
        })
      }
    >
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}
```

Or for forms, use shadcn `Form` + `useFormState` against the action.
