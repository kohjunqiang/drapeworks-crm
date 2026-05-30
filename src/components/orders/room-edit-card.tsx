import type { RoomType } from "@/lib/db/schema";

import { PhotoUploader, type UploaderPhoto } from "./photo-uploader";

type Props = {
  roomId: string;
  label: string;
  type: RoomType;
  photos: UploaderPhoto[];
};

export function RoomEditCard({ roomId, label, type, photos }: Props) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          <div className="text-xs text-slate-500">{type}</div>
        </div>
        <span className="text-xs text-slate-500">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
        </span>
      </div>
      <PhotoUploader roomId={roomId} photos={photos} />
    </div>
  );
}
