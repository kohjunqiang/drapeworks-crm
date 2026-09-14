import Link from "next/link";

type Props = {
  active: number;
  inProduction: number;
  awaitingShipment: number;
  readyForInstallation: number;
  awaitingBalance: number;
  completedThisMonth: number;
  completedHref: string;
};

function Card({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const className =
    "bg-white rounded-lg border border-slate-200 p-3 sm:p-4";
  const content = (
    <>
      <div className="text-xs sm:text-sm text-slate-500">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
        {value}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`${className} transition-colors hover:border-teal-400 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500`}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={className}>{content}</div>
  );
}

export function OrdersStats({
  active,
  inProduction,
  awaitingShipment,
  readyForInstallation,
  awaitingBalance,
  completedThisMonth,
  completedHref,
}: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
      <Card label="Active orders" value={active} />
      <Card label="In production" value={inProduction} />
      <Card label="Awaiting shipment" value={awaitingShipment} />
      <Card label="Ready for installation" value={readyForInstallation} />
      <Card label="Awaiting balance" value={awaitingBalance} href="/orders?status=installation_completed" />
      <Card
        label="Completed this month"
        value={completedThisMonth}
        href={completedHref}
      />
    </div>
  );
}
