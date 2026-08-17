import { CataloguePage } from "@/components/curtain-types/catalogue-page";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export const metadata = { title: "Blinds — Drapeworks CRM" };

export default async function BlindsCataloguePage() {
  await requireRole(["admin"]);
  return <CataloguePage productLine="blind" />;
}
