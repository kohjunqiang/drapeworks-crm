import "server-only";

import { cache } from "react";

import { adminClient } from "@/lib/supabase/admin";

export const COMPLETION_PHOTO_BUCKET = "completion-photos";
const TTL_SECONDS = 3600;

export const signCompletionPhotoUrls = cache(
  async (paths: string[]): Promise<Map<string, string>> => {
    if (paths.length === 0) return new Map();
    const { data, error } = await adminClient()
      .storage.from(COMPLETION_PHOTO_BUCKET)
      .createSignedUrls(paths, TTL_SECONDS);
    if (error) throw new Error(error.message);
    const urls = new Map<string, string>();
    for (const row of data) {
      if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    }
    return urls;
  },
);
