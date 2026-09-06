import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { completeZohoAuthorization } from "@/lib/zoho/connection";

export async function GET(request: NextRequest) {
  const session = await requireRole(["admin"]);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const denied = request.nextUrl.searchParams.get("error");
  if (denied) return NextResponse.redirect(new URL("/admin/integrations/zoho?result=cancelled", request.url));
  if (!state || !code) return NextResponse.redirect(new URL("/admin/integrations/zoho?result=invalid_callback", request.url));
  try {
    const result = await completeZohoAuthorization({
      adminId: session.user.id, state, code,
      accountsServer: request.nextUrl.searchParams.get("accounts-server"), origin: request.nextUrl.origin,
    });
    return NextResponse.redirect(new URL(`/admin/integrations/zoho?result=${result}`, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho connection failed";
    const codeName = message.includes("expired") || message.includes("already used") ? "expired" : message.includes("organization") ? "organization" : "failed";
    return NextResponse.redirect(new URL(`/admin/integrations/zoho?result=${codeName}`, request.url));
  }
}
