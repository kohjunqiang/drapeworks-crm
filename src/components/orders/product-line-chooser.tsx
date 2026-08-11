import Link from "next/link";

// Shown at /orders/new when no product is chosen. Orders never mix product
// lines — a mesh job never shares a quote with a curtain job — so the choice is
// made once, up front, rather than per line item.
//
// The Mesh card only appears once mesh is actually sellable: a priced grid cell
// AND a non-zero install cost. Without the second, every mesh quote would
// overstate its margin.

function Card({
  href,
  title,
  blurb,
  icon,
}: {
  href: string;
  title: string;
  blurb: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="group flex-1 rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-500 hover:shadow-sm transition"
    >
      <div className="text-2xl mb-2" aria-hidden>
        {icon}
      </div>
      <div className="font-semibold text-slate-900 group-hover:text-teal-700">
        {title}
      </div>
      <p className="text-sm text-slate-500 mt-1">{blurb}</p>
    </Link>
  );
}

export function ProductLineChooser({ meshEnabled }: { meshEnabled: boolean }) {
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Card
          href="/orders/new?product=curtain"
          title="Curtains"
          blurb="Day and night curtains, tracks and add-ons, priced per metre of width."
          icon="🪟"
        />
        {meshEnabled && (
          <Card
            href="/orders/new?product=mesh"
            title="Mesh"
            blurb="Window insect and safety mesh, priced flat per panel by size band."
            icon="🛡️"
          />
        )}
      </div>

      {!meshEnabled && (
        <p className="mt-3 text-xs text-slate-500">
          Mesh isn&rsquo;t set up yet. An admin needs to add prices and a mesh
          install cost before it can be quoted.
        </p>
      )}
    </div>
  );
}
