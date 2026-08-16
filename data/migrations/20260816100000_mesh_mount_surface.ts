import { type Kysely } from "kysely";

// Phase 11 correction — what the mesh frame is fixed to.
//
// The original design recorded a recess depth on the assumption that a deep
// enough reveal meant the frame could be seated inside the opening, and a
// shallow one forced a face mount. That is not how these are installed: the
// frame is screwed to the WINDOW GRILLE. The only exception is an opening with
// no window at all, where there is no grille and the frame goes to the wall.
//
// So the deciding fact is whether there is a window, not how deep the reveal
// is — and `depth_cm` was a number nobody acted on. It is dropped rather than
// left to rot as a field consultants dutifully fill in for nothing.
//
// `has_window` is not null with a default of true: unlike the measurement
// columns around it there is no meaningful "unset" state, the default is the
// overwhelmingly common case, and a draft saved before anyone thinks about it
// should read as the normal installation rather than a third unknown state.
//
// Mount surface does NOT affect price. Install stays panels × the mesh handyman
// charge regardless of what the frame is screwed to.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_panels")
    .addColumn("has_window", "boolean", (c) => c.notNull().defaultTo(true))
    .execute();

  await db.schema.alterTable("mesh_panels").dropColumn("depth_cm").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_panels")
    .addColumn("depth_cm", "integer")
    .execute();

  // Nothing restores the dropped depth values; `down()` returns the shape, not
  // the data. Recorded here so it is a known consequence rather than a
  // surprise — no mesh order exists at the time of writing.
  await db.schema.alterTable("mesh_panels").dropColumn("has_window").execute();
}
