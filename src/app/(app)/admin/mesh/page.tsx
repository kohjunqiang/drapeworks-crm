import { permanentRedirect } from "next/navigation";

// Phase 12 moved the mesh catalogue under the Product section. Kept as a
// permanent redirect so existing bookmarks keep working.
export default function MeshCatalogueRedirect() {
  permanentRedirect("/admin/product/mesh");
}
