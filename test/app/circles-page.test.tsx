// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
  DEMO_ORG_ID: 1,
}));
vi.mock("@/db/client", async () => {
  const real = await vi.importActual<typeof import("@/db/client")>("@/db/client");
  return {
    ...real,
    ensureDbReady: vi.fn(async () => (globalThis as { __testDb?: unknown }).__testDb),
  };
});
// TODO(slice-4c review): next/navigation's useRouter throws under
// renderToString because the app-router context isn't mounted. The plan's
// shape-only RSC test wraps client components that call useRouter, so we
// stub the navigation module here. A future polish slice could split the
// shape-only data assertions from the client-component render path.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/circles",
  useSearchParams: () => new URLSearchParams(),
}));

import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import type { Db } from "@/db/client";
import CirclesPage from "@/app/(admin)/circles/page";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  (globalThis as { __testDb?: unknown }).__testDb = db;
});
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

describe("CirclesPage RSC", () => {
  it("AIYA owner perspective: renders owned circle + outbox invite + create form", async () => {
    const [c] = await db.insert(circles)
      .values({ name: "Trusted", slug: "trusted", ownerOrgId: 1 })
      .returning();
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "argyle-mining",
      token: "tok-x", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const html = renderToString(await CirclesPage());
    expect(html).toContain("Trusted");
    expect(html).toContain("argyle-mining"); // outbox row
    expect(html).toContain("Create a circle"); // create form heading
    expect(html).toContain("Invite"); // invite button per circle
    expect(html).not.toContain("circles-empty-helper"); // page is non-empty
  });

  it("no-circles org perspective: renders the empty-state helper", async () => {
    const { getCurrentOrgId } = await import("@/lib/auth/getCurrentOrgId");
    (getCurrentOrgId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(888);

    const html = renderToString(await CirclesPage());
    // TODO(slice-4c review): renderToString HTML-encodes the apostrophe in
    // "You're" to "&#x27;", so the plan's exact string ("You're not in any
    // circles yet") never matches. The substring check below is faithful to
    // the intent (empty-state helper visible) without depending on the
    // server-side encoding of the apostrophe.
    expect(html).toContain("not in any circles yet");
    expect(html).toContain("circles-empty-helper");
  });
});
