import { db } from "@/lib/db/kysely";
import { requireSession } from "@/lib/auth/require-role";
import { getZohoInvoicePdf } from "@/lib/zoho/books";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const session = await requireSession();
  const { orderId } = await params;
  const record = await db.selectFrom("orders")
    .innerJoin("order_quotations", "order_quotations.order_id", "orders.id")
    .select([
      "orders.consultant_id",
      "order_quotations.zoho_invoice_id",
      "order_quotations.zoho_invoice_number",
    ])
    .where("orders.id", "=", orderId)
    .where("order_quotations.superseded_at", "is", null)
    .executeTakeFirst();

  if (!record) return new Response("Invoice not found", { status: 404 });
  const isOwner = session.profile.role === "consultant" && record.consultant_id === session.user.id;
  if (session.profile.role !== "admin" && session.profile.role !== "ops" && !isOwner) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!record.zoho_invoice_id) return new Response("Invoice not found", { status: 404 });

  try {
    const bytes = await getZohoInvoicePdf(record.zoho_invoice_id);
    const safeNumber = (record.zoho_invoice_number ?? "Invoice").replace(/[^a-zA-Z0-9_-]/g, "-");
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${safeNumber}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the Zoho invoice PDF";
    return new Response(message, { status: 502 });
  }
}
