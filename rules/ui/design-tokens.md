# Design Tokens

## Palette

| Token | Tailwind class | When |
|---|---|---|
| Background (app) | `bg-slate-50` | `<body>` and page main |
| Surface | `bg-white` | cards, dialogs, table backgrounds |
| Text default | `text-slate-800` | body text |
| Text headings | `text-slate-900` | h1-h3 |
| Text muted | `text-slate-500` / `text-slate-400` | descriptions, timestamps |
| Border | `border-slate-200` | cards, dividers, inputs |
| Border subtle | `border-slate-100` | internal section dividers |
| **Accent (primary)** | `bg-teal-600 hover:bg-teal-700` | primary CTAs, logo, active states |
| Accent focus ring | `focus:border-teal-500` | input focus |
| Accent soft | `bg-teal-100 text-teal-700` | small badges (e.g. Active status) |
| Danger | `text-red-600`, `bg-red-600` | destructive actions |
| Success | `bg-emerald-100 text-emerald-700`, `bg-emerald-500` | active status, completed status dot |

**Never use amber, orange, or yellow.** That was the original colour and the user explicitly disliked it.

## Status colours (canonical)

Order fulfilment status → badge classes:

| Status | Badge classes |
|---|---|
| `order_made` | `bg-slate-100 text-slate-700` |
| `sent_logistic` | `bg-indigo-100 text-indigo-700` |
| `shipping_sg` | `bg-blue-100 text-blue-700` |
| `delivered_checked` | `bg-emerald-100 text-emerald-700` |
| `fulfilment` | `bg-purple-100 text-purple-700` |
| `completed` | `bg-green-100 text-green-700` |

Curtain category (sheerness — curtains only; a blind has none, so the column and its
filter are hidden on the Blinds tab rather than rendered blank):
- Day = `bg-amber-50 text-amber-700`
- Night = `bg-indigo-50 text-indigo-700`

Catalogue status:
- Active = `bg-teal-50 text-teal-700`
- Archived = `bg-slate-100 text-slate-500`

Centralise these in `src/lib/status-flow.ts` as `STATUS_COLOURS` / `STATUS_LABELS` maps; don't sprinkle class strings across components.

## Typography

- Body: default Tailwind (system stack). No custom web fonts in v1.
- Headings: `font-semibold` or `font-bold` with `text-slate-900`
- Mono (codes, IDs): `font-mono`

## Spacing rhythm

- Section gap: `mb-4` between section cards
- Section card internal padding: `p-4 sm:p-6`
- Field gap: `gap-3 sm:gap-4` in grids
- Stack gap: `space-y-2` for tight, `space-y-3` for normal, `space-y-4` for loose

## Border radius

- Default: `rounded` (4px) for inputs, small badges
- Cards / sections: `rounded-lg` (8px)
- Avatars / pills (round): `rounded-full`

## Shadow

- Cards: none (rely on border)
- Dialogs: `shadow-xl` (shadcn default)
- Dropdowns: shadcn default

## Forbidden

- Amber, orange, yellow anywhere
- Custom hex colours outside this token list
- Inline `style={{ color: '#...' }}` — use Tailwind classes
- Adding a new colour without documenting it here first
