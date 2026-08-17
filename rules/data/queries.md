# Database Queries

## Client choice

- **In RSC / Server Components / Server Actions**: `import { createClient } from '@/lib/supabase/server'` (cookie-based, RLS-respecting)
- **In Client Components**: avoid direct DB access. Pass data from RSC props, or call a Server Action.
- **For browser-side realtime subscriptions** (not used in v1): `import { createClient } from '@/lib/supabase/browser'`
- **Service role**: only `src/lib/supabase/admin.ts`, only for `inviteUser`

## Select with joins

Use `select` with nested table syntax for related rows:

```ts
const { data: order } = await supabase
  .from('orders')
  .select(`
    id, display_id, current_status, price_quoted_cents, deposit_cents,
    customer:customers(id, name, mobile, email),
    consultant:profiles!consultant_id(id, full_name, role),
    rooms(
      id, type, label, position,
      windows(*),
      room_photos(id, storage_path, original_name)
    ),
    events:order_status_events(id, status, note, created_at, author:profiles!created_by(full_name))
  `)
  .eq('id', orderId)
  .order('position', { referencedTable: 'rooms' })
  .order('position', { referencedTable: 'rooms.windows' })
  .single();
```

- Use the renamed-relation syntax (`alias:relation(...)`) when joining a relation twice via different FKs (e.g. `consultant` and `author` both from `profiles`)
- For `!fk_name` disambiguation when there are multiple FKs from one table

## Filtering / search

For text search (v1 uses `ilike` backed by `pg_trgm` indexes added in Phase 6):

```ts
.or(`name.ilike.%${q}%,mobile.ilike.%${q}%`, { foreignTable: 'customer' })
```

For status / consultant filters, use straight `.eq()`:

```ts
let query = supabase.from('orders').select('*');
if (status) query = query.eq('current_status', status);
if (consultantId) query = query.eq('consultant_id', consultantId);
```

## Pagination

For v1: `.limit(50).order('created_at', { ascending: false })`. Add cursor-based pagination later when needed.

## Helpers in `src/lib/db/`

Common queries get their own helper functions so RSC pages stay clean:

```ts
// src/lib/db/orders.ts
export async function fetchOrderDetail(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('orders').select('...').eq('id', orderId).single();
  if (error) throw new Error(error.message);
  return data;
}
```

Wrap in React `cache()` if a single render might call the same query multiple times.

## RPCs

For multi-table atomic operations, write a Postgres function and call via `supabase.rpc(...)`:

```ts
const { data, error } = await supabase.rpc('create_order', { payload });
```

The function is the unit of atomicity (everything inside is a single Postgres transaction). See `create_order` and `update_order` for the canonical pattern.

## Error handling

```ts
const { data, error } = await supabase.from('table').select('*');
if (error) throw new Error(error.message);
if (!data) throw new Error('no data');  // when expected
return data;
```

Don't silently swallow errors. Don't return `null` from query helpers when a missing row should be a 404 — throw and let the route handle it via `notFound()`.

## Type safety

Use the generated types throughout. They come from kysely-codegen
(`npm run db:codegen` → `src/lib/db/schema.ts`), one interface per table plus a
string-literal union per Postgres enum:

```ts
import type { Orders, CurtainProductLine } from '@/lib/db/schema';
```

Kysely infers the result type of a select from the columns you list, so a query needs no
hand-written row type. Name the shape only where it crosses a boundary — a component
prop, or a loader's return type:

```ts
export type CurtainTypeOptionRow = {
  id: string;
  label: string;
  category: CurtainCategory | null;
  productLine: CurtainProductLine;
};
```

Prefer the generated enum union (`CurtainProductLine`) over re-declaring
`"curtain" | "blind"` by hand — then adding a value to the enum surfaces every place
that needs updating as a type error.

## Forbidden

- Direct DB access from Client Components
- `select('*')` in production code paths that don't need all columns (small perf cost, but also exposes columns added later by accident)
- Silently swallowing errors
- Building SQL strings by concatenation (use the query builder; for complex queries write an RPC)
- N+1 queries — prefer one join over many `await`s
- Returning data from mutation Server Actions when `revalidatePath` would do
