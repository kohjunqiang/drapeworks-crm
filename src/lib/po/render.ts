// Turns a built PO into PDF bytes.
//
// The only interesting thing here is the font. @react-pdf/renderer's built-in
// faces are the PDF base-14 (Helvetica and friends), none of which contain a
// single CJK glyph — 采购订单 renders as blanks, not as an error and not as
// tofu. Such a document looks structurally perfect in a diff, in a code review
// and in a unit test, and arrives in Shenzhen with every Chinese cell empty. So
// the font is registered here, at module load, before anything can render
// without it, from a TTF vendored into the repo rather than fetched at runtime.

import { statSync } from "node:fs";
import { join } from "node:path";

import { Font, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import type { PoDocData } from "./build";
import { PoDocument } from "./document";

/** The family name document.tsx asks for. */
export const PO_FONT_FAMILY = "Noto Sans SC";

const FONT_DIR = join(process.cwd(), "assets", "fonts");

// @react-pdf opens these paths itself, lazily, on the first render — which is
// far too late to find out they are missing. Two consequences, both handled:
//
//  1. `output: 'standalone'` traces IMPORTS, not runtime fs reads, so the files
//     would not be in the container at all. next.config.ts lists them under
//     outputFileTracingIncludes; that is the other half of this arrangement.
//  2. stat them now, so a packaging mistake throws on module load with the path
//     it could not find, instead of quietly producing a blank-celled PDF a
//     month later.
function fontPath(file: string): string {
  const path = join(FONT_DIR, file);
  statSync(path);
  return path;
}

Font.register({
  family: PO_FONT_FAMILY,
  fonts: [
    { src: fontPath("NotoSansSC_400Regular.ttf"), fontWeight: 400 },
    { src: fontPath("NotoSansSC_700Bold.ttf"), fontWeight: 700 },
  ],
});

export async function renderPo(data: PoDocData): Promise<Buffer> {
  // renderToBuffer is typed against the <Document> element itself, so a
  // component that RETURNS one does not satisfy it. PoDocument's own return type
  // already guarantees what this asserts.
  const element = createElement(PoDocument, { data }) as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
