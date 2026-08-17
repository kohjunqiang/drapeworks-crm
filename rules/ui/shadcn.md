# shadcn/ui Components

## Adding primitives

```bash
npx shadcn@latest add <component>
```

Already installed by the relevant phase:

| Phase | Primitives |
|---|---|
| 1 | `button`, `input`, `label` |
| 2 | `card`, `dropdown-menu`, `sheet`, `avatar` |
| 3 | `dialog`, `form`, `select`, `badge`, `table`, `sonner` |
| 4 | `textarea`, `calendar`, `popover` |
| 7 | `skeleton` |

If you need one that's not on the list, add it via the CLI (it'll create a file under `src/components/ui/`).

## Don't hand-edit `src/components/ui/`

These files are managed by the shadcn CLI. If you need a customised variant, wrap the primitive in your own component:

```tsx
// src/components/orders/teal-button.tsx
import { Button, type ButtonProps } from '@/components/ui/button';

export function TealButton(props: ButtonProps) {
  return <Button {...props} className={`bg-teal-600 hover:bg-teal-700 text-white ${props.className ?? ''}`} />;
}
```

## Toasts

Sonner is installed in Phase 3. Mount the `<Toaster />` once in `src/app/layout.tsx` (root):

```tsx
import { Toaster } from '@/components/ui/sonner';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

Use anywhere:
```tsx
import { toast } from 'sonner';

toast.success('Order DW-2026-0001 created');
toast.error('Save failed: connection timeout');
```

## Forms

Use shadcn `Form` (which integrates RHF). See `rules/code/forms.md` for the canonical form pattern.

## Dialogs

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Add curtain type</DialogTitle>
    </DialogHeader>
    {/* form */}
  </DialogContent>
</Dialog>
```

For mobile-friendly bottom-sheet behaviour, see `rules/ui/responsive.md`.

## Sheets (mobile menu)

```tsx
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';

<Sheet>
  <SheetTrigger asChild>
    <button aria-label="Menu"><Menu className="w-5 h-5" /></button>
  </SheetTrigger>
  <SheetContent side="top">
    {/* nav links */}
  </SheetContent>
</Sheet>
```

## Icons

Use `lucide-react` (shadcn's default):

```tsx
import { Menu, X, Plus, Trash2 } from 'lucide-react';
<Menu className="w-5 h-5" />
```

Standard sizes:
- Inline with text: `w-4 h-4`
- Button icons: `w-5 h-5`
- Section/header icons: `w-6 h-6`

## Accessibility

- Every icon-only button needs `aria-label="..."`
- Every form `<input>` needs a `<Label htmlFor="...">` (shadcn `FormField` does this automatically when bound to RHF)
- Focus rings come from shadcn defaults — **don't remove them**
- Don't use `:hover` styles without an equivalent `focus-visible:` style
- Test keyboard navigation: every interactive element must be reachable via Tab and activatable via Enter/Space
- Colour contrast: minimum 4.5:1 for body text. Default `text-slate-800` on `bg-slate-50` passes. `text-slate-400` only for non-essential text (timestamps, hints).

## Skeletons (Phase 7)

For Suspense fallbacks:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

<Skeleton className="h-8 w-48 mb-2" />
<Skeleton className="h-4 w-full" />
```

Place in `loading.tsx` files at the route level.

## Forbidden

- Hand-editing `src/components/ui/*`
- Importing shadcn primitives without using their props (e.g. styling around them with `<div className="...">` wrappers instead of passing `className` to the primitive)
- Removing default focus rings
- Using a library other than `lucide-react` for icons (unless the design needs a specific icon set — flag to user first)
