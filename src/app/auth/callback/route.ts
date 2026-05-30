import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Time window during which a freshly-exchanged recovery code grants access
// to /set-password. After this expires the user has to start the reset
// flow over.
const RECOVERY_WINDOW_SECONDS = 10 * 60;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/orders";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      if (next === "/set-password") {
        response.cookies.set("password_recovery", "1", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: RECOVERY_WINDOW_SECONDS,
        });
      }
      return response;
    }
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
