# Fonts

`NotoSansSC_400Regular.ttf`, `NotoSansSC_700Bold.ttf` — Noto Sans Simplified
Chinese, from Google Fonts, under the SIL Open Font License 1.1 (redistribution
permitted; see https://fonts.google.com/noto/specimen/Noto+Sans+SC/about).

## Why these are in the repo

The procurement PO (Phase 13C) is a Chinese-language document. `@react-pdf/renderer`
does no font fallback: with the default Helvetica, every Hanzi renders blank, and
it does so silently — the PDF is produced, looks fine in code review, and reaches
a factory with empty cells. A CJK font has to be embedded.

## Why not a subset

Subsetting would cut ~20MB to a few hundred KB, but the glyph set is not static:
vendor names, mainland addresses and catalogue labels are all user data. A subset
built today breaks the first time someone adds a vendor whose name uses a
character outside it — and it breaks silently, in the same invisible way. Ship the
whole font.

## Why not the system font

macOS carries STHeiti and PingFang, but as `.ttc` collections, which fontkit
cannot register — and neither is present in the Railway container regardless.

## Deployment

`output: 'standalone'` traces imports, not runtime `fs` reads, so these files must
be named in `outputFileTracingIncludes` in `next.config.ts` or they will be absent
in production while working perfectly in dev.
