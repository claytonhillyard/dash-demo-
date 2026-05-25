import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // Git worktrees live under .worktrees/ inside the repo and carry their own
    // copy of test/. Without this, the root run discovers and double-executes
    // every worktree's tests (and the extra pglite DB tests time out under the
    // capped worker pool). Keep vitest's defaults and add .worktrees.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    // pglite (real Postgres in WASM) has a heavy CPU-bound cold start. Booting
    // one instance per test across many parallel workers starves each other of
    // CPU, so a ~5s start balloons past any timeout. Cap worker concurrency so
    // only a couple of instances boot at once; keep a generous timeout as a
    // backstop. Reliability over raw speed.
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
});
