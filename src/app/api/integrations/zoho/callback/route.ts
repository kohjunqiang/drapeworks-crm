import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { completeZohoAuthorization } from "@/lib/zoho/connection";
import { resolveZohoAppOrigin } from "@/lib/zoho/oauth-redirect";

function integrationUrl(request: NextRequest, result: string): URL {
  return new URL(`/admin/integrations/zoho?result=${result}`, resolveZohoAppOrigin(request.nextUrl.origin));
}

export async function GET(request: NextRequest) {
  const session = await requireRole(["admin"]);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const denied = request.nextUrl.searchParams.get("error");
  if (denied) return NextResponse.redirect(integrationUrl(request, "cancelled"));
  if (!state || !code) return NextResponse.redirect(integrationUrl(request, "invalid_callback"));
  try {
    const result = await completeZohoAuthorization({
      adminId: session.user.id, state, code,
      accountsServer: request.nextUrl.searchParams.get("accounts-server"), origin: request.nextUrl.origin,
    });
    return NextResponse.redirect(integrationUrl(request, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho connection failed";
    const codeName = message.includes("expired") || message.includes("already used") ? "expired" : message.includes("organization") ? "organization" : "failed";
    return NextResponse.redirect(integrationUrl(request, codeName));
  }
}
