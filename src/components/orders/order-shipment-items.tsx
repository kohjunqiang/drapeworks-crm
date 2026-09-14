import Link from "next/link";
import { formatFreightAge } from "@/lib/logistics/freight";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
import { AssignFreightButton, FreightPillButton } from "./freight-manager";
import { shipmentCategoryTone } from "./shipment-presentation";
import type { OrderRow } from "./orders-table";

export function OrderShipmentItems({ order }: { order: OrderRow }) {
  if (!order.shipments.length) {
    return order.hasFreightComponents
      ? <AssignFreightButton orderIdentifier={primaryOrderIdentifier(order.order_reference, order.display_id)} />
      : <span aria-label="No shipment items">—</span>;
  }
  return (
    <ul className="space-y-1.5" aria-label="Shippable items and freight">
      {order.shipments.map((shipment) => {
        const tone = shipmentCategoryTone(shipment.category);
        // Two deliberate lines keep all items the same height, even with long
        // freight codes. The full code remains available in the freight panel.
        const className = `flex h-14 w-full min-w-0 flex-col justify-center gap-1 rounded-md border px-3 text-left text-xs ${tone.pill}`;
        const content = <>
          <span className={`flex min-w-0 items-center gap-1.5 font-medium ${tone.label}`}>
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
            <span className="truncate" title={shipment.label}>{shipment.label}</span>
          </span>
          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pl-3.5">
            <span className="min-w-0 truncate font-mono font-semibold text-slate-800" title={shipment.freightNumber ?? undefined}>
              {shipment.freightNumber}
            </span>
            <span className="justify-self-end whitespace-nowrap text-right">
              {shipment.notNeeded ? <span className="text-slate-500">Not needed · <span className="underline underline-offset-2">Restore</span></span>
                : shipment.arrivedCheckedAt ? <span className="font-semibold text-emerald-700">Arrived</span>
                : shipment.batchStartedAt ? <span className="text-slate-600">{formatFreightAge(shipment.batchStartedAt)} in transit</span>
                : !shipment.freightNumber ? <span className="font-medium underline underline-offset-2">Assign freight</span> : null}
            </span>
          </span>
        </>;
        return <li key={`${shipment.category}-${shipment.label}`}>
          {shipment.freightNumber
            ? <FreightPillButton freightNumber={shipment.freightNumber} ariaLabel={`Open freight ${shipment.freightNumber} for ${shipment.label}`} className={className}>{content}</FreightPillButton>
            : !shipment.arrivedCheckedAt && order.hasFreightComponents
              ? <AssignFreightButton orderIdentifier={primaryOrderIdentifier(order.order_reference, order.display_id)} target={{ orderId: order.id, category: shipment.category }} ariaLabel={`${shipment.notNeeded ? "Restore shipment" : "Assign freight"} for ${shipment.label}`} className={`${className} outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-teal-500`}>{content}</AssignFreightButton>
              : <Link href={`/orders/${order.id}`} className={className}>{content}</Link>}
        </li>;
      })}
    </ul>
  );
}
