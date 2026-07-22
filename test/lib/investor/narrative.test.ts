import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvestorKpis } from "@/lib/investor/collect";
import type { RunwayResult } from "@/lib/runway/compute";

vi.mock("@/lib/ai/generateAiText", () => ({ generateAiText: vi.fn() }));

import { generateAiText } from "@/lib/ai/generateAiText";
import { buildInvestorPrompt, simulatedNarrative, generateInvestorNarrative } from "@/lib/investor/narrative";

function makeKpis(overrides: Partial<InvestorKpis> = {}): InvestorKpis {
  return {
    periodLabel: "July 2026",
    orgName: "Acme Studio",
    revenue: {
      months: [
        { ym: "2026-07", cents: 500_000 },
        { ym: "2026-06", cents: 420_000 },
      ],
      latestCents: 500_000,
    },
    profit: {
      months: [
        { ym: "2026-07", cents: 80_000 },
        { ym: "2026-06", cents: 60_000 },
      ],
      latestCents: 80_000,
    },
    receivables: { totalCents: 150_000, count: 3, overdueCents: 40_000 },
    runway: { kind: "cash_positive", avgMonthlyProfitCents: 70_000 },
    invoicing: { issuedCount: 5, issuedCents: 300_000, collectedCents: 250_000 },
    customers: { total: 12, healthMix: { healthy: 8, watch: 3, at_risk: 1 } },
    ...overrides,
  };
}

const BURNING_RUNWAY: RunwayResult = {
  kind: "burning",
  avgMonthlyBurnCents: 100_000,
  monthsOfRunwayFromReceivables: 4.2,
};
const INSUFFICIENT_RUNWAY: RunwayResult = { kind: "insufficient_history", monthsAvailable: 1 };

describe("buildInvestorPrompt", () => {
  it("system message asks for three short, factual, non-hype, bullet-free paragraphs", () => {
    const { system } = buildInvestorPrompt(makeKpis());
    expect(system.toLowerCase()).toContain("three");
    expect(system.toLowerCase()).toContain("paragraph");
    expect(system.toLowerCase()).not.toContain("bullet points"); // instructs AGAINST bullets, doesn't ask for them
  });

  it("prompt contains formatted dollar figures for revenue and profit", () => {
    const { prompt } = buildInvestorPrompt(makeKpis());
    expect(prompt).toContain("$5,000.00");
    expect(prompt).toContain("$800.00");
  });

  it.each([
    [BURNING_RUNWAY, "burning ~4.2 months"],
    [{ kind: "cash_positive", avgMonthlyProfitCents: 70_000 } satisfies RunwayResult, "cash-positive"],
    [INSUFFICIENT_RUNWAY, "insufficient history"],
  ])("spells out the runway verdict for %o", (runway, expectedSubstring) => {
    const { prompt } = buildInvestorPrompt(makeKpis({ runway }));
    expect(prompt).toContain(expectedSubstring);
  });

  it("mentions the health mix when present, and omits it when null", () => {
    const withMix = buildInvestorPrompt(makeKpis()).prompt;
    expect(withMix).toMatch(/8.*healthy/i);

    const withoutMix = buildInvestorPrompt(
      makeKpis({ customers: { total: 4, healthMix: null } }),
    ).prompt;
    expect(withoutMix).not.toMatch(/healthy/i);
  });

  it("never contains an '@' in system or prompt — aggregates only, no PII surface", () => {
    const { system, prompt } = buildInvestorPrompt(makeKpis());
    expect(system).not.toContain("@");
    expect(prompt).not.toContain("@");
  });
});

describe("simulatedNarrative", () => {
  it("is deterministic — same input produces the same output", () => {
    const kpis = makeKpis();
    expect(simulatedNarrative(kpis)).toBe(simulatedNarrative(kpis));
  });

  it("mentions the period label and at least one formatted dollar figure", () => {
    const text = simulatedNarrative(makeKpis());
    expect(text).toContain("July 2026");
    expect(text).toMatch(/\$[\d,]+\.\d{2}/);
  });

  it("renders exactly three blank-line-separated paragraphs", () => {
    const text = simulatedNarrative(makeKpis());
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
    expect(paragraphs).toHaveLength(3);
  });

  it("differs across meaningfully different inputs (not a static template)", () => {
    const a = simulatedNarrative(makeKpis({ periodLabel: "July 2026" }));
    const b = simulatedNarrative(makeKpis({ periodLabel: "August 2026" }));
    expect(a).not.toBe(b);
  });
});

describe("generateInvestorNarrative", () => {
  beforeEach(() => {
    vi.mocked(generateAiText).mockReset();
  });

  it("calls the seam with the investor-update feature, fast tier, and org-tagged user", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    await generateInvestorNarrative(makeKpis(), 42);

    expect(generateAiText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateAiText).mock.calls[0]![0];
    expect(call.feature).toBe("investor-update");
    expect(call.tier).toBe("fast");
    expect(call.user).toBe("org:42");
    expect(typeof call.system).toBe("string");
    expect(typeof call.prompt).toBe("string");
  });

  it("real (non-simulated) success splits the text into trimmed, non-empty paragraphs", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "  Paragraph one.  \n\nParagraph two.\n\nParagraph three.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    const res = await generateInvestorNarrative(makeKpis(), 1);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(false);
      expect(res.paragraphs).toEqual(["Paragraph one.", "Paragraph two.", "Paragraph three."]);
    }
  });

  it("splits across multiple consecutive blank lines and caps at 5 paragraphs", async () => {
    const sixParagraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n\n\n");
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: sixParagraphs,
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    const res = await generateInvestorNarrative(makeKpis(), 1);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.paragraphs).toHaveLength(5);
      expect(res.paragraphs[0]).toBe("Paragraph 1.");
      expect(res.paragraphs[4]).toBe("Paragraph 5.");
    }
  });

  it("simulated success IGNORES the seam's canned text and substitutes simulatedNarrative(kpis)", async () => {
    const kpis = makeKpis();
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "[simulated] Here is a concise take on: totally canned seam text.",
      model: "simulated",
      simulated: true,
      durationMs: 1,
    });

    const res = await generateInvestorNarrative(kpis, 1);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(true);
      const joined = res.paragraphs.join(" ");
      expect(joined).not.toContain("canned seam text");
      expect(joined).not.toContain("[simulated]");
      const expectedParagraphs = simulatedNarrative(kpis)
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      expect(res.paragraphs).toEqual(expectedParagraphs);
    }
  });

  it.each(["rate_limited", "budget_exceeded", "unavailable", "error"] as const)(
    "maps seam error code %s to a friendly, non-empty message",
    async (code) => {
      vi.mocked(generateAiText).mockResolvedValueOnce({ ok: false, error: code, durationMs: 3 });

      const res = await generateInvestorNarrative(makeKpis(), 1);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.length).toBeGreaterThan(0);
        expect(res.error).not.toBe(code); // never leaks the raw machine code
      }
    },
  );

  it("never throws, even when the seam itself rejects unexpectedly", async () => {
    vi.mocked(generateAiText).mockRejectedValueOnce(new Error("boom"));

    await expect(generateInvestorNarrative(makeKpis(), 1)).resolves.toMatchObject({ ok: false });
  });
});
