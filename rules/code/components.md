# Components

## Default to React Server Components

Every file in `src/app/**/page.tsx` and `src/app/**/layout.tsx` is a Server Component. Every component in `src/components/` is a Server Component **unless it needs**:

- `useState` / `useReducer` / `useRef`
- `useEffect` / `useLayoutEffect`
- Browser APIs (`window`, `localStorage`, `IntersectionObserver`)
- Event handlers (`onClick`, `onChange`, `onSubmit`)
- React Hook Form, Alpine-style reactivity
- Context that mutates

If you need any of those, add `'use client'` as the first line — and keep the Client subtree as small as possible.

## Pattern: thin Client islands inside RSC pages

Wrong:
```tsx
// 'use client' at the top of the whole page — everything is now client-side
```

Right:
```tsx
// page.tsx (RSC) — fetches data, renders shell
export default async function Page() {
  const data = await fetchData();
  return (
    <main>
      <Header data={data} />          {/* RSC */}
      <InteractiveTable rows={data} /> {/* Client island */}
    </main>
  );
}
```

Push data into Client components as props. Don't refetch in Client components when an RSC already has the data.

## File layout

```
src/components/
  ui/                    # shadcn primitives — managed by `shadcn add`, do not hand-edit
  nav/                   # global navigation
  orders/                # one folder per feature area
    consultation-form/   # complex Client subtrees get their own folder
      index.tsx          # the entry component
      customer-section.tsx
      room-card.tsx
      ...
    status-timeline.tsx  # simpler presentational components live at the top level
  curtain-types/         # curtain + blind catalogue (one set, split by product line)
  mesh/
  vendors/
  pricing/
  admin/                 # admin chrome (product tabs)
```

- File names: kebab-case
- Component names: PascalCase (`<RoomCard />`)
- One default export per file; named exports for adjacent helpers/types

## Props

- Type props with an inline `type Props = { ... }` or `interface` above the component
- Accept primitives and serialisable data, not Server Action handles, when the Client component will be rendered inside an RSC (Server Actions are serialisable — that's fine)
- Avoid `React.FC` — write `export default function MyComp(props: Props) { ... }`

## When to extract a component

- Used in 2+ places — extract
- Used once but >80 lines of JSX — consider extracting
- A clear UI primitive (badge, tile, empty-state) — extract to `components/ui/` if it'd live in shadcn naturally; otherwise put it in the feature folder

## Forbidden

- Importing client-only libraries (e.g. browser-image-compression) at the top of an RSC. Lazy-import inside Client components only.
- Calling Supabase server clients from Client components. Use Server Actions or RSC data passed down via props.
- Mixing `'use client'` and `'use server'` directives in the same file.
- `import 'server-only'` in components — that pragma is for `lib/` files. Components are either RSC (default) or `'use client'`.
