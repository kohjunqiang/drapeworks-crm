import {
  ConsultationForm,
  type AppointmentPrefill,
} from "@/components/orders/consultation-form";
import type {
  CustomerLeadOption,
  ExistingCustomerOption,
} from "@/components/orders/consultation-form/customer-section";
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
import {
  loadCurtainOrderTemplate,
  loadMeshOrderTemplate,
} from "@/lib/orders/order-template";
import { consultationCustomerCookie } from "@/lib/orders/consultation-selection";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata = { title: "New Consultation — Drapeworks CRM" };

type SearchParams = {
  product?: string;
  appointmentId?: string;
  leadId?: string;
};

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
  customerId: string | undefined,
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
        "customers.id as customer_id",
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
        customerId: booked.customer_id,
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

  if (leadId && UUID_RE.test(leadId)) {
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
        "customers.id as customer_id",
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

    if (lead) {
      return {
        id: lead.appointment_id ?? undefined,
        leadId: lead.id,
        customerId: lead.customer_id,
        customer: {
          name: lead.customer_name ?? lead.lead_name,
          mobile: lead.customer_mobile ?? lead.lead_mobile ?? "",
          email: lead.customer_email ?? undefined,
        },
        development: lead.appointment_development ?? lead.development,
        address: lead.appointment_address,
      };
    }
  }

  if (!customerId || !UUID_RE.test(customerId)) return undefined;
  const existingCustomer = await db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select([
      "customers.id",
      "customers.name",
      "customers.mobile",
      "customers.email",
      "orders.development",
      "orders.site_address",
    ])
    .where("customers.id", "=", customerId)
    .orderBy("orders.updated_at", "desc")
    .executeTakeFirst();
  if (!existingCustomer) return undefined;

  return {
    customerId: existingCustomer.id,
    customer: {
      name: existingCustomer.name,
      mobile: existingCustomer.mobile,
      email: existingCustomer.email ?? undefined,
    },
    development: existingCustomer.development,
    address: existingCustomer.site_address,
  };
}

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireRole(["consultant", "admin"]);
  const { product, appointmentId, leadId } = await searchParams;
  const cookieStore = await cookies();
  const sessionCustomerId = product === "mesh" || product === "curtain"
    ? cookieStore.get(consultationCustomerCookie(product))?.value
    : undefined;
  const appointment = await loadAppointmentPrefill(
    appointmentId,
    leadId,
    appointmentId || leadId ? undefined : sessionCustomerId,
  );
  const consultationLeads = await db.selectFrom("leads")
    .leftJoin("orders", "orders.lead_id", "leads.id")
    .innerJoin("appointments", (join) => join
      .onRef("appointments.lead_id", "=", "leads.id")
      .on("appointments.status", "=", "scheduled"))
    .innerJoin("customers", "customers.id", "appointments.customer_id")
    .select([
      "leads.id as lead_id", "leads.name as lead_name",
      "customers.id as customer_id",
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
  const leadCustomerIds = new Set(consultationLeads.map(item => item.customer_id));
  const repeatCustomers = await db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select([
      "customers.id as customer_id",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "orders.development",
    ])
    .distinctOn("customers.id")
    .orderBy("customers.id")
    .orderBy("orders.updated_at", "desc")
    .execute();
  const customerOptions: ExistingCustomerOption[] = repeatCustomers
    .filter(item => !leadCustomerIds.has(item.customer_id))
    .map(item => ({
      customerId: item.customer_id,
      customerName: item.customer_name,
      mobile: item.customer_mobile,
      development: item.development,
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));
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
          key={appointment?.id ?? appointment?.leadId ?? appointment?.customerId ?? "brand-new"}
          appointment={appointment}
          leadOptions={leadOptions}
          customerOptions={customerOptions}
        />
      )}
      {chosen === "mesh" && (
        <MeshConsultation
          key={appointment?.id ?? appointment?.leadId ?? appointment?.customerId ?? "brand-new"}
          appointment={appointment}
          leadOptions={leadOptions}
          customerOptions={customerOptions}
        />
      )}
    </main>
  );
}

