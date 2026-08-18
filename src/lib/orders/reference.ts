/**
 * Order references — the code that doubles as the PO number.
 *
 * This string is printed on a 采购订单, read down a phone line, and typed back
 * by a factory in Shenzhen. So the alphabet deliberately drops the four glyphs
 * that get confused in exactly that situation:
 *
 *   O and 0, I and 1
 *
 * That still leaves 32 symbols and 32^8 ≈ 1.1 × 10^12 references — a collision
 * is not a practical concern, and the one caller retries anyway because the
 * partial unique index is the real authority.
 *
 * Uppercase throughout: a reference read aloud has no case, so storing one that
 * does invites two records that differ only by it.
 */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const REFERENCE_LENGTH = 8;

/**
 * Mint a reference.
 *
 * `randomInt` is injected so the shape can be tested without stubbing global
 * crypto; callers pass a real CSPRNG. It must return an integer in [0, max).
 */
export function generateOrderReference(
  randomInt: (max: number) => number,
): string {
  let out = "";
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return out;
}

/** Does a string look like one of ours? Used to explain, not to validate input. */
export function isGeneratedReference(value: string): boolean {
  if (value.length !== REFERENCE_LENGTH) return false;
  return [...value].every((c) => REFERENCE_ALPHABET.includes(c));
}
