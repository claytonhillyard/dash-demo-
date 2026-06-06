// @vitest-environment node
//
// SLICE-4C RACE RESOLUTION SENTINEL (repurposed in slice 4c)
// ----------------------------------------------------------
// Slice 4 armed this sentinel to detect the moment slice 4c shipped
// membership-mutation helpers. Slice 4c lands them — and chooses the
// FOR UPDATE transaction + ON CONFLICT idempotent insert mitigation per
// spec §11.1. The assertions below LOCK IN the chosen mitigation so a
// future refactor cannot silently regress it.
//
// If a maintainer rips out the FOR UPDATE clause or the ON CONFLICT
// clause without consciously redesigning, this test fails and forces
// the same "choose a mitigation" conversation that slice 4's sentinel
// forced. Do NOT delete or weaken these assertions to "fix" a failure;
// re-do the design.
//
// See: docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md §11.1

import { describe, it, expect } from "vitest";

describe("slice-4c race resolution sentinel — locks in the chosen mitigation", () => {
  it("membership-mutations module exists and exports addOrgToCircle + removeOrgFromCircle", async () => {
    const modulePath = ["@/lib/circles", "membership-mutations"].join("/");
    const mod = await import(/* @vite-ignore */ modulePath);
    expect(typeof (mod as Record<string, unknown>).addOrgToCircle).toBe("function");
    expect(typeof (mod as Record<string, unknown>).removeOrgFromCircle).toBe("function");
  });

  it("acceptInvitation closes the check-then-insert race with FOR UPDATE inside a transaction", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/actions.ts"),
      "utf8",
    );
    expect(src).toMatch(/FOR\s+UPDATE/i);
    expect(src).toMatch(/\.transaction\s*\(/);
  });

  it("circle_members INSERT goes through ON CONFLICT (circle_id, org_id) DO NOTHING", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const actions = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/actions.ts"),
      "utf8",
    );
    const mutations = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/membership-mutations.ts"),
      "utf8",
    );
    // At least one of the two files must contain the canonical ON CONFLICT
    // clause. (Both do in practice — actions.ts inlines it in the accept
    // transaction; membership-mutations.ts exports it as addOrgToCircle.)
    const combined = actions + "\n" + mutations;
    expect(combined).toMatch(/ON\s+CONFLICT\s*\(\s*circle_id\s*,\s*org_id\s*\)\s+DO\s+NOTHING/i);
  });
});
