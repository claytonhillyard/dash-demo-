import { describe, it, expect } from "vitest";
import { suggestInvoiceNumber } from "@/lib/invoices/numbering";

describe("suggestInvoiceNumber", () => {
  it("suggests 0001 for an empty list", () => {
    expect(suggestInvoiceNumber([], 2026)).toBe("INV-2026-0001");
  });

  it("suggests max+1, 4-padded", () => {
    expect(
      suggestInvoiceNumber(["INV-2026-0001", "INV-2026-0005", "INV-2026-0003"], 2026),
    ).toBe("INV-2026-0006");
  });

  it("ignores numbers from a different year (year partition)", () => {
    expect(suggestInvoiceNumber(["INV-2025-0099", "INV-2027-0002"], 2026)).toBe(
      "INV-2026-0001",
    );
  });

  it("ignores non-matching formats", () => {
    expect(
      suggestInvoiceNumber(
        ["garbage", "INV-2026-abc", "invoice-2026-0001", "INV-2026-"],
        2026,
      ),
    ).toBe("INV-2026-0001");
  });

  it("grows naturally past 9999 without re-padding to 4 digits", () => {
    expect(suggestInvoiceNumber(["INV-2026-9999"], 2026)).toBe("INV-2026-10000");
  });

  it("mixes matching and non-matching numbers, using only the matching max", () => {
    expect(
      suggestInvoiceNumber(["INV-2026-0002", "not-a-number", "INV-2025-9000"], 2026),
    ).toBe("INV-2026-0003");
  });

  it("is unaffected by insertion order (max wins regardless of position)", () => {
    expect(
      suggestInvoiceNumber(["INV-2026-0009", "INV-2026-0001", "INV-2026-0004"], 2026),
    ).toBe("INV-2026-0010");
  });
});
