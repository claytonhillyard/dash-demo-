// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildAlertEmail } from "@/lib/watchlists/buildAlertEmail";
import type { RecordActivityInput } from "@/lib/activity/types";

const NOW = new Date("2026-07-05T12:00:00.000Z");

function event(overrides: Partial<RecordActivityInput> = {}): RecordActivityInput {
  return {
    orgId: 1,
    actor: "boss",
    entityType: "customer",
    entityId: 2201,
    verb: "updated",
    summary: "Updated customer Acme Corp",
    payload: null,
    ...overrides,
  };
}

describe("buildAlertEmail", () => {
  it("returns the expected shape", () => {
    const result = buildAlertEmail(event(), NOW);
    expect(result).toEqual({
      subject: expect.any(String),
      text: expect.any(String),
    });
  });

  it("builds the subject as '[iDesign] Activity: <summary>'", () => {
    const result = buildAlertEmail(event({ summary: "Updated customer Acme Corp" }), NOW);
    expect(result.subject).toBe("[iDesign] Activity: Updated customer Acme Corp");
  });

  it("text includes the summary line", () => {
    const result = buildAlertEmail(event({ summary: "Updated customer Acme Corp" }), NOW);
    expect(result.text).toContain("Updated customer Acme Corp");
  });

  it("text includes 'by <actor>' when actor is set", () => {
    const result = buildAlertEmail(event({ actor: "boss" }), NOW);
    expect(result.text).toContain("by boss");
  });

  it("text includes 'by system' when actor is null", () => {
    const result = buildAlertEmail(event({ actor: null }), NOW);
    expect(result.text).toContain("by system");
  });

  describe("entity path mapping", () => {
    it("maps customer → /customers/<id>/edit", () => {
      const result = buildAlertEmail(
        event({ entityType: "customer", entityId: 2201 }),
        NOW,
      );
      expect(result.text).toContain("/customers/2201/edit");
    });

    it("maps deal → /deals", () => {
      const result = buildAlertEmail(event({ entityType: "deal", entityId: 55 }), NOW);
      expect(result.text).toContain("/deals");
      // Must not fall through to the generic /activity path.
      expect(result.text).not.toContain("/activity");
    });

    it("maps any other entity type → /activity", () => {
      const result = buildAlertEmail(
        event({ entityType: "inventory_item", entityId: 7 }),
        NOW,
      );
      expect(result.text).toContain("/activity");
    });

    it("maps circle → /activity (generic fallback)", () => {
      const result = buildAlertEmail(event({ entityType: "circle", entityId: 3 }), NOW);
      expect(result.text).toContain("/activity");
    });
  });

  describe("subject truncation", () => {
    it("truncates a long summary so the subject stays at or under 200 chars, with an ellipsis", () => {
      const longSummary = "x".repeat(300);
      const result = buildAlertEmail(event({ summary: longSummary }), NOW);
      expect(result.subject.length).toBeLessThanOrEqual(200);
      expect(result.subject.endsWith("...")).toBe(true);
      expect(result.subject.startsWith("[iDesign] Activity: ")).toBe(true);
    });

    it("does not truncate when the subject is exactly at the 200-char boundary", () => {
      // "[iDesign] Activity: " is 21 chars; pad summary so total is exactly 200.
      const prefix = "[iDesign] Activity: ";
      const summary = "y".repeat(200 - prefix.length);
      const result = buildAlertEmail(event({ summary }), NOW);
      expect(result.subject.length).toBe(200);
      expect(result.subject.endsWith("...")).toBe(false);
    });

    it("truncates when the subject is exactly 1 char over the 200-char boundary", () => {
      const prefix = "[iDesign] Activity: ";
      const summary = "y".repeat(200 - prefix.length + 1);
      const result = buildAlertEmail(event({ summary }), NOW);
      expect(result.subject.length).toBeLessThanOrEqual(200);
      expect(result.subject.endsWith("...")).toBe(true);
    });

    it("never exceeds 200 chars for a maximally long allowed summary (240 chars)", () => {
      // ACTIVITY_SUMMARY_MAX_LEN is 240 — the widest legal input.
      const summary = "z".repeat(240);
      const result = buildAlertEmail(event({ summary }), NOW);
      expect(result.subject.length).toBeLessThanOrEqual(200);
    });
  });

  describe("determinism", () => {
    it("returns identical output for identical input + now", () => {
      const e = event();
      const a = buildAlertEmail(e, NOW);
      const b = buildAlertEmail(e, NOW);
      expect(a).toEqual(b);
    });

    it("is a pure function of its inputs (no hidden global state / Date.now() reliance)", () => {
      const e = event();
      const a = buildAlertEmail(e, NOW);
      // Different `now` should not change text unless the implementation
      // chooses to render date info — subject/summary/actor/path content
      // must remain stable regardless.
      const later = new Date(NOW.getTime() + 1000 * 60 * 60 * 24);
      const b = buildAlertEmail(e, later);
      expect(b.subject).toBe(a.subject);
    });
  });
});
