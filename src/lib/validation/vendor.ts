import { z } from "zod";

// Shared client + server. A vendor is a curtain supplier, identified by a
// unique name plus the system's id (uuid). The pricing feature attaches a
// chosen vendor to each curtain series.
export const vendorSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().trim().min(1, "Required").max(120),
  notes: z.string().trim().max(500).optional(),
  is_active: z.boolean().optional(),
  // Phase 13C — the lines the purchase order's 供应商 block prints. All four
  // are optional: a vendor missing one still generates a PO with that line
  // omitted, because they are contact details, not cutting instructions.
  //
  // Plain optional strings here rather than the nullable versions in
  // validation/procurement.ts, because this schema feeds a React Hook Form
  // resolver and a transform would make its input and output types disagree.
  // The action pipes these through vendorProcurementFieldsSchema, which is
  // where "" becomes null.
  internal_ref: z.string().trim().max(40).optional(),
  name_cn: z.string().trim().max(120).optional(),
  address_cn: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(60).optional(),
});

export type VendorInput = z.infer<typeof vendorSchema>;
