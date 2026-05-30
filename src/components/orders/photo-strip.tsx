export type PhotoTile = {
  id: string;
  signedUrl: string;
  originalName: string | null;
};

type Props = {
  photos: PhotoTile[];
};

export function PhotoStrip({ photos }: Props) {
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
            <a
              key={p.id}
              href={p.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="aspect-square rounded border border-slate-200 overflow-hidden bg-slate-100 block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.signedUrl}
                alt={p.originalName ?? "Room photo"}
                className="w-full h-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