async function CurtainConsultation({
  appointment,
  leadOptions,
  customerOptions,
}: {
  appointment?: AppointmentPrefill;
  leadOptions: CustomerLeadOption[];
  customerOptions: ExistingCustomerOption[];
}) {
  const [curtainTypes, calcConfig, promotions, combos, curtainPackages, template] =
    await Promise.all([
      loadActiveCurtainTypeOptions(),
      loadCalcConfig(),
      loadActivePromotions(),
      loadActiveCombos(),
      loadCurtainPackages(),
      appointment?.customerId
        ? loadCurtainOrderTemplate(appointment.customerId)
        : undefined,
    ]);
  const activeTypeIds = new Set(curtainTypes.map((item) => item.id));
  const activeComboIds = new Set(combos.map((item) => item.id));
  const activeAddonIds = new Set(
    (calcConfig?.addonCatalogue ?? [])
      .filter((item) => item.isActive)
      .map((item) => item.id),
  );
  const templateDefaults = template ? {
    ...template.defaults,
    rooms: template.defaults.rooms.map((room) => ({
      ...room,
      windows: room.windows.map((window) => window.variant === "blind"
        ? {
            ...window,
            blind_type_id: activeTypeIds.has(window.blind_type_id ?? "")
              ? window.blind_type_id
              : "",
            addon_ids: window.addon_ids.filter((id) => activeAddonIds.has(id)),
          }
        : {
            ...window,
            day_curtain_type_id: activeTypeIds.has(window.day_curtain_type_id ?? "")
              ? window.day_curtain_type_id
              : "",
            night_curtain_type_id: activeTypeIds.has(window.night_curtain_type_id ?? "")
              ? window.night_curtain_type_id
              : "",
            combo_id: activeComboIds.has(window.combo_id ?? "")
              ? window.combo_id
              : "",
            addon_ids: window.addon_ids.filter((id) => activeAddonIds.has(id)),
          }),
    })),
  } : undefined;

  return (
    <>
      {appointment?.customerId && (
        <TemplateNotice
          sourceDisplayId={template?.sourceDisplayId}
          productLabel="curtain or blind"
        />
      )}
      <ConsultationForm
        key={appointment?.id ?? appointment?.leadId ?? appointment?.customerId ?? "brand-new"}
        mode="create"
        curtainTypes={curtainTypes}
        calcConfig={calcConfig}
        promotions={promotions}
        combos={combos}
        curtainPackages={curtainPackages.filter((item) => item.isActive)}
        appointment={appointment}
        leadOptions={leadOptions}
        customerOptions={customerOptions}
        defaultValues={templateDefaults}
        roomPhotos={template?.roomPhotos}
      />
    </>
  );
}

async function MeshConsultation({
  appointment,
  leadOptions,
  customerOptions,
}: {
  appointment?: AppointmentPrefill;
  leadOptions: CustomerLeadOption[];
  customerOptions: ExistingCustomerOption[];
}) {
  const templatePromise = appointment?.customerId
    ? loadMeshOrderTemplate(appointment.customerId)
    : undefined;
  const [template, promotions, systemBands, systemSpecs] =
    await Promise.all([
      templatePromise,
      loadActivePromotions(),
      loadActiveMeshSystemBands(),
      loadActiveMeshSystemSpecs(),
    ]);
  const meshConfig = await loadMeshCalcConfig();

  if (!meshConfig) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Mesh pricing isn&rsquo;t configured yet.
      </div>
    );
  }

  const activeCategoryIds = new Set(
    meshConfig.categories.filter((item) => item.selectable).map((item) => item.id),
  );
  const activeColourIds = new Set(
    meshConfig.colours.filter((item) => item.selectable).map((item) => item.id),
  );
  const templateDefaults = template ? {
    ...template.defaults,
    rooms: template.defaults.rooms.map((room) => ({
      ...room,
      panels: room.panels.map((panel) => ({
        ...panel,
        category_id: activeCategoryIds.has(panel.category_id ?? "")
          ? panel.category_id
          : "",
        colour_id: activeColourIds.has(panel.colour_id ?? "")
          ? panel.colour_id
          : "",
      })),
    })),
  } : undefined;

  return (
    <>
      {appointment?.customerId && (
        <TemplateNotice
          sourceDisplayId={template?.sourceDisplayId}
          productLabel="mesh"
        />
      )}
      <MeshConsultationForm
        key={appointment?.id ?? appointment?.leadId ?? appointment?.customerId ?? "brand-new"}
        mode="create"
        meshConfig={meshConfig}
        systemBands={systemBands}
        systemSpecs={systemSpecs}
        promotions={promotions}
        appointment={appointment}
        leadOptions={leadOptions}
        customerOptions={customerOptions}
        defaultValues={templateDefaults}
        roomPhotos={template?.roomPhotos}
      />
    </>
  );
}

function TemplateNotice({
  sourceDisplayId,
  productLabel,
}: {
  sourceDisplayId?: string;
  productLabel: string;
}) {
  return (
    <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
      {sourceDisplayId
        ? `Rooms and measurements copied from ${sourceDisplayId}. Review the options, adjust what changed, and save to create a separate order.`
        : `Customer details loaded. No previous ${productLabel} order was found, so add the new measurements below.`}
    </div>
  );
}
