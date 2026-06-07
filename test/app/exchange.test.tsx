// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/inventory", () => ({
  getSharedInventoryForOrg: vi.fn(async () => []),
}));
vi.mock("@/lib/circles/queries", () => ({
  getCircleNamesForOrg: vi.fn(async () => new Map()),
}));

// Static import after the mocks so the page picks them up.
import ExchangePage from "@/app/(admin)/exchange/page";

beforeEach(() => { vi.clearAllMocks(); });

describe("/exchange RSC", () => {
  it("renders empty state when no items are shared", async () => {
    // TODO(slice-15 review): plan used JSON.stringify(node) which throws on
    // React trees (circular property 'default'). renderToString mirrors the
    // pattern in test/app/circles-page.test.tsx and faithfully covers the
    // intent.
    const html = renderToString(await ExchangePage());
    expect(html).toMatch(/No partner inventory shared/);
  });

  it("renders populated list", async () => {
    const { getSharedInventoryForOrg } = await import("@/db/inventory");
    const { getCircleNamesForOrg } = await import("@/lib/circles/queries");
    vi.mocked(getSharedInventoryForOrg).mockResolvedValueOnce([
      {
        id: 1, orgId: 501, ownerOrgLabel: "Mehta",
        category: "Diamonds", name: "Round 2.51ct demo",
        quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date(),
      },
    ] as never);
    vi.mocked(getCircleNamesForOrg).mockResolvedValueOnce(new Map([[201, "Trusted Partners"]]));
    const html = renderToString(await ExchangePage());
    expect(html).toMatch(/Round 2.51ct/);
    expect(html).toMatch(/Trusted Partners/);
  });
});
