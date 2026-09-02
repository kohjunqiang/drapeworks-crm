"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  cleanupOrphanCompletionPhoto,
  confirmCompletionPhotoUpload,
  deleteCompletionPhoto,
  requestCompletionPhotoUpload,
} from "@/lib/actions/completion-photos";

export type CompletionPhoto = {
  id: string;
  signedUrl: string;
  originalName: string | null;
};

type Props = {
  orderId: string;
  photos: CompletionPhoto[];
  readOnly?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
};

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "image/heic" || file.type === "image/heif" ||
    name.endsWith(".heic") || name.endsWith(".heif");
}

async function preparePhoto(file: File): Promise<File> {
  let source = file;
  if (isHeic(file)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    source = new File(
      [blob],
      file.name.replace(/\.(heic|heif)$/i, ".jpg"),
      { type: "image/jpeg" },
    );
  }

  const { default: imageCompression } = await import("browser-image-compression");
  const compressed = await imageCompression(source, {
    maxSizeMB: 2,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
  });
  return compressed instanceof File
    ? compressed
    : new File([compressed], source.name, { type: source.type });
}

export function CompletionPhotoUploader({
  orderId,
  photos,
  readOnly = false,
  onUploadingChange,
}: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<CompletionPhoto[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const items = [...photos, ...added].filter(
    (photo, index, all) =>
      !removed.has(photo.id) &&
      all.findIndex((candidate) => candidate.id === photo.id) === index,
  );

  async function uploadOne(file: File): Promise<CompletionPhoto> {
    const prepared = await preparePhoto(file);
    const mime = prepared.type || "image/jpeg";
    const { path, signedUrl } = await requestCompletionPhotoUpload({
      orderId,
      mime,
      sizeBytes: prepared.size,
      originalName: file.name,
    });
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": mime, "x-upsert": "false" },
      body: prepared,
    });
    if (!response.ok) throw new Error(`Upload failed (${response.status})`);

    try {
      const { photoId } = await confirmCompletionPhotoUpload({
        orderId,
        path,
        mime,
        sizeBytes: prepared.size,
        originalName: file.name,
      });
      return {
        id: photoId,
        signedUrl: URL.createObjectURL(prepared),
        originalName: file.name,
      };
    } catch (error) {
      await cleanupOrphanCompletionPhoto({ orderId, path }).catch(() => undefined);
      throw error;
    }
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;
    setUploading(true);
    onUploadingChange?.(true);
    let uploaded = 0;
    try {
      for (const file of selected) {
        const photo = await uploadOne(file);
        setAdded((current) => [...current, photo]);
        uploaded += 1;
      }
      toast.success(`${uploaded} completed ${uploaded === 1 ? "photo" : "photos"} uploaded`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
      if (uploaded > 0) router.refresh();
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  function remove(photoId: string) {
    startTransition(async () => {
      try {
        await deleteCompletionPhoto(photoId);
        setRemoved((current) => new Set(current).add(photoId));
        setAdded((current) => current.filter((photo) => photo.id !== photoId));
        toast.success("Completed photo deleted");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Delete failed");
      }
    });
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && readOnly && (
        <p className="text-sm text-slate-500">No completed photos uploaded.</p>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((photo) => (
          <div
            key={photo.id}
            className="group relative aspect-square overflow-hidden rounded border border-slate-200 bg-slate-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.signedUrl}
              alt={photo.originalName ?? "Completed installation"}
              className="h-full w-full object-cover"
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => remove(photo.id)}
                aria-label="Remove completed photo"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-sm text-slate-600 shadow hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center rounded border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-teal-500 hover:text-teal-600 disabled:opacity-50"
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1 text-[10px]">{uploading ? "Uploading…" : "Add photos"}</span>
          </button>
        )}
      </div>
      {!readOnly && (
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={handlePicked}
        />
      )}
    </div>
  );
}
