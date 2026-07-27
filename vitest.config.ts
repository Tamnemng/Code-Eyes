import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    // Fixtures are source material read as text by the analyzer - never imported,
    // never executed, and intentionally contain odd/invalid-ish code.
    exclude: ["**/node_modules/**", "**/__tests__/fixtures/**"],
  },
});
