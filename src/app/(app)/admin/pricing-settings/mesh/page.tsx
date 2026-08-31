import { MeshPricingContent } from "@/app/(app)/admin/product/mesh/page";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mesh Pricing — Drapeworks CRM" };

export default async function MeshPricingPage() {
  await requireRole(["admin"]);
  return <MeshPricingContent />;
}
