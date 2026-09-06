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

export type PendingUploaderPhoto = {
  id: string;
  file: File;
  previewUrl: string;
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

/** Upload and persist one room photo after its room has a database id. */
export async function uploadRoomPhotoFile(
  roomId: string,
  file: File,
): Promise<void> {
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

  const { default: imageCompression } =
    await import("browser-image-compression");
  const compressed = await imageCompression(toUpload, {
    maxSizeMB: 2,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
  });

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
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

  try {
    await confirmRoomPhotoUpload({
      roomId,
      path,
      mime: compressedFile.type || "image/jpeg",
      sizeBytes: compressedFile.size,
      originalName: file.name,
    });
  } catch (confirmErr) {
    try {
      await cleanupOrphanUpload({ roomId, path });
    } catch {
      // Best effort: the server logs storage cleanup failures.
    }
    throw confirmErr;
  }
}

export function PhotoUploader({ roomId, photos }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await uploadRoomPhotoFile(roomId, file);

      toast.success("Photo saved automatically");
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
        toast.success("Photo deleted automatically");
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

type PendingProps = {
  photos: PendingUploaderPhoto[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (photoId: string) => void;
};

/** Local previews for a new room; the parent uploads them after order save. */
export function PendingPhotoUploader({
  photos,
  disabled = false,
  onAdd,
  onRemove,
}: PendingProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  function handlePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) onAdd(files);
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded border border-slate-200 bg-slate-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.previewUrl}
              alt={photo.file.name}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(photo.id)}
              disabled={disabled}
              aria-label={`Remove ${photo.file.name}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-sm leading-none text-slate-600 shadow hover:text-red-600 disabled:opacity-50"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          className="aspect-square rounded border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-teal-500 hover:text-teal-600 disabled:opacity-50"
        >
          <span className="block text-2xl leading-none">+</span>
          <span className="mt-1 block text-[10px]">Add photos</span>
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Ready to upload when you save changes.
      </p>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="hidden"
        onChange={handlePicked}
      />
    </div>
  );
}
