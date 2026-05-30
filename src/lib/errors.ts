import "server-only";

// Patterns that indicate an internal/postgres/supabase string that should
// never reach a user-facing toast.
const INTERNAL_PATTERNS = [
  /^duplicate key/i,
  /violates\s+(unique|foreign key|check)/i,
  /null value in column/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /^syntax error/i,
  /^invalid input syntax/i,
  /insert or update on table/i,
  /jwt /i,
  /pgrst\d+/i,
];

function looksInternal(message: string): boolean {
  return INTERNAL_PATTERNS.some((re) => re.test(message));
}

/**
 * Decide what to surface in a server-action toast.
 * - Friendly messages we authored pass through unchanged.
 * - Postgres / Supabase / PostgREST internals are replaced with the fallback.
 * - The original is always logged to the server side for debugging.
 */
export function userMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    console.error("[action error]", err.message);
    if (!looksInternal(err.message)) return err.message;
  } else if (err) {
    console.error("[action error]", err);
  }
  return fallback;
}
