# Responsive Patterns

## Mobile-first

Default classes target mobile. Use `sm:` / `md:` / `lg:` prefixes to upgrade.

Standard breakpoints we use:

| Prefix | Width | Used for |
|---|---|---|
| (default) | `< 640px` | mobile portrait |
| `sm:` | `≥ 640px` | small tablets / mobile landscape |
| `md:` | `≥ 768px` | desktop and large tablets |
| `lg:` | `≥ 1024px` | wide desktop (e.g. 3-col order detail layout) |

## Container padding (consistent across pages)

```
px-4 sm:px-6 py-6 sm:py-8
```

Use this on every page's `<main>` or top-level wrapper.

## Section card (standard)

```
bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4
```

## Field grids that collapse

```
grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4
grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4
grid grid-cols-2 sm:grid-cols-6 gap-3   /* window fields with col-span overrides */
```

## Table-vs-cards pattern (lists)

For dashboards and any tabular list, show a table on desktop and cards on mobile. Used in the orders list, the product catalogue tables, and the admin users list.

```tsx
{/* Desktop */}
<div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
  <table className="w-full text-sm">
    {/* full table */}
  </table>
</div>

{/* Mobile */}
<div className="md:hidden space-y-3">
  {items.map(item => (
    <Card key={item.id}>{/* ... */}</Card>
  ))}
</div>
```

Both render from the same data; never duplicate fetch logic.

## Top nav with hamburger

The nav collapses links into a hamburger sheet on mobile (`< md`). See `docs/prototype/index.html` for the canonical layout. Use shadcn `Sheet` for the slide-down panel.

## Action rows

Form actions stack on mobile with primary on top (reverse-flex), inline on desktop:

```
flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3
```

## Filter bars

Search input full-width on mobile; selects in a 2-col grid; everything inline on desktop:

```tsx
<div className="bg-white rounded-lg border border-slate-200 mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
  <input className="flex-1 ..." />
  <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
    <select ... />
    <select ... />
  </div>
</div>
```

## Dialogs

shadcn dialogs default to a centred modal. For mobile-heavy forms, switch to a bottom-sheet style:

```
items-end sm:items-center justify-center
rounded-t-lg sm:rounded-lg
max-h-[90vh] overflow-y-auto
```

## Order detail 3-col layout

The order detail page uses a 3-col grid on desktop with the sidebar above the content on mobile (better information hierarchy):

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
  <div className="lg:col-span-2 space-y-4 order-2 lg:order-1">
    {/* main content */}
  </div>
  <div className="space-y-4 order-1 lg:order-2">
    {/* sidebar — customer info, payment summary */}
  </div>
</div>
```

## Wide-table mobile scroll

When a table has too many columns to ever fit on mobile, wrap in `overflow-x-auto` and set a `min-w`:

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-xs min-w-[640px]">
    {/* ... */}
  </table>
</div>
```

Use this for spec tables on the order detail page; use the table-vs-cards pattern for list/dashboard tables.

**`overflow-x-auto` only absorbs overflow when the wrapper's width is definite.** `body` is `flex flex-col` and every `<main>` is centred with `mx-auto`. Auto margins on the cross axis suppress `align-items: stretch`, so the item is sized shrink-to-fit — floored at its *min-content* width. A `min-w-[36rem]` table then drags `<main>` out to 700px+ on a phone and the whole document scrolls sideways, while the scroll wrapper never scrolls at all. `globals.css` pins `body > main/nav/header` to `width: 100%` to keep those widths definite. If you add a new direct child of `body`, give it a definite width too. `min-width: 0` does **not** help here — that governs the main axis, which is vertical in a column flex container.

## Anything sticky or absolutely sized on a phone

A quote/summary bar with several figures on one row fits a desk, not a 375px phone — four-figure amounts are the normal case. Stack the label above the figures below `sm:` and let the figures wrap:

```
flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4
```

## Dialogs must cap their height in `dvh`

`DialogContent` carries `max-h-[calc(100dvh-2rem)] overflow-y-auto`. Without it a dialog taller than the viewport is clipped at *both* ends with nothing to scroll — and the viewport halves the moment a text field opens the on-screen keyboard, which is exactly when a form dialog is in use. Use `dvh`, never `vh`: `vh` ignores the keyboard.

## Testing

Test every screen at **iPhone SE width (375px)** before declaring done. No horizontal scroll on the page (table scroll inside a container is fine). Tap targets ≥ 44px tall on touch interfaces.

## Forbidden

- Skipping mobile testing
- Custom CSS media queries (use Tailwind breakpoints)
- Hard-coded pixel widths in components
- Hiding content on mobile rather than reflowing it
