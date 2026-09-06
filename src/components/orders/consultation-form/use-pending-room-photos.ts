"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  uploadRoomPhotoFile,
  type PendingUploaderPhoto,
} from "@/components/orders/photo-uploader";

type PendingByRoom = Record<string, PendingUploaderPhoto[]>;

export function usePendingRoomPhotos() {
  const [byRoom, setByRoom] = useState<PendingByRoom>({});
  const latest = useRef(byRoom);

  useEffect(() => {
    latest.current = byRoom;
  }, [byRoom]);

  useEffect(
    () => () => {
      for (const photos of Object.values(latest.current)) {
        for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
      }
    },
    [],
  );

  const add = useCallback((roomKey: string, files: File[]) => {
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setByRoom((current) => ({
      ...current,
      [roomKey]: [...(current[roomKey] ?? []), ...additions],
    }));
  }, []);

  const remove = useCallback((roomKey: string, photoId: string) => {
    setByRoom((current) => {
      const removed = current[roomKey]?.find((photo) => photo.id === photoId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const remaining = (current[roomKey] ?? []).filter(
        (photo) => photo.id !== photoId,
      );
      const next = { ...current };
      if (remaining.length > 0) next[roomKey] = remaining;
      else delete next[roomKey];
      return next;
    });
  }, []);

  const discardRoom = useCallback((roomKey: string) => {
    setByRoom((current) => {
      for (const photo of current[roomKey] ?? []) {
        URL.revokeObjectURL(photo.previewUrl);
      }
      const next = { ...current };
      delete next[roomKey];
      return next;
    });
  }, []);

  const upload = useCallback(
    async (roomKeys: string[], roomIds: string[]): Promise<number> => {
      const failed: PendingByRoom = {};
      let failureCount = 0;

      for (let index = 0; index < roomKeys.length; index++) {
        const roomKey = roomKeys[index];
        const roomId = roomIds[index];
        for (const photo of latest.current[roomKey] ?? []) {
          try {
            await uploadRoomPhotoFile(roomId, photo.file);
            URL.revokeObjectURL(photo.previewUrl);
          } catch {
            failureCount += 1;
            failed[roomKey] = [...(failed[roomKey] ?? []), photo];
          }
        }
      }

      setByRoom(failed);
      return failureCount;
    },
    [],
  );

  return {
    byRoom,
    hasPending: Object.values(byRoom).some((photos) => photos.length > 0),
    add,
    remove,
    discardRoom,
    upload,
  };
}
