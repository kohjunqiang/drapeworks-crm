import {
  ConsultationForm,
  type AppointmentPrefill,
} from "@/components/orders/consultation-form";
import type { CustomerLeadOption } from "@/components/orders/consultation-form/customer-section";
import { MeshConsultationForm } from "@/components/orders/mesh-form";
import { ProductLineChooser } from "@/components/orders/product-line-chooser";
import { requireRole } from "@/lib/auth/require-role";
import { loadActiveCombos } from "@/lib/db/combos";
import { loadActiveCurtainTypeOptions } from "@/lib/db/curtain-types";
import {
  loadActiveMeshSystemBands,
  loadActiveMeshSystemSpecs,
  meshIsSellable,
} from "@/lib/db/mesh-catalogue";
import { loadActivePromotions } from "@/lib/db/promotions";
import { loadCurtainPackages } from "@/lib/db/product-pricing-settings";
import { db } from "@/lib/db/kysely";
import { loadCalcConfig, loadMeshCalcConfig } from "@/lib/pricing/order-quote";
import { ATTEND_APPOINTMENT_STAGE } from "@/lib/leads/funnel-types";

export const dynamic = "force-dynamic";

export const metadata = { title: "New Consultation — Drapeworks CRM" };

type SearchParams = { product?: string; appointmentId?: string; leadId?: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The customer booked for this appointment, if the link carried one.
 *
 * This is the seam the whole phase exists to close: the customer was captured
 * once when the appointment was booked, and retyping it here is what produced
 * the duplicate rows in `customers`.
 *
 * A hand-typed, non-uuid id is treated as no appointment rather than passed to
 * Postgres, where it would be a 22P02 error — i.e. a 500 on a page that should
 * simply fall back to a blank consultation.
 */
async function loadAppointmentPrefill(
  appointmentId: string | undefined,
  leadId: string | undefined,
): Promise<AppointmentPrefill | undefined> {
  if (appointmentId && UUID_RE.test(appointmentId)) {
    const booked = await db
      .selectFrom("appointments")
      .innerJoin("customers", "customers.id", "appointments.customer_id")
      .select([
        "appointments.id as appointment_id",
        "appointments.lead_id",
        "appointments.development as development",
        "appointments.address as address",
        "customers.name as customer_name",
        "customers.mobile as customer_mobile",
        "customers.email as customer_email",
      ])
      .innerJoin("leads", "leads.id", "appointments.lead_id")
      .leftJoin("orders", "orders.lead_id", "appointments.lead_id")
      .where("appointments.id", "=", appointmentId)
      .where("appointments.status", "=", "scheduled")
      .where("leads.is_archived", "=", false)
      .where("leads.funnel_stage", "=", ATTEND_APPOINTMENT_STAGE)
      .where("orders.id", "is", null)
      .executeTakeFirst();

    if (booked) {
      return {
        id: booked.appointment_id,
        leadId: booked.lead_id,
        customer: {
          name: booked.customer_name,
          mobile: booked.customer_mobile,
          email: booked.customer_email ?? undefined,
        },
        development: booked.development,
        address: booked.address,
      };
    }
  }

  if (!leadId || !UUID_RE.test(leadId)) return undefined;
  const lead = await db.selectFrom("leads")
    .leftJoin("orders", "orders.lead_id", "leads.id")
    .innerJoin("appointments", (join) => join
      .onRef("appointments.lead_id", "=", "leads.id")
      .on("appointments.status", "=", "scheduled"))
    // The appointment is the source of truth for the booked customer. Older
    // records may have an appointment customer even when leads.customer_id was
    // not backfilled, which previously left mobile blank on the order form.
    .innerJoin("customers", "customers.id", "appointments.customer_id")
    .select([
      "leads.id",
      "leads.name as lead_name",
      "leads.mobile as lead_mobile",
      "leads.development",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "customers.email as customer_email",
      "appointments.id as appointment_id",
      "appointments.address as appointment_address",
      "appointments.development as appointment_development",
    ])
    .where("leads.id", "=", leadId)
    .where("leads.is_archived", "=", false)
    .where("leads.funnel_stage", "=", ATTEND_APPOINTMENT_STAGE)
    .where("orders.id", "is", null)
    .executeTakeFirst();
  if (!lead) return undefined;

  return {
    id: lead.appointment_id ?? undefined,
    leadId: lead.id,
    customer: {
      name: lead.customer_name ?? lead.lead_name,
      mobile: lead.customer_mobile ?? lead.lead_mobile ?? "",
      email: lead.customer_email ?? undefined,
    },
    development: lead.appointment_development ?? lead.development,
    address: lead.appointment_address,
  };
}

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRole(["consultant", "admin"]);
  const { product, appointmentId, leadId } = await searchParams;
  const appointment = await loadAppointmentPrefill(appointmentId, leadId);
  const consultationLeads = await db.selectFrom("leads")
    .leftJoin("orders", "orders.lead_id", "leads.id")
    .innerJoin("appointments", (join) => join
      .onRef("appointments.lead_id", "=", "leads.id")
      .on("appointments.status", "=", "scheduled"))
    .innerJoin("customers", "customers.id", "appointments.customer_id")
    .select([
      "leads.id as lead_id", "leads.name as lead_name",
      "customers.mobile as customer_mobile",
      "appointments.development as appointment_development",
      "leads.development as lead_development",
    ])
    .where("leads.is_archived", "=", false)
    .where("leads.funnel_stage", "=", ATTEND_APPOINTMENT_STAGE)
    .where("orders.id", "is", null)
    .orderBy("leads.updated_at", "desc")
    .execute();
  const leadOptions: CustomerLeadOption[] = consultationLeads.map(item => ({
    leadId: item.lead_id,
    leadName: item.lead_name,
    mobile: item.customer_mobile,
    development: item.appointment_development ?? item.lead_development,
  }));
  if (appointment?.leadId && !leadOptions.some(item => item.leadId === appointment.leadId)) {
    leadOptions.unshift({
      leadId: appointment.leadId,
      leadName: appointment.customer.name,
      mobile: appointment.customer.mobile,
      development: appointment.development ?? null,
    });
  }

  const today = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const consultantName =
    session.profile.full_name?.trim() || session.profile.email.split("@")[0];

  // A mesh consultation is only reachable when mesh is actually sellable, so a
  // hand-typed ?product=mesh can't produce a $0 quote either.
  const meshEnabled = await meshIsSellable();
  const chosen =
    product === "mesh" && meshEnabled
      ? "mesh"
      : product === "curtain"
        ? "curtain"
        : null;

  const heading =
    chosen === "mesh"
      ? {
          title: "New Mesh Consultation",
          blurb: "Capture panel sizes, draw and colour on-site",
        }
      : chosen === "curtain"
        ? {
            title: "New Consultation",
            blurb: "Capture measurements and fabric details on-site",
          }
        : {
            title: "New Consultation",
            blurb: "Pick what you're quoting for this customer",
          };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {heading.title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{heading.blurb}</p>
        </div>
        <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded px-3 py-2 sm:text-right">
          <div>
            Consultant:{" "}
            <span className="font-medium text-slate-700">{consultantName}</span>
          </div>
          <div>
            Date: <span className="font-medium text-slate-700">{today}</span>
          </div>
        </div>
      </div>

      {/* The appointment link lands here with no ?product, so the chooser has
          to carry the booking through the choice — dropping it would lose the
          prefill at the very click that leads to the form. */}
      {chosen === null && (
        <ProductLineChooser
          meshEnabled={meshEnabled}
          appointmentId={appointment?.id}
          leadId={appointment?.leadId}
        />
      )}
      {chosen === "curtain" && (
        <CurtainConsultation
          key={appointment?.id ?? appointment?.leadId ?? "brand-new"}
          appointment={appointment}
          leadOptions={leadOptions}
        />
      )}
      {chosen === "mesh" && (
        <MeshConsultation
          key={appointment?.id ?? appointment?.leadId ?? "brand-new"}
          appointment={appointment}
          leadOptions={leadOptions}
        />
      )}
    </main>
  );
}

