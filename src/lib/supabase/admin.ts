import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

declare global {
  var __supabaseAdmin: SupabaseClient<Database> | undefined;
}

export function adminClient(): SupabaseClient<Database> {
  if (!global.__supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    global.__supabaseAdmin = createSupabaseClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return global.__supabaseAdmin;
}
