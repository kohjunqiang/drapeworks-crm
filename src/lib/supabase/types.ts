// Auth-only typings for the @supabase/ssr clients. Application data is queried
// through Kysely (`src/lib/db/schema.ts`), not the Supabase client.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { user_role: "consultant" | "ops" | "admin" };
    CompositeTypes: Record<string, never>;
  };
};
