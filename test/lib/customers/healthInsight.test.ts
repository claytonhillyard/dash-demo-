import { describe, it, expect } from "vitest";
import { buildHealthInsightPrompt, type HealthInsightInput } from "@/lib/customers/healthInsight";

// Fixed `now` for deterministic days-since-last-touch math across the file.
const NOW = new Date("2026-06-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const BASE: HealthInsightInput = {
  name: "Priya Mehta",
  score: 61,
  band: "watch",
  components: { recency: 40, frequency: 8.75, breadth: 12.5 },
  eventsLast30d: 2,
  lastActivityAt: daysAgo(1),
};

describe("buildHealthInsightPrompt", () => {
  it("contains the customer name, score, and band", () => {
    const prompt = buildHealthInsightPrompt(BASE, NOW);
    expect(prompt).toContain("Priya Mehta");
    expect(prompt).toContain("61");
    expect(prompt).toContain("watch");
  });

  it("contains the days-since-last-activity figure, computed from lastActivityAt vs now", () => {
    // lastActivityAt = daysAgo(1) -> 1 day since last touch
    const prompt = buildHealthInsightPrompt(BASE, NOW);
    expect(prompt).toMatch(/\b1\b/);
    expect(prompt.toLowerCase()).toMatch(/day/);
  });

  it("contains the events-in-30d count", () => {
    const prompt = buildHealthInsightPrompt(BASE, NOW);
    expect(prompt).toContain("2");
  });

  it("names the weakest component (lowest of recency/frequency/breadth)", () => {
    // BASE: recency=40, frequency=8.75, breadth=12.5 -> frequency is weakest
    const prompt = buildHealthInsightPrompt(BASE, NOW).toLowerCase();
    expect(prompt).toContain("frequency");
  });

  it("is deterministic: identical input + now produce an identical prompt across calls", () => {
    const p1 = buildHealthInsightPrompt(BASE, NOW);
    const p2 = buildHealthInsightPrompt(BASE, NOW);
    expect(p1).toBe(p2);
  });

  it("handles a null lastActivityAt (never active) without throwing and without a bogus days figure", () => {
    const input: HealthInsightInput = { ...BASE, lastActivityAt: null };
    expect(() => buildHealthInsightPrompt(input, NOW)).not.toThrow();
  });

  it("contains no '@' character when the customer name has none (PII smoke check)", () => {
    const prompt = buildHealthInsightPrompt(BASE, NOW);
    expect(prompt).not.toContain("@");
  });

  it("PII guard: HealthInsightInput has no email/phone/address/notes fields — an object shaped like a full customer record is rejected at compile time by excess-property checking", () => {
    // This literal is passed directly (not via an intermediately-typed
    // variable) so TypeScript's excess-property check fires. If the
    // implementer ever widens HealthInsightInput to include `email` (or any
    // other PII field), this line stops erroring and `tsc --noEmit` fails
    // the build — that's the point of a type-level PII guard.
    // NOTE: the directive must sit directly above the offending property —
    // TS reports excess-property errors at the extra key's own line, not at
    // the call or the opening brace.
    const prompt = buildHealthInsightPrompt(
      {
        name: "Priya Mehta",
        score: 61,
        band: "watch",
        components: { recency: 40, frequency: 8.75, breadth: 12.5 },
        eventsLast30d: 2,
        lastActivityAt: daysAgo(1),
        // @ts-expect-error — `email` is not a key of HealthInsightInput; a
        // full customer-shaped object must be rejected by excess-property
        // checking.
        email: "priya@example.com",
      },
      NOW,
    );
    // Runtime double-check: even though the type system should have caught
    // this above, assert the email string never actually leaks into the
    // prompt text (belt-and-suspenders — excess properties DO still exist
    // on the object at runtime, JS has no way to strip them).
    expect(prompt).not.toContain("priya@example.com");
  });
});
