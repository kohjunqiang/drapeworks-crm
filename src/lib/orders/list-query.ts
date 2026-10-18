import { sql, type ExpressionBuilder } from "kysely";

import type { DB } from "@/lib/db/schema";

export const ORDER_PAGE_SIZE = 50;

/** Each word may match any searchable field; spacing and word order are immaterial. */
export function orderSearch(eb: ExpressionBuilder<DB, "orders" | "customers">, query: string) {
  const words = query.replace(/[%_\\]/g, "").trim().split(/\s+/).filter(Boolean);
  return eb.and(words.map((word) => {
    const like = `%${word}%`;
    return eb.or([
      eb("customers.name", "ilike", like),
      eb("customers.mobile", "ilike", like),
      eb("orders.development", "ilike", like),
      eb("orders.display_id", "ilike", like),
      eb("orders.order_reference", "ilike", like),
      sql<boolean>`exists (
        select 1 from public.order_shipments os
        where os.order_id = orders.id
          and os.overseas_freight_number ilike ${like}
      )`,
    ]);
  }));
}

export function orderPagination(rawPage: string | undefined, total: number) {
  const requested = Number(rawPage);
  const pages = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
  const page = Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, pages)
    : 1;
  const offset = (page - 1) * ORDER_PAGE_SIZE;
  return { page, pages, offset, first: total ? offset + 1 : 0, last: Math.min(offset + ORDER_PAGE_SIZE, total) };
}
