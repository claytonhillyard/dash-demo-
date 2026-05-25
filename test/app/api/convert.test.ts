import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/convert/route";

afterEach(() => vi.unstubAllGlobals());

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

describe("/api/convert", () => {
  it("returns the currency list when no from/to is given", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ USD: "United States Dollar", INR: "Indian Rupee" }),
    } as Response));
    const res = await GET(req("/api/convert"));
    const body = await res.json();
    expect(body.currencies.INR).toBe("Indian Rupee");
  });

  it("returns a conversion when from/to/amount are given", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ rates: { INR: 83200 } }),
    } as Response));
    const res = await GET(req("/api/convert?from=USD&to=INR&amount=1000"));
    const body = await res.json();
    expect(body.result).toBe(83200);
    expect(body.freshness).toBe("delayed");
  });
});
