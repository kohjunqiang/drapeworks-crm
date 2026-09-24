// Errors whose messages are deliberately written for operators. Only these may
// cross a Server Action boundary as text: production Next.js redacts every
// thrown error to a digest, so result-returning action wrappers catch inside
// the action and return this message verbatim. Anything else is logged
// server-side and reported with a generic fallback so raw database,
// infrastructure, or credential details never reach the client.
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(error);
  return fallback;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Runs a server-side task and converts its outcome into a value that survives
// the Server Action boundary in production.
export async function toActionResult<T>(task: () => Promise<T>, fallback: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, fallback) };
  }
}
