// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Route files may only export GET/POST/dynamic/etc. (Next.js validates route
// exports at build time — no test seam allowed), so we mock the route's data
// dependencies instead of injecting a db.
vi.mock("@/db/client", () => ({ ensureDbReady: vi.fn(async () => ({})) }));
vi.mock("@/db/diamonds", () => ({ getDiamondTrend: vi.fn(async () => [700000, 720000]) }));
vi.mock("@/lib/auth/getCurrentOrgId", () => ({ getCurrentOrgId: vi.fn(async () => 1) }));

import { GET } from "@/app/api/diamond-history/route";
import { getDiamondTrend } from "@/db/diamonds";

describe("/api/diamond-history", () => {
  it("returns the natural index series", async () => {
    const res = await GET(new Request("http://localhost/api/diamond-history"));
    const body = await res.json();
    expect(body.points).toEqual([700000, 720000]);
  });

  it("passes the session orgId to getDiamondTrend", async () => {
    await GET(new Request("http://localhost/api/diamond-history"));
    expect(getDiamondTrend).toHaveBeenCalledWith(expect.anything(), "natural_index", 1);
  });
});
