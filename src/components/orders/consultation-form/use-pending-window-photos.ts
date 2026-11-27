"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  uploadWindowPhotoFile,
  type PendingUploaderPhoto,
} from "@/components/orders/photo-uploader";

// Detail photos picked before the window has a database id. Keyed by the
// window's form-local `client_key` (validation/order.ts), which travels with
// the window's own form values so identity survives add/remove/draft-restore
// the same way the values themselves do. The server stamps the real window id
// on save; `upload` resolves keys through a caller-built key→id map.
type PendingByWindow = Record<string, PendingUploaderPhoto[]>;

export function usePendingWindowPhotos() {
  const [byWindow, setByWindow] = useState<PendingByWindow>({});
  const latest = useRef(byWindow);
  const hasPending = Object.values(byWindow).some(
    (photos) => photos.length > 0,
  );

  useEffect(() => {
    if (!hasPending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasPending]);

  useEffect(() => {
    latest.current = byWindow;
  }, [byWindow]);

  useEffect(
    () => () => {
      for (const photos of Object.values(latest.current)) {
        for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
      }
    },
    [],
  );

  const add = useCallback((windowKey: string, files: File[]) => {
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setByWindow((current) => ({
      ...current,
      [windowKey]: [...(current[windowKey] ?? []), ...additions],
    }));
  }, []);

  const remove = useCallback((windowKey: string, photoId: string) => {
    setByWindow((current) => {
      const removed = current[windowKey]?.find(
        (photo) => photo.id === photoId,
      );
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const remaining = (current[windowKey] ?? []).filter(
        (photo) => photo.id !== photoId,
      );
      const next = { ...current };
      if (remaining.length > 0) next[windowKey] = remaining;
      else delete next[windowKey];
      return next;
    });
  }, []);

  /** Drop every photo belonging to the given window keys (window/room removed). */
  const discardKeys = useCallback((windowKeys: string[]) => {
    setByWindow((current) => {
      const next = { ...current };
      for (const key of windowKeys) {
        for (const photo of next[key] ?? []) {
          URL.revokeObjectURL(photo.previewUrl);
        }
        delete next[key];
      }
      return next;
    });
  }, []);

  const upload = useCallback(
    async (keyToWindowId: ReadonlyMap<string, string>): Promise<number> => {
      const failed: PendingByWindow = {};
      let failureCount = 0;

      for (const [windowKey, photos] of Object.entries(latest.current)) {
        const windowId = keyToWindowId.get(windowKey);
        // A window removed before save simply has no id; its photos go too.
        if (!windowId) {
          for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
          continue;
        }
        for (const photo of photos) {
          try {
            await uploadWindowPhotoFile(windowId, photo.file);
            URL.revokeObjectURL(photo.previewUrl);
          } catch {
            failureCount += 1;
            failed[windowKey] = [...(failed[windowKey] ?? []), photo];
          }
        }
      }

      setByWindow(failed);
      return failureCount;
    },
    [],
  );

  return {
    byWindow,
    hasPending,
    add,
    remove,
    discardKeys,
    upload,
  };
}
