import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DraftingContext } from "@/lib/drafting/context";
import type { DraftingPrefs } from "@/db/drafting";

vi.mock("@/lib/ai/generateAiText", () => ({ generateAiText: vi.fn() }));

import { generateAiText } from "@/lib/ai/generateAiText";
import {
  DRAFT_INTENTS,
  buildDraftPrompt,
  parseDraft,
  simulatedDraft,
  generateDraftCore,
} from "@/lib/drafting/generate";

function makeCtx(overrides: Partial<DraftingContext> = {}): DraftingContext {
  return {
    customerName: "Yuki Tanaka",
    businessName: "Ginza Pearl House",
    styleNote: null,
    hasEmail: true,
    healthBand: "healthy",
    outstandingBalanceCents: 0,
    lastInvoice: null,
    lastPaymentDate: null,
    recentActivity: [],
    ...overrides,
  };
}

const PREFS: DraftingPrefs = { tone: "Warm, concise, plain language", signature: "— AIYA Designs" };

describe("DRAFT_INTENTS", () => {
  it("is exactly the three spec'd intents", () => {
    expect(DRAFT_INTENTS).toEqual(["follow_up", "payment_reminder", "thank_you"]);
  });
});

describe("buildDraftPrompt", () => {
  it("includes the customer name, tone, style note, instruction, and balance in dollars", () => {
    const ctx = makeCtx({ styleNote: "Prefers concise, no small talk", outstandingBalanceCents: 150_000 });
    const { prompt } = buildDraftPrompt(ctx, PREFS, "follow_up", "Mention the new spring collection");
    expect(prompt).toContain("Yuki Tanaka");
    expect(prompt).toContain("Warm, concise, plain language");
    expect(prompt).toContain("Prefers concise, no small talk");
    expect(prompt).toContain("Mention the new spring collection");
    expect(prompt).toContain("$1,500.00");
  });

  it("omits the instruction line entirely when none is given", () => {
    const { prompt } = buildDraftPrompt(makeCtx(), PREFS, "follow_up");
    expect(prompt).not.toContain("Additional instruction");
  });

  it("falls back to a default tone description when prefs is null", () => {
    const { prompt } = buildDraftPrompt(makeCtx(), null, "follow_up");
    expect(prompt.toLowerCase()).toContain("no preference set");
  });

  it("system message demands the SUBJECT:/BODY: output contract", () => {
    const { system } = buildDraftPrompt(makeCtx(), null, "thank_you");
    expect(system).toContain("SUBJECT:");
    expect(system).toContain("BODY:");
  });

  it("never contains an '@' in system or prompt — DraftingContext has no email field to leak", () => {
    const ctx = makeCtx({
      styleNote: "Loves personal touches",
      recentActivity: ["Invoice sent", "Payment received"],
    });
    const { system, prompt } = buildDraftPrompt(ctx, PREFS, "payment_reminder", "Be gentle about it");
    expect(system).not.toContain("@");
    expect(prompt).not.toContain("@");
  });
});

describe("parseDraft", () => {
  it("parses a well-formed SUBJECT:/BODY: response", () => {
    const text = "SUBJECT: Following up on your order\n\nBODY:\nHi Yuki,\n\nJust checking in.\n";
    expect(parseDraft(text)).toEqual({
      subject: "Following up on your order",
      body: "Hi Yuki,\n\nJust checking in.",
    });
  });

  it("falls back to a generic subject when no SUBJECT: line is present", () => {
    const result = parseDraft("BODY:\nHi there, just checking in.");
    expect(result?.subject).toBe("Following up");
    expect(result?.body).toBe("Hi there, just checking in.");
  });

  it("uses the entire remaining text as the body when no BODY: marker is present", () => {
    const text = "SUBJECT: Quick question\n\nHi Yuki, do you have a moment this week?";
    const result = parseDraft(text);
    expect(result?.subject).toBe("Quick question");
    expect(result?.body).toBe("Hi Yuki, do you have a moment this week?");
  });

  it("trims extra whitespace around both the subject and the body", () => {
    const text = "   SUBJECT:   Hello there   \n\nBODY:   \n\n   Body line one.   \n";
    const result = parseDraft(text);
    expect(result?.subject).toBe("Hello there");
    expect(result?.body).toBe("Body line one.");
  });

  it("a multi-line 'subject' only keeps the first line", () => {
    const text =
      "SUBJECT: First line of the subject\nSecond line was not part of it\n\nBODY:\nThe body.";
    const result = parseDraft(text);
    expect(result?.subject).toBe("First line of the subject");
  });

  it("caps an overly long subject at 200 characters", () => {
    const text = `SUBJECT: ${"x".repeat(250)}\n\nBODY:\nSome body text.`;
    const result = parseDraft(text);
    expect(result?.subject.length).toBe(200);
  });

  it("is case-insensitive about the SUBJECT:/BODY: markers", () => {
    const result = parseDraft("subject: lowercase works too\n\nbody:\nHello.");
    expect(result?.subject).toBe("lowercase works too");
    expect(result?.body).toBe("Hello.");
  });

  it("returns null for a completely empty response", () => {
    expect(parseDraft("")).toBeNull();
  });

  it("returns null for a subject-only response with nothing left for a body", () => {
    expect(parseDraft("SUBJECT: Just a subject, nothing else")).toBeNull();
  });
});

