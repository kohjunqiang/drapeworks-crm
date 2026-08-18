import "server-only";

import { db } from "@/lib/db/kysely";

export type VendorRow = {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  // Phase 13C — the 供应商 block of a Chinese purchase order. Null means the
  // line is simply not printed.
  internal_ref: string | null;
  name_cn: string | null;
  address_cn: string | null;
  phone: string | null;
};

// All vendors (active first, then by name) for the admin management table.
export async function loadVendors(): Promise<VendorRow[]> {
  return db
    .selectFrom("vendors")
    .select([
      "id",
      "name",
      "is_active",
      "notes",
      "internal_ref",
      "name_cn",
      "address_cn",
      "phone",
    ])
    .orderBy("is_active", "desc")
    .orderBy("name", "asc")
    .execute();
}

export type VendorOption = { id: string; name: string };

// Active vendors only, for the series pricing dropdown.
export async function loadActiveVendorOptions(): Promise<VendorOption[]> {
  return db
    .selectFrom("vendors")
    .select(["id", "name"])
    .where("is_active", "=", true)
    .orderBy("name", "asc")
    .execute();
}
