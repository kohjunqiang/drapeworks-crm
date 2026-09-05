import { sql, type Kysely } from "kysely";

// Mesh is sold in square metres. The former column names and values described
// the rates as per-square-foot, which made a 1 m² panel about 7.6% too expensive
// when the business rate was entered using the 10 ft² = 1 m² convention.
//
// Preserve the configured commercial rates by moving the decimal one place:
// S$19/ft² becomes S$190/m² (and likewise for RMB cost rates).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.mesh_categories
      rename column cost_rmb_cents_per_sqft to cost_rmb_cents_per_sqm
  `.execute(db);
  await sql`
    alter table public.mesh_categories
      rename column sale_sgd_cents_per_sqft to sale_sgd_cents_per_sqm
  `.execute(db);

  await sql`
    update public.mesh_categories
       set cost_rmb_cents_per_sqm = cost_rmb_cents_per_sqm * 10,
           sale_sgd_cents_per_sqm = sale_sgd_cents_per_sqm * 10
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.mesh_categories
       set cost_rmb_cents_per_sqm = round(cost_rmb_cents_per_sqm / 10.0)::integer,
           sale_sgd_cents_per_sqm = round(sale_sgd_cents_per_sqm / 10.0)::integer
  `.execute(db);

  await sql`
    alter table public.mesh_categories
      rename column sale_sgd_cents_per_sqm to sale_sgd_cents_per_sqft
  `.execute(db);
  await sql`
    alter table public.mesh_categories
      rename column cost_rmb_cents_per_sqm to cost_rmb_cents_per_sqft
  `.execute(db);
}
