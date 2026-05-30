import Link from "next/link";

type Props = {
  title: string;
  description?: string;
  cta?: { href: string; label: string };
};

export function EmptyState({ title, description, cta }: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 py-16 px-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-2xl text-slate-400 mb-4">
        📋
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          {description}
        </p>
      )}
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center justify-center gap-2 mt-5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
