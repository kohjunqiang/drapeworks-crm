import { redirect } from "next/navigation";

// The section has no landing page of its own — Curtains is the default tab.
export default function ProductIndexPage() {
  redirect("/admin/product/curtains");
}
