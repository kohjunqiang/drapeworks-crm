"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  cleanupOrphanCurtainTypePhoto,
  confirmCurtainTypePhotoUpload,
  requestCurtainTypePhotoUpload,
  upsertCurtainType,
} from "@/lib/actions/curtain-types";
import {
  curtainTypeSchema,
  type CurtainTypeInput,
} from "@/lib/validation/curtain-type";

export type SeriesOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: SeriesOption[];
  defaultValues?: Partial<CurtainTypeInput>;
  photoUrl?: string | null;
  seriesIndex?: number | null; // shown read-only on edit (auto-assigned)
  // Day/Night is curtain sheerness, so the field is hidden entirely on the
  // Blinds tab and submitted as undefined. The server rejects the mismatched
  // combination either way — it is the only side that knows the series' line.
  productLine: "curtain" | "blind";
};

const BLANK: CurtainTypeInput = {
  isNew: true,
  label: "",
  category: undefined,
  series_id: "",
  page: undefined,
  photo_path: undefined,
  photo_mime: undefined,
};

function isHeic(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const lower = file.name.toLowerCase();
  return lower.endsWith(".heic") || lower.endsWith(".heif");
}

// Client-side HEIC→JPEG + compression, mirroring the room-photo uploader.
async function processImage(file: File): Promise<File> {
  let toUpload: File = file;
  if (isHeic(file)) {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    toUpload = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
      type: "image/jpeg",
    });
  }
  const { default: imageCompression } = await import(
    "browser-image-compression"
  );
  const compressed = await imageCompression(toUpload, {
    maxSizeMB: 2,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
  });
  return compressed instanceof File
    ? compressed
    : new File([compressed], toUpload.name, { type: toUpload.type });
}

async function uploadPhoto(curtainTypeId: string, file: File): Promise<void> {
  const processed = await processImage(file);
  const mime = processed.type || "image/jpeg";

  const { path, signedUrl } = await requestCurtainTypePhotoUpload({
    curtainTypeId,
    mime,
    sizeBytes: processed.size,
  });

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime, "x-upsert": "false" },
    body: processed,
  });
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

  try {
    await confirmCurtainTypePhotoUpload({ curtainTypeId, path, mime });
  } catch (confirmErr) {
    // PUT landed but the row update failed — remove the orphan object.
    try {
      await cleanupOrphanCurtainTypePhoto({ curtainTypeId, path });
    } catch {
      // ignore — the server logs the failure
    }
    throw confirmErr;
  }
}

export function CurtainTypeFormDialog({
  open,
  onOpenChange,
  series,
  defaultValues,
  photoUrl,
  seriesIndex,
  productLine,
}: Props) {
  const isBlind = productLine === "blind";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<CurtainTypeInput>({
    // The page field's Zod transform makes the resolver's output type diverge
    // slightly from the form field-values type. Same one-line cast the order
    // form uses; runtime behaviour is correct.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(curtainTypeSchema) as any,
    defaultValues: { ...BLANK, ...defaultValues },
  });

  // Reset the form when the dialog re-opens with different defaults (Add ⇄
  // Edit). form.reset isn't React state, so this is not a cascading render.
  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  // Clear the picked-file state when the dialog closes so the next open
  // starts clean (the subtree stays mounted, so local state would persist).
  function handleOpenChange(next: boolean) {
    if (!next) {
      if (localPreview) URL.revokeObjectURL(localPreview);
      setFile(null);
      setLocalPreview(null);
    }
    onOpenChange(next);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (localPreview) URL.revokeObjectURL(localPreview);
    setFile(picked);
    setLocalPreview(picked ? URL.createObjectURL(picked) : null);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        const { id } = await upsertCurtainType(values);
        if (file) await uploadPhoto(id, file);
        toast.success(isEdit ? "Curtain type updated" : "Curtain type added");
        handleOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  });

  const preview = localPreview ?? photoUrl ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit curtain type" : "Add curtain type"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                name="label"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Label</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Sheer Ivory" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!isBlind && (
              <FormField
                name="category"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="— Select —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Day">Day</SelectItem>
                          <SelectItem value="Night">Night</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                name="series_id"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Series</FormLabel>
                    <FormControl>
                      <Select
                        items={series.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a series" />
                        </SelectTrigger>
                        <SelectContent>
                          {series.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    {series.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        No series yet — add one via “Manage series”.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="page"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Page</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. P12"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isEdit && seriesIndex != null && (
              <p className="text-xs text-slate-500">
                Series index: <span className="font-medium">#{seriesIndex}</span>{" "}
                (auto-assigned)
              </p>
            )}

            <div>
              <FormLabel>Photo</FormLabel>
              <div className="mt-1 flex items-center gap-3">
                <div className="w-20 h-20 flex-shrink-0 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview}
                      alt="Curtain type"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400">No photo</span>
                  )}
                </div>
                <label className="text-sm text-teal-700 font-medium cursor-pointer hover:text-teal-800">
                  {preview ? "Change photo" : "Upload photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                    className="hidden"
                    onChange={onPickFile}
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
