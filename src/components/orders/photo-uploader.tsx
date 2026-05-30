"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  cleanupOrphanUpload,
  confirmRoomPhotoUpload,
  deleteRoomPhoto,
  requestRoomPhotoUpload,
} from "@/lib/actions/photos";

export type UploaderPhoto = {
  id: string;
  signedUrl: string;
  originalName: string | null;
};

type Props = {
  roomId: string;
  photos: UploaderPhoto[];
};

function isHeic(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const lower = file.name.toLowerCase();
  return lower.endsWith(".heic") || lower.endsWith(".heif");
}

export function PhotoUploader({ roomId, photos }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFile(file: File) {
    setUploading(true);
    try {
      let toUpload: File = file;

      if (isHeic(file)) {
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.85,
        });
        const blob = Array.isArray(converted) ? converted[0] : converted;
        toUpload = new File(
          [blob],
          file.name.replace(/\.(heic|heif)$/i, ".jpg"),
          { type: "image/jpeg" },
        );
      }

      const { default: imageCompression } = await import(
        "browser-image-compression"
      );
      const compressed = await imageCompression(toUpload, {
        maxSizeMB: 2,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      });

      // Ensure we have a File (compression returns Blob).
      const compressedFile =
        compressed instanceof File
          ? compressed
          : new File([compressed], toUpload.name, { type: toUpload.type });

      const { path, signedUrl } = await requestRoomPhotoUpload({
        roomId,
        mime: compressedFile.type || "image/jpeg",
        sizeBytes: compressedFile.size,
        originalName: file.name,
      });

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": compressedFile.type || "application/octet-stream",
          "x-upsert": "false",
        },
        body: compressedFile,
      });
      if (!putRes.ok) {
        // PUT itself failed → no orphan to sweep.
        throw new Error(`Upload failed (${putRes.status})`);
      }

      try {
        await confirmRoomPhotoUpload({
          roomId,
          path,
          mime: compressedFile.type || "image/jpeg",
          sizeBytes: compressedFile.size,
          originalName: file.name,
        });
      } catch (confirmErr) {
        // PUT succeeded but the DB row never landed. Remove the orphan
        // before bubbling the error up.
        try {
          await cleanupOrphanUpload({ roomId, path });
        } catch {
          // ignore — server logs the failure
        }
        throw confirmErr;
      }

      toast.success("Photo uploaded");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void handleFile(file);
  }

  function handleDelete(photoId: string) {
    startTransition(async () => {
      try {
        await deleteRoomPhoto(photoId);
        toast.success("Photo deleted");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {photos.map((p) => (
          <div
            key={p.id}
            className="relative aspect-square bg-slate-100 rounded border border-slate-200 overflow-hidden group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.signedUrl}
              alt={p.originalName ?? "Room photo"}
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => handleDelete(p.id)}
              aria-label="Remove photo"
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-slate-600 hover:text-red-600 text-sm leading-none flex items-center justify-center shadow"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="aspect-square border-2 border-dashed border-slate-300 rounded flex flex-col items-center justify-center text-slate-400 hover:border-teal-500 hover:text-teal-600 disabled:opacity-50 transition-colors"
        >
          {uploading ? (
            <span className="text-[10px]">Uploading…</span>
          ) : (
            <>
              <span className="text-2xl leading-none">+</span>
              <span className="text-[10px] mt-1">Add photo</span>
            </>
          )}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="hidden"
        onChange={handlePicked}
      />
    </div>
  );
}