describe("simulatedDraft", () => {
  it("is deterministic — same input produces the same output", () => {
    const ctx = makeCtx({ outstandingBalanceCents: 50_000 });
    expect(simulatedDraft(ctx, "follow_up", PREFS)).toEqual(simulatedDraft(ctx, "follow_up", PREFS));
  });

  it("varies by intent — the three intents produce different subjects and bodies", () => {
    const ctx = makeCtx({
      outstandingBalanceCents: 50_000,
      lastInvoice: { number: "INV-1", totalCents: 50_000, status: "issued", issueDate: "2026-07-01" },
    });
    const drafts = DRAFT_INTENTS.map((intent) => simulatedDraft(ctx, intent, PREFS));
    expect(new Set(drafts.map((d) => d.subject)).size).toBe(3);
    expect(new Set(drafts.map((d) => d.body)).size).toBe(3);
  });

  it("never includes the org's signature — that is applied only at send time", () => {
    const prefsWithSig: DraftingPrefs = { tone: null, signature: "— Clayton, AIYA Designs" };
    const draft = simulatedDraft(makeCtx(), "thank_you", prefsWithSig);
    expect(draft.body).not.toContain("Clayton, AIYA Designs");
    expect(draft.subject).not.toContain("Clayton, AIYA Designs");
  });

  it("grounds the draft in the outstanding balance and last-invoice numbers when present", () => {
    const ctx = makeCtx({
      outstandingBalanceCents: 12_345,
      lastInvoice: { number: "INV-2026-0007", totalCents: 200_000, status: "issued", issueDate: "2026-07-01" },
    });
    const draft = simulatedDraft(ctx, "payment_reminder", PREFS);
    expect(draft.body).toContain("$123.45");
    expect(draft.body).toContain("INV-2026-0007");
    expect(draft.subject).toContain("INV-2026-0007");
  });
});

describe("generateDraftCore", () => {
  beforeEach(() => {
    vi.mocked(generateAiText).mockReset();
  });

  it("calls the seam with feature 'drafting', fast tier, org-tagged user, and maxOutputTokens 700", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "SUBJECT: Hi\n\nBODY:\nHello there.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    await generateDraftCore(makeCtx(), PREFS, "follow_up", undefined, 42);

    expect(generateAiText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateAiText).mock.calls[0]![0];
    expect(call.feature).toBe("drafting");
    expect(call.tier).toBe("fast");
    expect(call.user).toBe("org:42");
    expect(call.maxOutputTokens).toBe(700);
  });

  it("threads the optional instruction through to the prompt", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "SUBJECT: x\n\nBODY:\ny",
      model: "m",
      simulated: false,
      durationMs: 1,
    });
    await generateDraftCore(makeCtx(), PREFS, "follow_up", "Mention the trade show", 1);
    const call = vi.mocked(generateAiText).mock.calls[0]![0];
    expect(call.prompt).toContain("Mention the trade show");
  });

  it("simulated success IGNORES the seam's canned text and substitutes simulatedDraft(ctx, intent, prefs)", async () => {
    const ctx = makeCtx({ outstandingBalanceCents: 10_000 });
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "totally canned seam placeholder text",
      model: "simulated",
      simulated: true,
      durationMs: 1,
    });

    const res = await generateDraftCore(ctx, PREFS, "thank_you", undefined, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(true);
      const expected = simulatedDraft(ctx, "thank_you", PREFS);
      expect(res.subject).toBe(expected.subject);
      expect(res.body).toBe(expected.body);
      expect(res.body).not.toContain("canned seam placeholder");
    }
  });

  it("real (non-simulated) success parses the seam's text via parseDraft", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "SUBJECT: Real subject\n\nBODY:\nReal body text.",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    const res = await generateDraftCore(makeCtx(), PREFS, "follow_up", undefined, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.simulated).toBe(false);
      expect(res.subject).toBe("Real subject");
      expect(res.body).toBe("Real body text.");
    }
  });

  it("treats an ok-but-unparseable (empty-body) response as a failure, not a blank draft", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: "SUBJECT: Only a subject, nothing else",
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });

    const res = await generateDraftCore(makeCtx(), PREFS, "follow_up", undefined, 1);
    expect(res.ok).toBe(false);
  });

  it.each(["rate_limited", "budget_exceeded", "unavailable", "error"] as const)(
    "maps seam error code %s to a friendly, non-raw message",
    async (code) => {
      vi.mocked(generateAiText).mockResolvedValueOnce({ ok: false, error: code, durationMs: 3 });
      const res = await generateDraftCore(makeCtx(), PREFS, "follow_up", undefined, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.length).toBeGreaterThan(0);
        expect(res.error).not.toBe(code);
      }
    },
  );

  it("never throws, even when the seam itself rejects unexpectedly", async () => {
    vi.mocked(generateAiText).mockRejectedValueOnce(new Error("boom"));
    await expect(
      generateDraftCore(makeCtx(), PREFS, "follow_up", undefined, 1),
    ).resolves.toMatchObject({ ok: false });
  });
});
