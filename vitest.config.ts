import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests target pure logic (Zod schemas, path/value helpers) — a plain
// node environment is enough; no jsdom/React setup by design.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
