import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NegotiationStats } from "@/lib/negotiation/compute";
import { formatCentsExact } from "@/lib/company/format";

vi.mock("@/lib/ai/generateAiText", () => ({ generateAiText: vi.fn() }));

import { generateAiText } from "@/lib/ai/generateAiText";
import { buildCoachPrompt, simulatedCoaching, generateCoaching } from "@/lib/negotiation/coach";

function makeCoached(overrides: Partial<Extract<NegotiationStats, { kind: "coached" }>> = {}): NegotiationStats {
  return {
    kind: "coached",
    partnerLabel: "Mehta Diamonds",
    closes: 3,
    decidedDeals: 3,
    winRatePct: 100,
    avgUpliftCents: 98_333,
    avgRounds: 2.3,
    medianDaysToDecide: 2,
    currentBestCents: 1_230_000,
    askCents: 1_240_000,
    suggestedCounterCents: 1_328_333,
    ...overrides,
  };
}

function makeInsufficient(
  overrides: Partial<Extract<NegotiationStats, { kind: "insufficient_history" }>> = {},
): NegotiationStats {
  return {
    kind: "insufficient_history",
    partnerLabel: "Saint-Cloud Atelier",
    closes: 0,
    currentBestCents: null,
    askCents: 8_950_000,
    ...overrides,
  };
}

describe("buildCoachPrompt", () => {
  it("system message is a terse, plain-spoken coach that forbids invented numbers", () => {
    const { system } = buildCoachPrompt(makeCoached());
    expect(system.toLowerCase()).toContain("coach");
    expect(system.toLowerCase()).toContain("invent");
    expect(system).not.toContain("!");
  });

  it("prompt carries the partner label, formatted dollars, and the suggested counter (coached)", () => {
    const stats = makeCoached();
    const { prompt } = buildCoachPrompt(stats);
    expect(prompt).toContain(stats.partnerLabel);
    expect(prompt).toContain(formatCentsExact(stats.askCents));
    if (stats.kind === "coached") {
      expect(prompt).toContain(formatCentsExact(stats.suggestedCounterCents));
      expect(prompt).toContain(formatCentsExact(stats.avgUpliftCents));
    }
  });

  it("prompt carries whatever IS known for insufficient_history (label, closes, ask)", () => {
    const stats = makeInsufficient();
    const { prompt } = buildCoachPrompt(stats);
    expect(prompt).toContain(stats.partnerLabel);
    expect(prompt).toContain(String(stats.closes));
    expect(prompt).toContain(formatCentsExact(stats.askCents));
  });

  it("reports 'no pending bid' honestly rather than a fabricated figure when currentBestCents is null", () => {
    const { prompt } = buildCoachPrompt(makeInsufficient({ currentBestCents: null }));
    expect(prompt.toLowerCase()).toContain("no pending bid");
  });

  it("never contains an '@' in system or prompt for either stats kind — label + aggregates only", () => {
    for (const stats of [makeCoached(), makeInsufficient()]) {
      const { system, prompt } = buildCoachPrompt(stats);
      expect(system).not.toContain("@");
      expect(prompt).not.toContain("@");
    }
  });
});

describe("simulatedCoaching", () => {
  it("is deterministic — same input produces the same output", () => {
    const stats = makeCoached();
    expect(simulatedCoaching(stats)).toBe(simulatedCoaching(stats));
    const insufficient = makeInsufficient();
    expect(simulatedCoaching(insufficient)).toBe(simulatedCoaching(insufficient));
  });

  it("mentions the partner label and at least one formatted dollar figure", () => {
    const text = simulatedCoaching(makeCoached());
    expect(text).toContain("Mehta Diamonds");
    expect(text).toMatch(/\$[\d,]+\.\d{2}/);
  });

  it("renders 2-3 non-empty lines", () => {
    for (const stats of [makeCoached(), makeInsufficient()]) {
      const lines = simulatedCoaching(stats)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(3);
    }
  });

  it("the insufficient_history kind produces different copy than coached for the same partner/ask", () => {
    const coached = makeCoached({ partnerLabel: "Shared Partner", askCents: 500_000 });
    const insufficient = makeInsufficient({
      partnerLabel: "Shared Partner",
      askCents: 500_000,
      closes: 1,
    });
    expect(simulatedCoaching(coached)).not.toBe(simulatedCoaching(insufficient));
  });

  it("varies meaningfully across different coached inputs (not a static template)", () => {
    const a = simulatedCoaching(makeCoached({ winRatePct: 100 }));
    const b = simulatedCoaching(makeCoached({ winRatePct: 40 }));
    expect(a).not.toBe(b);
  });

  it("phrases a negative avgUpliftCents as conceding, not a raw negative dollar figure", () => {
    const text = simulatedCoaching(makeCoached({ avgUpliftCents: -50_000 }));
    expect(text.toLowerCase()).toContain("conceding");
    expect(text).not.toContain("-$500.00");
  });
});

