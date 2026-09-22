import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PhotoStrip, type PhotoTile } from "./photo-strip";

const photos: PhotoTile[] = [
  {
    id: "p1",
    signedUrl:
      "https://example.supabase.co/storage/v1/object/sign/room-photos/a.jpg?token=t1",
    originalName: "front.jpg",
  },
  {
    id: "p2",
    signedUrl:
      "https://example.supabase.co/storage/v1/object/sign/room-photos/b.jpg?token=t2",
    originalName: null,
  },
];

function render(items: PhotoTile[]): string {
  return renderToStaticMarkup(createElement(PhotoStrip, { photos: items }));
}

describe("PhotoStrip", () => {
  it("renders each photo as a button tile, not a link", () => {
    // React SSR prepends <link rel="preload" href="..."> for each <img>;
    // assertions about links apply to the strip markup itself.
    const full = render(photos);
    const html = full.slice(full.indexOf("<div"));
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).not.toContain('target="_blank"');
  });

  it("keeps the thumbnail img and an accessible label per tile", () => {
    const html = render(photos);
    expect(html).toContain(photos[0].signedUrl);
    expect(html).toContain(photos[1].signedUrl);
    expect(html).toContain('alt="front.jpg"');
    expect(html).toContain('aria-label="View front.jpg"');
    // The null originalName falls back to "Room photo".
    expect(html).toContain('alt="Room photo"');
    expect(html).toContain('aria-label="View Room photo"');
  });

  it("does not render the lightbox dialog while closed", () => {
    const html = render(photos);
    expect(html).not.toContain('data-slot="dialog-content"');
    expect(html).not.toContain('role="dialog"');
  });

  it("renders the empty state when there are no photos", () => {
    const html = render([]);
    expect(html).toContain("No photos uploaded.");
    expect(html).not.toContain("<button");
  });
});
