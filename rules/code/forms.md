# Forms

## Stack

- **React Hook Form** for state and validation lifecycle
- **Zod** for the schema (single source of truth — same schema runs in the browser AND in the Server Action)
- **shadcn `Form`** (which wraps RHF + `react-hook-form/resolvers/zod`) for the bridge

## Where schemas live

`src/lib/validation/<feature>.ts`. The schema is exported and imported by both the form and the Server Action.

```ts
// src/lib/validation/fabric.ts
import { z } from 'zod';

export const fabricSchema = z.object({
  code: z.string().regex(/^DW-[A-Z]-\d{3,}$/, 'Code must look like DW-D-123'),
  name: z.string().min(1, 'Required'),
  type: z.enum(['Day', 'Night', 'Both']),
  supplier: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be hex like #aabbcc'),
  notes: z.string().optional(),
  isNew: z.boolean().optional(),
});

export type FabricInput = z.infer<typeof fabricSchema>;
```

The Server Action calls `fabricSchema.parse(input)` to re-validate; never trust client validation alone.

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
import { fabricSchema, type FabricInput } from '@/lib/validation/fabric';
import { upsertFabric } from '@/lib/actions/fabrics';

export function FabricForm({ defaultValues }: { defaultValues?: Partial<FabricInput> }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<FabricInput>({
    resolver: zodResolver(fabricSchema),
    defaultValues: { type: 'Day', color: '#cccccc', ...defaultValues },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      try {
        await upsertFabric(values);
        toast.success(defaultValues ? 'Fabric updated' : 'Fabric added');
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

When a form has variants (e.g. toilet windows vs regular windows), use Zod `discriminatedUnion`:

```ts
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
```

The `variant` field is purely a client-side discriminator — strip it before sending to the Server Action.

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

In edit mode, disable immutable fields (like `fabric.code`) via the `disabled` prop on the Input.

## Error display

- Field-level errors via shadcn `<FormMessage />` — automatic from RHF
- Action-level errors via `toast.error(...)` from Sonner
- Don't render raw exception stack traces

## Forbidden

- Form state outside RHF (no manual `useState` for inputs)
- Different schemas for client and server validation — always import the same one
- Hard-coded validation rules in the JSX (`pattern="..."`, `minLength="..."` on `<input>`) — express in Zod
- `onChange` handlers that bypass `form.setValue` / `register`
- Submitting without `handleSubmit(...)` wrapper
