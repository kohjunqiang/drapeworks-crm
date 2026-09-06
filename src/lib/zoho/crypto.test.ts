import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  process.env.ZOHO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("Zoho token encryption", () => {
  it("round-trips with authenticated associated data", async () => {
    const { decryptZohoToken, encryptZohoToken } = await import("./crypto");
    const encrypted = encryptZohoToken("refresh-secret", "deployment-a");
    expect(encrypted.ciphertext).not.toContain("refresh-secret");
    expect(decryptZohoToken(encrypted, "deployment-a")).toBe("refresh-secret");
  });

  it("rejects a token copied to another deployment", async () => {
    const { decryptZohoToken, encryptZohoToken } = await import("./crypto");
    const encrypted = encryptZohoToken("refresh-secret", "deployment-a");
    expect(() => decryptZohoToken(encrypted, "deployment-b")).toThrow();
  });

  it("rejects a malformed encryption key", async () => {
    process.env.ZOHO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(12).toString("base64");
    const { encryptZohoToken } = await import("./crypto");
    expect(() => encryptZohoToken("refresh-secret", "deployment-a")).toThrow("32-byte");
  });
});
