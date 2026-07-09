import { describe, expect, it } from "vitest";

import {
  assertCurtainTypePhotoAllowed,
  buildCurtainTypePhotoPath,
  curtainTypePhotoExt,
} from "./curtain-type-photo";

describe("curtainTypePhotoExt", () => {
  it("maps png and webp to their own extension", () => {
    expect(curtainTypePhotoExt("image/png")).toBe("png");
    expect(curtainTypePhotoExt("image/webp")).toBe("webp");
  });

  it("falls back to jpg for jpeg and anything else", () => {
    expect(curtainTypePhotoExt("image/jpeg")).toBe("jpg");
    expect(curtainTypePhotoExt("image/jpg")).toBe("jpg");
    expect(curtainTypePhotoExt("application/octet-stream")).toBe("jpg");
  });
});

describe("buildCurtainTypePhotoPath", () => {
  it("nests the file under curtain-types/<id>/ with a mime-derived ext", () => {
    const path = buildCurtainTypePhotoPath(
      "550e8400-e29b-41d4-a716-446655440000",
      "image/png",
      "abcdef",
    );
    expect(path).toBe(
      "curtain-types/550e8400-e29b-41d4-a716-446655440000/abcdef.png",
    );
  });
});

describe("assertCurtainTypePhotoAllowed", () => {
  it("passes for an allowed mime within the size limit", () => {
    expect(() =>
      assertCurtainTypePhotoAllowed("image/jpeg", 1024),
    ).not.toThrow();
  });

  it("rejects an unsupported mime", () => {
    expect(() =>
      assertCurtainTypePhotoAllowed("image/gif", 1024),
    ).toThrow(/Unsupported file type/);
  });

  it("rejects a file over the size limit", () => {
    expect(() =>
      assertCurtainTypePhotoAllowed("image/jpeg", 11 * 1024 * 1024),
    ).toThrow(/too large/i);
  });
});
