import { CataloguePage } from "@/components/curtain-types/catalogue-page";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export const metadata = { title: "Curtains — Drapeworks CRM" };

export default async function CurtainsCataloguePage() {
  await requireRole(["admin"]);
  return <CataloguePage productLine="curtain" />;
}
