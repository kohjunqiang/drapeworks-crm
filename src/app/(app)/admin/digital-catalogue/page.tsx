import { permanentRedirect } from "next/navigation";

// Phase 12 merged the Digital Catalogue and Mesh tabs into one Product section.
// Kept as a permanent redirect so existing bookmarks keep working.
export default function DigitalCatalogueRedirect() {
  permanentRedirect("/admin/product/curtains");
}
