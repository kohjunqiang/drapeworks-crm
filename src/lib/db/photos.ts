import "server-only";

import { cache } from "react";

import { adminClient } from "@/lib/supabase/admin";

const BUCKET = "room-photos";
const TTL_SECONDS = 3600;

export const signRoomPhotoUrls = cache(
  async (paths: string[]): Promise<Map<string, string>> => {
    if (paths.length === 0) return new Map();
    const admin = adminClient();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(paths, TTL_SECONDS);
    if (error) throw new Error(error.message);
    const out = new Map<string, string>();
    for (const row of data) {
      if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
    }
    return out;
  },
);
