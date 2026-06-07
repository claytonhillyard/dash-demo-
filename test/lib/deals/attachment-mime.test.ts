import { describe, it, expect } from "vitest";
import { detectKindFromBytes } from "@/lib/deals/attachmentMime";

function bytesOf(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("detectKindFromBytes — magic byte signatures", () => {
  it("accepts a JPEG header as an image", () => {
    expect(detectKindFromBytes(bytesOf("FF D8 FF E0 00 10 4A 46 49 46 00 01"))).toEqual({
      kind: "image", mime: "image/jpeg",
    });
  });

  it("accepts a PNG header as an image", () => {
    expect(detectKindFromBytes(bytesOf("89 50 4E 47 0D 0A 1A 0A 00 00 00 0D"))).toEqual({
      kind: "image", mime: "image/png",
    });
  });

  it("accepts a WebP header as an image", () => {
    expect(detectKindFromBytes(bytesOf("52 49 46 46 24 00 00 00 57 45 42 50"))).toEqual({
      kind: "image", mime: "image/webp",
    });
  });

  it("accepts a PDF header as a cert", () => {
    expect(detectKindFromBytes(bytesOf("25 50 44 46 2D 31 2E 34 0A 25 D0 D4"))).toEqual({
      kind: "cert", mime: "application/pdf",
    });
  });

  it("rejects a buffer shorter than 12 bytes", () => {
    expect(detectKindFromBytes(bytesOf("FF D8"))).toBeNull();
  });

  it("rejects random binary garbage", () => {
    expect(detectKindFromBytes(bytesOf("AA BB CC DD EE FF 11 22 33 44 55 66"))).toBeNull();
  });

  it("rejects a RIFF header that is NOT a WebP", () => {
    expect(detectKindFromBytes(bytesOf("52 49 46 46 24 00 00 00 41 56 49 20"))).toBeNull(); // AVI
  });
});
