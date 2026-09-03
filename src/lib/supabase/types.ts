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
    Functions: {
      amend_order_payment: {
        Args: {
          p_order_id: string;
          p_quoted_cents: number;
          p_deposit_cents: number;
          p_actor_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: { user_role: "consultant" | "ops" | "admin" };
    CompositeTypes: Record<string, never>;
  };
};
