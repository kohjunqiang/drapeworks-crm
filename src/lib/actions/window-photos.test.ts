import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const WIN = "550e8400-e29b-41d4-a716-446655440000";

const state = vi.hoisted(() => ({
  userId: "user-1",
  role: "consultant",
  window: null as null | { order_id: string; consultant_id: string },
  photos: new Map<string, { id: string }>(), // storage_path → row
  nextPhotoId: 1,
  storage: {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { token: "tok", signedUrl: `https://sign/${path}`, path },
      error: null,
    })),
    list: vi.fn(async () => ({ data: [] as { name: string; metadata?: { size?: number; mimetype?: string } }[], error: null })),
    remove: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    user: { id: state.userId },
    profile: { role: state.role },
  }),
}));

vi.mock("@/lib/db/kysely", () => ({
  db: {
    selectFrom(table: string) {
      const wheres: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.innerJoin = () => q;
      q.select = () => q;
      q.where = (column: string, _op: string, value: unknown) => {
        wheres[column] = value;
        return q;
      };
      q.executeTakeFirst = async () => {
        if (table === "windows") return state.window ?? undefined;
        if (table === "window_photos") {
          let entry: [string, { id: string }] | undefined;
          if (wheres.storage_path != null) {
            const row = state.photos.get(wheres.storage_path as string);
            if (row) entry = [wheres.storage_path as string, row];
          } else {
            const id = wheres["window_photos.id"] ?? wheres.id;
            entry = [...state.photos].find(([, row]) => row.id === id);
          }
          if (!entry) return undefined;
          // The join result shape the action selects.
          return {
            id: entry[1].id,
            storage_path: entry[0],
            order_id: state.window?.order_id,
            consultant_id: state.window?.consultant_id,
          };
        }
        return undefined;
      };
      q.executeTakeFirstOrThrow = async () => {
        const row = await (q.executeTakeFirst as () => Promise<unknown>)();
        if (!row) throw new Error("no rows");
        return row;
      };
      q.execute = async () => [];
      return q;
    },
    insertInto() {
      const q: Record<string, unknown> = {};
      let values: { storage_path: string } | null = null;
      q.values = (v: { storage_path: string }) => {
        values = v;
        return q;
      };
      q.onConflict = () => q;
      q.returning = () => q;
      // doNothing on the storage_path conflict: a racing confirm wins.
      q.executeTakeFirst = async () => {
        if (!values || state.photos.has(values.storage_path)) return undefined;
        const id = `photo-${state.nextPhotoId++}`;
        state.photos.set(values.storage_path, { id });
        return { id };
      };
      return q;
    },
    deleteFrom() {
      const q: Record<string, unknown> = {};
      q.where = () => q;
      q.execute = async () => [];
      return q;
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({ storage: { from: () => state.storage } }),
}));
vi.mock("@/lib/errors", () => ({
  userMessage: (_e: unknown, fallback: string) => fallback,
}));

import {
  cleanupOrphanWindowUpload,
  confirmWindowPhotoUpload,
  deleteWindowPhoto,
  requestWindowPhotoUpload,
} from "./window-photos";

const goodPath = `orders/order-1/windows/${WIN}/file-1.jpg`;

beforeEach(() => {
  state.userId = "user-1";
  state.role = "consultant";
  state.window = { order_id: "order-1", consultant_id: "user-1" };
  state.photos = new Map();
  state.nextPhotoId = 1;
  vi.clearAllMocks();
  state.storage.createSignedUploadUrl.mockImplementation(async (path: string) => ({
    data: { token: "tok", signedUrl: `https://sign/${path}`, path },
    error: null,
  }));
  state.storage.list.mockResolvedValue({ data: [], error: null });
  state.storage.remove.mockResolvedValue({ error: null });
});

describe("requestWindowPhotoUpload", () => {
  it("issues a signed upload under the owning order and window", async () => {
    const res = await requestWindowPhotoUpload({
      windowId: WIN,
      mime: "image/jpeg",
      sizeBytes: 120_000,
      originalName: "detail.jpg",
    });
    expect(res.path).toMatch(
      new RegExp(`^orders/order-1/windows/${WIN}/.+\\.jpg$`),
    );
    expect(res.token).toBe("tok");
  });

  it("rejects a window the consultant does not own", async () => {
    state.window = { order_id: "order-1", consultant_id: "someone-else" };
    await expect(
      requestWindowPhotoUpload({
        windowId: WIN, mime: "image/jpeg", sizeBytes: 100, originalName: "x.jpg",
      }),
    ).rejects.toThrow("Forbidden");
    expect(state.storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an unknown window and a non-image type", async () => {
    state.window = null;
    await expect(
      requestWindowPhotoUpload({
        windowId: WIN, mime: "image/jpeg", sizeBytes: 100, originalName: "x.jpg",
      }),
    ).rejects.toThrow("Window not found");
    await expect(
      requestWindowPhotoUpload({
        windowId: WIN, mime: "application/pdf", sizeBytes: 100, originalName: "x.pdf",
      }),
    ).rejects.toThrow("Unsupported file type");
  });
});

describe("confirmWindowPhotoUpload", () => {
  const confirm = (over: Record<string, unknown> = {}) =>
    confirmWindowPhotoUpload({
      windowId: WIN,
      path: goodPath,
      mime: "image/jpeg",
      sizeBytes: 120_000,
      originalName: "detail.jpg",
      ...over,
    });

  it("verifies the object exists, then records the photo once", async () => {
    state.storage.list.mockResolvedValueOnce({
      data: [{ name: "file-1.jpg", metadata: { size: 120_000, mimetype: "image/jpeg" } }],
      error: null,
    });

    const first = await confirm();
    expect(first.photoId).toBe("photo-1");
    expect(state.photos.has(goodPath)).toBe(true);

    // A retried confirm after a lost response returns the same row — no
    // duplicate insert, no second storage verification.
    state.storage.list.mockClear();
    const second = await confirm();
    expect(second).toEqual(first);
    expect(state.storage.list).not.toHaveBeenCalled();
    expect(state.photos.size).toBe(1);
  });

  it("denies a window owned by another consultant", async () => {
    state.window = { order_id: "order-1", consultant_id: "someone-else" };
    await expect(confirm()).rejects.toThrow("Forbidden");
  });

  it("rejects a path outside the window's folder", async () => {
    await expect(
      confirm({ path: "orders/order-1/windows/other-window/file-1.jpg" }),
    ).rejects.toThrow("Upload path does not match window");
    await expect(
      confirm({ path: "orders/order-2/windows/" + WIN + "/file-1.jpg" }),
    ).rejects.toThrow("Upload path does not match window");
  });

  it("rejects a path whose extension contradicts the declared type", async () => {
    await expect(
      confirm({ path: `orders/order-1/windows/${WIN}/file-1.png` }),
    ).rejects.toThrow("Upload path does not match window");
  });

  it("requires an exact filename match — a fuzzy list hit is not the upload", async () => {
    state.storage.list.mockResolvedValueOnce({
      data: [{ name: "file-1-thumb.jpg", metadata: { size: 120_000 } }],
      error: null,
    });
    await expect(confirm()).rejects.toThrow("Upload not found");
    expect(state.photos.size).toBe(0);
  });

  it("rejects stored metadata that disagrees with the request", async () => {
    state.storage.list.mockResolvedValueOnce({
      data: [{ name: "file-1.jpg", metadata: { size: 999, mimetype: "image/jpeg" } }],
      error: null,
    });
    await expect(confirm()).rejects.toThrow("does not match the requested size");
  });

  it("adopts the racing confirm's row when the insert loses on conflict", async () => {
    // The other request's confirm commits between our existing-check and our
    // insert: list() seeds the row mid-flight, our insert no-ops, and the
    // re-select returns THEIR id — the lost-response path.
    state.storage.list.mockImplementationOnce(async () => {
      state.photos.set(goodPath, { id: "photo-race" });
      return {
        data: [{ name: "file-1.jpg", metadata: { size: 120_000, mimetype: "image/jpeg" } }],
        error: null,
      };
    });

    const res = await confirm();
    expect(res.photoId).toBe("photo-race");
    expect(state.photos.size).toBe(1);
  });
});

describe("deleteWindowPhoto", () => {
  it("removes the row then the object for the owner", async () => {
    state.photos.set(goodPath, { id: "photo-1" });
    // deleteWindowPhoto resolves the row through a join — the fake returns the
    // window's consultant for window_photos too, which is the owner here.
    await deleteWindowPhoto("photo-1");
    expect(state.storage.remove).toHaveBeenCalledWith([goodPath]);
  });
});

describe("cleanupOrphanWindowUpload", () => {
  it("removes an upload that never got confirmed", async () => {
    await cleanupOrphanWindowUpload({ windowId: WIN, path: goodPath });
    expect(state.storage.remove).toHaveBeenCalledWith([goodPath]);
  });

  it("refuses to remove a path a confirmed row already owns", async () => {
    state.photos.set(goodPath, { id: "photo-1" });
    await expect(
      cleanupOrphanWindowUpload({ windowId: WIN, path: goodPath }),
    ).rejects.toThrow("already saved to the order");
    expect(state.storage.remove).not.toHaveBeenCalled();
  });

  it("refuses a path outside the window's folder", async () => {
    await expect(
      cleanupOrphanWindowUpload({
        windowId: WIN,
        path: "orders/order-9/windows/other/file.jpg",
      }),
    ).rejects.toThrow("Cleanup path does not match window");
  });
});
