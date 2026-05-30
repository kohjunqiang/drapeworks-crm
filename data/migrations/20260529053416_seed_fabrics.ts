import { sql, type Kysely } from "kysely";

const SEED = [
  { code: "DW-D-101", name: "Linen Sheer Ivory",        type: "Day",   supplier: "Textura SG",   color: "#f5ecd9", status: "Active",       notes: null },
  { code: "DW-D-102", name: "Cotton Sheer White",       type: "Day",   supplier: "Textura SG",   color: "#fafafa", status: "Active",       notes: null },
  { code: "DW-D-115", name: "Voile Champagne",          type: "Day",   supplier: "KH Fabrics",   color: "#e8d9b8", status: "Active",       notes: "Lead time 3 weeks" },
  { code: "DW-N-201", name: "Velvet Blackout Charcoal", type: "Night", supplier: "KH Fabrics",   color: "#3a3a3a", status: "Active",       notes: null },
  { code: "DW-N-202", name: "Cotton Blackout Beige",    type: "Night", supplier: "Textura SG",   color: "#d4c2a0", status: "Active",       notes: null },
  { code: "DW-N-210", name: "Dimout Navy",              type: "Night", supplier: "Asia Drapery", color: "#1e2b4a", status: "Active",       notes: null },
  { code: "DW-N-220", name: "Suede Blackout Olive",     type: "Night", supplier: "KH Fabrics",   color: "#5a5d3a", status: "Discontinued", notes: "Replaced by DW-N-225" },
  { code: "DW-T-301", name: "Waterproof Roller White",  type: "Both",  supplier: "Rollco",       color: "#f3f3f3", status: "Active",       notes: "For wet areas" },
  { code: "DW-T-302", name: "PVC Roller Grey",          type: "Both",  supplier: "Rollco",       color: "#9aa0a6", status: "Active",       notes: null },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const f of SEED) {
    await sql`
      insert into public.fabrics (code, name, type, supplier, color, status, notes)
      values (
        ${f.code},
        ${f.name},
        ${sql.lit(f.type)}::public.fabric_type,
        ${f.supplier},
        ${f.color},
        ${sql.lit(f.status)}::public.fabric_status,
        ${f.notes}
      )
      on conflict (code) do nothing
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const f of SEED) {
    await sql`delete from public.fabrics where code = ${f.code}`.execute(db);
  }
}
