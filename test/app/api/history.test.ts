import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/history/route";

afterEach(() => vi.unstubAllGlobals());

describe("/api/history", () => {
  it("returns a series for the requested symbol and range", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ prices: [[1, 100], [2, 101]] }),
    } as Response));
    const res = await GET(new Request("http://localhost/api/history?symbol=BTC&range=1M"));
    const body = await res.json();
    expect(body.symbol).toBe("BTC");
    expect(body.points).toEqual([100, 101]);
  });
});
