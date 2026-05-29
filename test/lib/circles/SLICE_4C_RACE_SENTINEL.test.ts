// @vitest-environment node
//
// SLICE-4C RACE SENTINEL
// ----------------------
// This test asserts that no membership-mutation helpers exist in the
// codebase today. Slice 4 ships *no* API to add or remove circle members
// (memberships are seeded via SQL or the demo seed file). That means the
// "isOrgMemberOfCircle check → INSERT INTO deals" pattern in postDeal has
// no race window in slice 4 — there is no concurrent membership mutation
// that could invalidate the check between read and write.
//
// When slice 4c ("Circle Onboarding") ships, it will introduce
// addOrgToCircle / removeOrgFromCircle helpers. At that moment THIS TEST
// FAILS, and the slice-4c author MUST choose one of:
//   (a) accept the race and document the user-visible window in the
//       postDeal call site,
//   (b) re-check membership inside a transaction wrapping the INSERT,
//   (c) take a `SELECT … FOR UPDATE` lock on the membership row before
//       the check.
// Do NOT delete this test to "fix" the failure — the failure IS the
// obligation. Mark the chosen mitigation in postDeal + this sentinel's
// docblock, then update the test to assert the chosen mitigation exists.
//
// See: docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md §8.9

import { describe, it, expect } from "vitest";

describe("slice-4c race sentinel — fails when membership mutation lands", () => {
  it("there is no membership-mutation module (slice 4c has not landed yet)", async () => {
    // Vitest treats a failed import as a rejected promise. We use a
    // dynamic import wrapped in a try/catch so the assertion phrasing
    // is "module not found" regardless of bundler error shape.
    let modulePresent = false;
    try {
      const mod = await import("@/lib/circles/membership-mutations");
      // If the module exists, check whether it exports either of the
      // expected helper names — that's the actual slice-4c signal.
      modulePresent =
        typeof (mod as Record<string, unknown>).addOrgToCircle === "function" ||
        typeof (mod as Record<string, unknown>).removeOrgFromCircle === "function";
    } catch {
      modulePresent = false;
    }
    expect(
      modulePresent,
      [
        "Slice-4c membership-mutation helpers detected.",
        "The 'isOrgMemberOfCircle check → INSERT INTO deals' race in postDeal",
        "now has a real window. Choose a mitigation (transaction re-check,",
        "FOR UPDATE lock, or accepted-race documentation) and update both",
        "src/lib/deals/actions.ts::postDeal AND this sentinel before merging.",
        "See: docs/superpowers/specs/2026-05-28-aiya-circles-slice-4-design.md §8.9",
      ].join("\n"),
    ).toBe(false);
  });

  it("isOrgMemberOfCircle still does NOT use a transaction (slice-4 assumption)", async () => {
    // Lightweight code-shape assertion: the helper file does not import
    // 'transaction' or use a SELECT FOR UPDATE. If a future maintainer
    // adds either without updating this sentinel, the test forces a
    // conscious review.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/membership.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/FOR\s+UPDATE/i);
    expect(src).not.toMatch(/\btransaction\s*\(/);
  });
});
