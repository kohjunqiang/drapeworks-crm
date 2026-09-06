import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createZohoAuthorizationUrl } from "@/lib/zoho/connection";

export async function GET(request: NextRequest) {
  const session = await requireRole(["admin"]);
  const url = await createZohoAuthorizationUrl(session.user.id, request.nextUrl.origin);
  return NextResponse.redirect(url);
}
