# Forms

## Stack

- **React Hook Form** for state and validation lifecycle
- **Zod** for the schema (single source of truth — same schema runs in the browser AND in the Server Action)
- **shadcn `Form`** (which wraps RHF + `react-hook-form/resolvers/zod`) for the bridge

## Where schemas live

`src/lib/validation/<feature>.ts`. The schema is exported and imported by both the form and the Server Action.

```ts
// src/lib/validation/curtain-type.ts
import { z } from 'zod';

export const curtainTypeSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),         // present on edit
  label: z.string().min(1, 'Required').max(120),
  category: z.enum(['Day', 'Night']).optional(),  // curtain sheerness; null for a blind
  series_id: z.string().uuid('Select a series'),
  photo_path: z.string().optional(),
});

export type CurtainTypeInput = z.infer<typeof curtainTypeSchema>;
```

The Server Action calls `curtainTypeSchema.parse(input)` to re-validate; never trust
client validation alone.

**Some rules can't live in the schema.** `category` is required for a curtain and
forbidden for a blind, but which one applies depends on the chosen *series*' product
line — a fact only the server holds. Zod validates shape; the action validates
everything that needs a database lookup.

## Canonical form Client component

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTransition } from 'react';
import { curtainTypeSchema, type CurtainTypeInput } from '@/lib/validation/curtain-type';
import { upsertCurtainType } from '@/lib/actions/curtain-types';

export function CurtainTypeForm({ defaultValues }: { defaultValues?: Partial<CurtainTypeInput> }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<CurtainTypeInput>({
    resolver: zodResolver(curtainTypeSchema),
    defaultValues: { isNew: true, label: '', series_id: '', ...defaultValues },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      try {
        await upsertCurtainType(values);
        toast.success(defaultValues ? 'Saved' : 'Added');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Save failed');
      }
    })
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-3">
        <FormField name="code" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Code</FormLabel>
            <FormControl><Input {...field} disabled={!!defaultValues} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        {/* ...other fields */}
        <Button type="submit" disabled={pending} className="bg-teal-600 hover:bg-teal-700">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Form>
  );
}
```

## Discriminated unions

When a form has variants, use Zod `discriminatedUnion`. Windows have three:

```ts
const regularWindow = baseWindow.extend({
  variant: z.literal('regular'),
  day_curtain_type_id: optionalTypeId,
  night_curtain_type_id: optionalTypeId,
  draw: z.enum(['Double', 'Single Left', 'Single Right']).optional(),
  add_s_fold: z.boolean().optional(),
  combo_id: optionalTypeId,
});

const toiletWindow = baseWindow.extend({
  variant: z.literal('toilet'),
  curtain_type_id: optionalTypeId,          // one covering, not a day/night pair
});

const blindWindow = baseWindow.extend({
  variant: z.literal('blind'),
  blind_type_id: optionalTypeId,
  draw: z.enum(['Single Left', 'Single Right']).optional(),  // control side; no "Double"
});

const windowSchema = z.discriminatedUnion('variant', [
  regularWindow, toiletWindow, blindWindow,
]);
```

**The variant is real data, not a client-side hint.** It is sent to the Server Action,
persisted through `windowValues`, and checked against the room type. Don't strip it.

**Let the union do the enforcing.** "A window is curtains or blinds, never both" holds
because `blindWindow` has no day/night field to set — not because some guard remembers
to check. A rule expressed as a shape can't be forgotten; a rule expressed as an `if`
can.

**One variant can serve several contexts.** `blind` covers toilet and non-toilet rooms
alike, because a blind is already one covering — the same reason `toilet` exists. Adding
a `toilet_blind` variant would have doubled the union to encode nothing.

### Deriving a variant is a trap

Three separate places derived a window's variant from its room type, and all three
silently destroyed blind windows until Phase 12 fixed them: `saveDraft` overwrote it on
every autosave, `room-card`'s effect rewrote it on room-type change, and the edit page
recomputed it on load. If a variant can be chosen by the user, **preserve it** — derive
only the ones the user cannot set.

### Keep the schema and the database agreeing

A discriminated union is the ergonomic face of an invariant the database also enforces
(`validate_window_shape`). The mapping layer is what keeps them consistent:
`windowValues` explicitly nulls *every* other variant's columns, so switching a window
can never leave a stale id behind that the trigger then rejects.

## Nested field arrays

```tsx
const { fields: rooms, append, remove } = useFieldArray({ control, name: 'rooms' });

// Inside a room card, get a second useFieldArray for windows:
const RoomCard = ({ roomIndex }: { roomIndex: number }) => {
  const { fields: windows, append: addWindow, remove: rmWindow } =
    useFieldArray({ control, name: `rooms.${roomIndex}.windows` });
  // ...
};
```

Keep `position` in sync with array index when sorting/inserting.

## Default values for "edit" mode

The same form often serves create and edit. Pattern:

```tsx
<MyForm mode="create" />
<MyForm mode="edit" defaultValues={existingData} />
```

In edit mode, disable immutable fields via the `disabled` prop on the Input. Some fields
are immutable because changing them would rewrite history: `curtain_series.product_line`
is set from the tab a series is created on and never editable, because moving a series
between product lines would retroactively change how every window referencing it is
priced and installed.

## Error display

- Field-level errors via shadcn `<FormMessage />` — automatic from RHF
- Action-level errors via `toast.error(...)` from Sonner
- Don't render raw exception stack traces

## Catalogue text is verbatim

Vendor codes are the customer's language, not ours. Store exactly what was supplied —
never strip a prefix, normalise case, pad a number, or fix an apparent typo. Report
oddities (duplicates, inconsistent spellings) instead of silently correcting them; the
source list is usually right and, when it isn't, only the user can say so.

## Don't offer what can't be quoted

A product with no sale price must not appear in the consultation form. It would quote at
S$0 while still attracting an install cost — a silently negative margin. Filter the
picker on priced items, and give the admin surface a notice explaining why nothing shows
up, or they will add catalogue rows and have no idea why consultants can't see them.
Mesh gates on its chooser card; blinds gate on the Curtains/Blinds toggle.

## Forbidden

- Form state outside RHF (no manual `useState` for inputs)
- Different schemas for client and server validation — always import the same one
- Hard-coded validation rules in the JSX (`pattern="..."`, `minLength="..."` on `<input>`) — express in Zod
- `onChange` handlers that bypass `form.setValue` / `register`
- Submitting without `handleSubmit(...)` wrapper
- Deriving a user-chosen discriminator from something else on save or load
- "Fixing" a supplied catalogue label
