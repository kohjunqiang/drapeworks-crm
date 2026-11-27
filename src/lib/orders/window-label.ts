/**
 * Every window-specific document (PO, manufacture, install) calls a window by
 * the consultant's location label when one exists, and falls back to the
 * legacy positional "Window N" otherwise.
 */
export function windowLabel(position: number, label?: string | null): string {
  const trimmed = label?.trim();
  return trimmed || `Window ${position + 1}`;
}
