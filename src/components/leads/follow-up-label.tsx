/**
 * Quiet, non-interactive nudge rendered beneath a lead's identity. Derived at
 * read time (see src/lib/leads/follow-up.ts) — plain text, no tooltip, no
 * focus target.
 */
export function FollowUpLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <div className="mt-0.5">
      <span className="inline-block max-w-full break-words rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium leading-4 text-teal-700">
        {label}
      </span>
    </div>
  );
}
