import { sql, type Kysely } from "kysely";

// Phase 13C — a home for the two PO columns that had nowhere to come from, and
// the closing of the one hole in "we never print what we do not know".
//
// The rule this migration serves, stated once: EVERY CELL OF A 采购订单 IS A
// CUTTING INSTRUCTION. A blank one does not read as "not applicable" on a
// factory floor in Shenzhen — it reads as an omission, and somebody fills it in
// by guessing. An English word on a Chinese document is the same failure with
// better manners. So the system's answer to "we do not have this string" is to
// REFUSE TO GENERATE, naming what is missing, and never to print something.
//
// Three separate things here, all in service of that:
//
//  1. room_type_labels.name_cn becomes nullable, and Service Yard's Latin
//     placeholder becomes NULL — the row was routing around the refusal.
//  2. po_type_labels and po_opening_labels give 窗帘款式 and 开法 a home. They
//     had none: build.ts carried both as nullable pass-throughs from nowhere,
//     so those two columns would have printed EMPTY on every document we
//     generated. Spec §8.5 and §8.6 list them as open items.
//  3. curtain_series.name_cn, because blind wording is per series.
//
// ONLY THREE STRINGS ARE SEEDED, and all three are transcribed off the sample
// PDFs in resource/documents/: 纱窗 Day, 窗帘 Night, 对开 Double draw. Every
// other row is inserted NULL. That is not an oversight to be tidied up later by
// whoever reads this — it is the design. The nulls are the queue of what a
// Chinese-speaking human at the business still has to decide, and generation
// blocks on each one until they do. Filling one in with a plausible term is the
// same class of error as filling in a plausible dimension.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── room_type_labels.name_cn: NOT NULL was the wrong constraint ──────────
  //
  // 202608181500 made name_cn NOT NULL, and the seed then had to put SOMETHING
  // in the Service Yard row — because that room type's CODE is evidenced (SR,
  // off the Blinds sample) while its Chinese name is not. The Blinds sample
  // prints `SR Service Yard`, with no Hanzi anywhere in the cell, which is the
  // document telling us it did not know either.
  //
  // What went in was the Latin string 'Service Yard'. The row therefore EXISTS,
  // and the row-absence check that blocks Kitchen and Balcony sails straight
  // past it — so a blinds order for a service yard would have generated
  // happily, with the English words "Service Yard" sitting in the 房间 column
  // of a document headed for Shenzhen.
  //
  // Making the column nullable collapses two states into one. An absent row and
  // a null name both mean "we do not know", and build.ts now gives both the
  // same answer: refuse, naming the room type. There is no longer any way to
  // satisfy the schema by inventing a value, which is the property worth having
  // — the constraint was pushing in exactly the wrong direction.
  //
  // code stays NOT NULL. A row exists because we know the code; that is what
  // having a row means here.
  await db.schema
    .alterTable("room_type_labels")
    .alterColumn("name_cn", (c) => c.dropNotNull())
    .execute();

  await sql`
    update public.room_type_labels
       set name_cn = null
     where room_type = 'Service Yard'
       and name_cn = 'Service Yard'
  `.execute(db);

  // ── po_type_labels — 窗帘款式 ────────────────────────────────────────────
  //
  // Keyed by what the piece IS, because that is how the samples read it: the
  // Day PO's rows say 纱窗 Day, the Night PO's say 窗帘 Night, the Blinds PO's
  // says 卷帘. It is not a property of the fabric or of the vendor; it is the
  // job the covering does at the window, which is exactly what the window's
  // variant already records.
  //
  // Five keys, matching the coverings the CRM can record. toilet, blind and
  // mesh go in NULL:
  //
  //  · toilet — a single toilet curtain is its own window variant, and no
  //    sample contains one. Whether the factory calls it 窗帘 like a night
  //    curtain or something else is not ours to decide.
  //  · blind — a fallback only. Blind wording varies by series (卷帘 is
  //    specifically a ROLLER blind, not blinds in general), so a blind resolves
  //    curtain_series.name_cn first and lands here only if that is null too.
  //    Left null so the fallback cannot silently mislabel a Roman blind.
  //  · mesh — mesh panels are not on any sample PO and are not yet built into
  //    the document. The key exists so the eventual answer has somewhere to go.
  //
  // A row per key with a nullable label, rather than rows only for what we
  // know: the five keys are the complete list of questions, and an admin screen
  // can render them as five fields, two of which are already answered.
  await db.schema
    .createTable("po_type_labels")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("label_cn", "text")
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "po_type_labels_key_known",
      sql`key in ('day','night','toilet','blind','mesh')`,
    )
    .execute();

  // 纱窗 Day and 窗帘 Night are read off the Day and Night sample POs, where
  // every single table row carries one or the other. Nothing else is invented.
  await sql`
    insert into public.po_type_labels (key, label_cn) values
      ('day',    '纱窗 Day'),
      ('night',  '窗帘 Night'),
      ('toilet', null),
      ('blind',  null),
      ('mesh',   null)
    on conflict (key) do nothing
  `.execute(db);

  // ── po_opening_labels — 开法 ─────────────────────────────────────────────
  //
  // Keyed by windows.draw, the draw direction the consultant already records.
  //
  // TEXT rather than the public.draw_direction enum, deliberately. Two enums in
  // this schema carry draw directions — draw_direction for curtains and
  // mesh_draw_direction for mesh, which adds Single Top and Single Bottom — and
  // they overlap on the three values below. Keying on one of them would put the
  // other's values permanently out of reach of the only table that can label
  // them. The set of keys here is a superset of both, so text is the honest
  // type. (room_type_labels keys on its enum for the opposite reason: there is
  // exactly one room_type.)
  //
  // 对开 Double draw is on every curtain row of both curtain samples. Single
  // Left and Single Right appear nowhere and go in NULL.
  //
  // NOT MODELLED HERE: the Blinds sample's `要罩盒 - with cover`, which sits in
  // this same 开法 column. It is not a draw direction at all — it is a blind
  // COVER (pelmet/cassette) option, and we do not store any such field on a
  // window. Giving it a row keyed by draw would be modelling it wrong. Adding
  // the field is out of scope for this fix; see spec §8.6, which flags exactly
  // this question. Until then a blind's 开法 resolves to whatever its draw
  // direction says, and null blocks generation as usual.
  await db.schema
    .createTable("po_opening_labels")
    .addColumn("draw", "text", (c) => c.primaryKey())
    .addColumn("label_cn", "text")
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    insert into public.po_opening_labels (draw, label_cn) values
      ('Double',       '对开 Double draw'),
      ('Single Left',  null),
      ('Single Right', null)
    on conflict (draw) do nothing
  `.execute(db);

  // ── curtain_series.name_cn ──────────────────────────────────────────────
  //
  // Blind wording is per series, not per product line. 卷帘 on the Blinds
  // sample means ROLLER BLIND specifically; a Roman, Venetian or Korean Combi
  // blind is a different word, and none of the three are evidenced anywhere.
  // So the string belongs beside the series it describes, where an admin
  // editing the series can see which one they are naming.
  //
  // Nullable and unseeded: even Roller is not filled in here, because matching
  // our series rows to the sample's 卷帘 by name would be a guess about which
  // of our series that document was for. The business sets it on the series
  // screen, looking at both sides. Curtain series ignore this column — a
  // curtain's 窗帘款式 comes from po_type_labels by day/night.
  await db.schema
    .alterTable("curtain_series")
    .addColumn("name_cn", "text")
    .execute();

  await sql`
    create trigger po_type_labels_set_updated_at
      before update on public.po_type_labels
      for each row execute function public.set_updated_at()
  `.execute(db);
  await sql`
    create trigger po_opening_labels_set_updated_at
      before update on public.po_opening_labels
      for each row execute function public.set_updated_at()
  `.execute(db);

  // ── RLS ─────────────────────────────────────────────────────────────────
  //
  // Same shape as room_type_labels and procurement_settings, for the same
  // reasons: everyone signed in may read (the PO builder runs as the user
  // generating it), admin only may write (these are factory-facing strings,
  // company-wide).
  //
  // NO DELETE POLICY ON EITHER TABLE, and again that is the point rather than
  // an omission. Deleting a row here would not clear a label, it would remove a
  // QUESTION: the row's existence is what says "this key needs a Chinese
  // string, and here is whether we have one". Deleting po_type_labels('blind')
  // does not stop us needing to label blinds; it just stops the admin screen
  // asking. Corrections are updates — including correcting a label back to
  // null, which is the right move if a term turns out to be wrong, and which
  // restores the refusal rather than leaving a bad string on documents.
  for (const table of ["po_type_labels", "po_opening_labels"]) {
    await sql`alter table ${sql.raw(`public.${table}`)} enable row level security`.execute(
      db,
    );
    await sql`
      create policy ${sql.raw(`"${table}_select_authenticated"`)}
        on ${sql.raw(`public.${table}`)} for select to authenticated using (true)
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_insert_admin"`)}
        on ${sql.raw(`public.${table}`)} for insert to authenticated
        with check (public.is_admin())
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_update_admin"`)}
        on ${sql.raw(`public.${table}`)} for update to authenticated
        using (public.is_admin()) with check (public.is_admin())
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Dropping each table takes its trigger and policies with it.
  await db.schema.dropTable("po_opening_labels").execute();
  await db.schema.dropTable("po_type_labels").execute();

  await db.schema.alterTable("curtain_series").dropColumn("name_cn").execute();

  // Restoring NOT NULL means restoring the placeholder that made it satisfiable
  // — this migration's whole point is that the two go together. Any OTHER row
  // an admin has since blanked will make the alter fail loudly, which is the
  // correct outcome: there is no honest value to put there, and reversing this
  // migration in that state would mean inventing one.
  await sql`
    update public.room_type_labels
       set name_cn = 'Service Yard'
     where room_type = 'Service Yard'
       and name_cn is null
  `.execute(db);

  await db.schema
    .alterTable("room_type_labels")
    .alterColumn("name_cn", (c) => c.setNotNull())
    .execute();
}
