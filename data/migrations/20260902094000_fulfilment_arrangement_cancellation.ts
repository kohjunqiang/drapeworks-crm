import { type Kysely } from "kysely";

// Cancellation is retained as an audit trail instead of deleting the booking.
// The same row may be reactivated later because there is one arrangement per
// order; saveFulfilmentArrangement clears these fields when rebooking.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("fulfilment_arrangements")
    .addColumn("cancelled_at", "timestamptz")
    .addColumn("cancelled_by", "uuid", (column) =>
      column.references("profiles.id").onDelete("set null"),
    )
    .addColumn("cancellation_reason", "text")
    .execute();

  await db.schema
    .createIndex("fulfilment_arrangements_cancelled_by_idx")
    .on("fulfilment_arrangements")
    .column("cancelled_by")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("fulfilment_arrangements_cancelled_by_idx")
    .execute();
  await db.schema
    .alterTable("fulfilment_arrangements")
    .dropColumn("cancellation_reason")
    .dropColumn("cancelled_by")
    .dropColumn("cancelled_at")
    .execute();
}
