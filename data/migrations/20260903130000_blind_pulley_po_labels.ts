import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Blind control-side wording is separate from curtain draw wording even
  // though both originate from windows.draw. The business can replace these
  // English defaults with its preferred bilingual factory wording in Admin.
  await sql`
    insert into public.po_opening_labels (draw, label_cn) values
      ('Blind Pulley Left', 'Pulley left'),
      ('Blind Pulley Right', 'Pulley right')
    on conflict (draw) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from public.po_opening_labels
     where draw in ('Blind Pulley Left', 'Blind Pulley Right')
  `.execute(db);
}
