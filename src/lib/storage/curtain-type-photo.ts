// Pure helpers for the curtain-type photo bucket. Kept free of "server-only"
// so they can be unit-tested and shared by the server action. Mirrors the
// room-photos conventions in actions/photos.ts.

export const CURTAIN_TYPE_PHOTO_BUCKET = "curtain-type-photos";

export const CURTAIN_TYPE_PHOTO_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const CURTAIN_TYPE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export function curtainTypePhotoExt(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

// Path convention: curtain-types/<curtain_type_id>/<random>.<ext>. The random
// segment is always a server-generated UUID — never a raw filename.
export function buildCurtainTypePhotoPath(
  curtainTypeId: string,
  mime: string,
  fileId: string,
): string {
  return `curtain-types/${curtainTypeId}/${fileId}.${curtainTypePhotoExt(mime)}`;
}

// Re-check bucket limits in the action (defence-in-depth; the bucket enforces
// them too). Throws a user-facing message on violation.
export function assertCurtainTypePhotoAllowed(
  mime: string,
  sizeBytes: number,
): void {
  if (!CURTAIN_TYPE_PHOTO_ALLOWED_MIME.has(mime)) {
    throw new Error("Unsupported file type");
  }
  if (sizeBytes > CURTAIN_TYPE_PHOTO_MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }
}