describe("generateCoaching", () => {
  beforeEach(() => {
    vi.mocked(generateAiText).mockReset();
  });

  it("calls the seam with the negotiation-coach feature, fast tier, 300 max tokens, and org-tagged user", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "Line one.\nLine two.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    await generateCoaching(makeCoached(), 42);

    expect(generateAiText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateAiText).mock.calls[0]![0];
    expect(call.feature).toBe("negotiation-coach");
    expect(call.tier).toBe("fast");
    expect(call.maxOutputTokens).toBe(300);
    expect(call.user).toBe("org:42");
    expect(typeof call.system).toBe("string");
    expect(typeof call.prompt).toBe("string");
  });

  it("treats an ok-but-empty model response as a failure instead of producing a blank card (review N3)", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "   \n  \n ",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });
    const res = await generateCoaching(makeCoached(), 1);
    expect(res.ok).toBe(false);
  });

  it("real (non-simulated) success splits the text into trimmed, non-empty lines, capped at 4", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "  Line one.  \nLine two.\n\nLine three.\nLine four.\nLine five.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    const res = await generateCoaching(makeCoached(), 1);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(false);
      expect(res.lines).toEqual(["Line one.", "Line two.", "Line three.", "Line four."]);
    }
  });

  it("simulated success IGNORES the seam's canned text and substitutes simulatedCoaching(stats)", async () => {
    const stats = makeCoached();
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "[simulated] Here is a concise take on: totally canned seam text.",
      model: "simulated",
      simulated: true,
      durationMs: 1,
    });

    const res = await generateCoaching(stats, 1);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(true);
      const joined = res.lines.join(" ");
      expect(joined).not.toContain("canned seam text");
      expect(joined).not.toContain("[simulated]");
      const expectedLines = simulatedCoaching(stats)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      expect(res.lines).toEqual(expectedLines);
    }
  });

  it("simulated substitution also applies to the insufficient_history kind", async () => {
    const stats = makeInsufficient();
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "[simulated] canned seam text",
      model: "simulated",
      simulated: true,
      durationMs: 1,
    });

    const res = await generateCoaching(stats, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines.join(" ")).not.toContain("canned seam text");
    }
  });

  it.each(["rate_limited", "budget_exceeded", "unavailable", "error"] as const)(
    "maps seam error code %s to a friendly, non-empty message",
    async (code) => {
      vi.mocked(generateAiText).mockResolvedValueOnce({ ok: false, error: code, durationMs: 3 });

      const res = await generateCoaching(makeCoached(), 1);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.length).toBeGreaterThan(0);
        expect(res.error).not.toBe(code); // never leaks the raw machine code
      }
    },
  );

  it("maps every seam error code to a DISTINCT friendly message", async () => {
    const codes = ["rate_limited", "budget_exceeded", "unavailable", "error"] as const;
    const messages: string[] = [];
    for (const code of codes) {
      vi.mocked(generateAiText).mockResolvedValueOnce({ ok: false, error: code, durationMs: 3 });
      const res = await generateCoaching(makeCoached(), 1);
      expect(res.ok).toBe(false);
      if (!res.ok) messages.push(res.error);
    }
    expect(new Set(messages).size).toBe(codes.length);
  });

  it("never throws, even when the seam itself rejects unexpectedly", async () => {
    vi.mocked(generateAiText).mockRejectedValueOnce(new Error("boom"));

    await expect(generateCoaching(makeCoached(), 1)).resolves.toMatchObject({ ok: false });
  });
});
