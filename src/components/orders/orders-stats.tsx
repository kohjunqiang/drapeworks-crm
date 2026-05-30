type Props = {
  active: number;
  awaitingShipment: number;
  readyForInstallation: number;
  completedThisMonth: number;
};

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4">
      <div className="text-xs sm:text-sm text-slate-500">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
        {value}
      </div>
    </div>
  );
}

export function OrdersStats({
  active,
  awaitingShipment,
  readyForInstallation,
  completedThisMonth,
}: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
      <Card label="Active orders" value={active} />
      <Card label="Awaiting shipment" value={awaitingShipment} />
      <Card label="Ready for installation" value={readyForInstallation} />
      <Card label="Completed this month" value={completedThisMonth} />
    </div>
  );
}
