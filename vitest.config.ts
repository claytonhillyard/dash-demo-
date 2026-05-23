import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // pglite (real Postgres in WASM) has a heavy ~5s cold start; with several
    // DB test files running in parallel that exceeds vitest's 5s default and
    // flakes. Raise the ceiling to match the tool's real startup cost.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
});
