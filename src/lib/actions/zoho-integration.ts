"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { cancelPendingZohoAuthorization, disconnectZohoConnection, selectZohoOrganization, verifyZohoConnection } from "@/lib/zoho/connection";

const PATH = "/admin/integrations/zoho";

export async function testZohoConnection() {
  const session = await requireRole(["admin"]);
  const status = await verifyZohoConnection(session.user.id);
  revalidatePath(PATH);
  return { status };
}

export async function chooseZohoOrganization(formData: FormData) {
  const session = await requireRole(["admin"]);
  const pendingId = String(formData.get("pendingId") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  if (!pendingId || !organizationId) throw new Error("Select a Zoho Books organization");
  await selectZohoOrganization(session.user.id, pendingId, organizationId);
  revalidatePath(PATH);
}

export async function disconnectZoho() {
  const session = await requireRole(["admin"]);
  await disconnectZohoConnection(session.user.id);
  revalidatePath(PATH);
}

export async function cancelZohoReconnect() {
  const session = await requireRole(["admin"]);
  await cancelPendingZohoAuthorization(session.user.id);
  revalidatePath(PATH);
}