async function CurtainConsultation({
  appointment,
  leadOptions,
}: {
  appointment?: AppointmentPrefill;
  leadOptions: CustomerLeadOption[];
}) {
  const [curtainTypes, calcConfig, promotions, combos, curtainPackages] = await Promise.all([
    loadActiveCurtainTypeOptions(),
    loadCalcConfig(),
    loadActivePromotions(),
    loadActiveCombos(),
    loadCurtainPackages(),
  ]);

  return (
    <ConsultationForm
      mode="create"
      curtainTypes={curtainTypes}
      calcConfig={calcConfig}
      promotions={promotions}
      combos={combos}
      curtainPackages={curtainPackages.filter((item) => item.isActive)}
      appointment={appointment}
      leadOptions={leadOptions}
    />
  );
}

async function MeshConsultation({
  appointment,
  leadOptions,
}: {
  appointment?: AppointmentPrefill;
  leadOptions: CustomerLeadOption[];
}) {
  // No in-use ids to union: a new order references nothing yet, so this is the
  // active catalogue only.
  const [meshConfig, promotions, systemBands, systemSpecs] =
    await Promise.all([
      loadMeshCalcConfig(),
      loadActivePromotions(),
      loadActiveMeshSystemBands(),
      loadActiveMeshSystemSpecs(),
    ]);

  if (!meshConfig) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Mesh pricing isn&rsquo;t configured yet.
      </div>
    );
  }

  return (
    <MeshConsultationForm
      mode="create"
      meshConfig={meshConfig}
      systemBands={systemBands}
      systemSpecs={systemSpecs}
      promotions={promotions}
      appointment={appointment}
      leadOptions={leadOptions}
    />
  );
}
