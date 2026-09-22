"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export type PhotoTile = {
  id: string;
  signedUrl: string;
  originalName: string | null;
};

type Props = {
  photos: PhotoTile[];
};

export function PhotoStrip({ photos }: Props) {
  const [lightbox, setLightbox] = useState<PhotoTile | null>(null);

  return (
    <div className="border-t border-slate-100 px-4 py-3 bg-white">
      <div className="text-xs font-medium text-slate-600 mb-2">
        Reference photos {photos.length > 0 && `(${photos.length})`}
      </div>
      {photos.length === 0 ? (
        <p className="text-xs text-slate-400">No photos uploaded.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightbox(p)}
              title="Click to enlarge"
              aria-label={`View ${p.originalName ?? "Room photo"}`}
              className="aspect-square rounded border border-slate-200 overflow-hidden bg-slate-100 block cursor-zoom-in transition hover:ring-2 hover:ring-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.signedUrl}
                alt={p.originalName ?? "Room photo"}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="px-4 py-3 text-sm font-medium text-slate-900 border-b border-slate-200">
            {lightbox?.originalName ?? "Room photo"}
          </DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.signedUrl}
              alt={lightbox.originalName ?? "Room photo"}
              className="block w-full h-auto max-h-[80vh] object-contain bg-slate-100"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
