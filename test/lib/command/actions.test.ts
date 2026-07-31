// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

// Mock the Sentry SDK BEFORE importing the action, same
// mocked-Sentry-to-globalThis technique as
// test/lib/activity/recordActivitySafely.test.ts — adapted to the direct
// `captureException(error, {tags, extra})` call shape this action (and its
// draftEmail precedent, src/lib/drafting/actions.ts) actually uses, rather
// than that file's `withScope` shape.
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown, options?: { tags?: Record<string, unknown>; extra?: unknown }) => {
    (globalThis as Record<string, unknown>).__lastSentryError = e;
    (globalThis as Record<string, unknown>).__lastSentryTags = options?.tags;
    (globalThis as Record<string, unknown>).__lastSentryExtra = options?.extra;
  },
}));

// Partial mock of the registry: every export passes through unchanged
// EXCEPT runway's `run`, wrapped in a vi.fn() that calls the real
// implementation by default (so every test but the one throw-test below
// exercises the actual executor against the shared db) and can be
// overridden per-test to simulate an executor failure.
vi.mock("@/lib/command/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/command/registry")>();
  return {
    ...actual,
    COMMANDS: {
      ...actual.COMMANDS,
      runway: { ...actual.COMMANDS.runway, run: vi.fn(actual.COMMANDS.runway.run) },
    },
  };
});

// Partial mock of the router: passes through to the real routeCommand by
// default; overridden in exactly one test to hand runCommand a RoutedCommand
// with params that fail its own def's re-validation (spec §5's "defense in
// depth" re-validate step) — routeCommand's OWN two paths (rules + the AI
// parse defense) already make this unreachable in practice, so simulating it
// is the only way to exercise that branch at all.
vi.mock("@/lib/command/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/command/route")>();
  return { ...actual, routeCommand: vi.fn(actual.routeCommand) };
});

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import * as schema from "@/db/schema";
import { runCommand, __setTestDb } from "@/lib/command/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { COMMANDS, HELP_RESULT } from "@/lib/command/registry";
import { routeCommand } from "@/lib/command/route";

/**
 * runCommand action tests (spec §5, §7 row 4, shared-db). `routeCommand`'s
 * own AI-parsing behavior is NOT re-tested here — that's route.test.ts's
 * job. No AI_GATEWAY_API_KEY is configured in this test environment (same
 * fact test/lib/drafting/actions.test.ts's own happy-path test documents),
 * so `generateAiText` itself always falls back to simulated here, which
 * means every test below (demo mode or not) is effectively rules-routed —
 * exactly what makes this file focused purely on the ACTION's own plumbing
 * (auth, validation, error handling), not the router's.
 */

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.mocked(requireSession).mockClear();
  vi.mocked(COMMANDS.runway.run).mockClear();
  vi.mocked(routeCommand).mockClear();
  (globalThis as Record<string, unknown>).__lastSentryError = undefined;
  (globalThis as Record<string, unknown>).__lastSentryTags = undefined;
  (globalThis as Record<string, unknown>).__lastSentryExtra = undefined;
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function insertCustomer(overrides: Partial<{ orgId: number; name: string }> = {}) {
  const [row] = await db
    .insert(schema.customers)
    .values({ orgId: overrides.orgId ?? 1, name: overrides.name ?? "Test Customer" })
    .returning();
  return row!;
}

async function insertSnapshot(overrides: {
  orgId?: number;
  customerId: number;
  band: "healthy" | "watch" | "at_risk";
  capturedOn: string;
}) {
  await db.insert(schema.customerHealthSnapshots).values({
    orgId: overrides.orgId ?? 1,
    customerId: overrides.customerId,
    score: 40,
    band: overrides.band,
    components: { recency: 10, frequency: 10, breadth: 10 },
    capturedOn: overrides.capturedOn,
  });
}

// ---------------------------------------------------------------------------
// demo mode — the deviation test (spec §9 lineage).
// ---------------------------------------------------------------------------

describe("runCommand — demo mode is NOT blocked (the deliberate deviation)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers from seed data, rules-routed, unlike every demo-guarded action in this codebase", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // Per the 35a-2 routing correction (route.test.ts), "who owes me money"
    // is rules-routed to unpaid_by_customer, whose demo seed data is
    // populated (Tanaka's balance, invoice 9302) — this is deliberately
    // NOT overdue_invoices, whose seed invoice isn't past due yet.
    const res = await runCommand({ question: "who owes me money" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("unpaid_by_customer");
    expect(res.result.kind).toBe("table");
    if (res.result.kind === "table") {
      expect(res.result.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.result)).toContain("Tanaka");
    }
  });
});

// ---------------------------------------------------------------------------
// authz / validation
// ---------------------------------------------------------------------------

describe("runCommand — authz and validation", () => {
  it("returns Unauthorized with no session", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("no session"));
    const res = await runCommand({ question: "how's my runway" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rejects a question over 300 characters", async () => {
    const res = await runCommand({ question: "x".repeat(301) });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toContain("question");
  });

  it("rejects an empty (whitespace-only) question", async () => {
    const res = await runCommand({ question: "    " });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executor throw -> friendly error + Sentry (tags only, no question).
// ---------------------------------------------------------------------------

describe("runCommand — an executor throw", () => {
  it("returns a friendly error and captures to Sentry WITHOUT the question text", async () => {
    vi.mocked(COMMANDS.runway.run).mockRejectedValueOnce(new Error("executor boom"));

    const question = "how's my runway SENTINEL_QUESTION_MARKER_xyz";
    const res = await runCommand({ question });
    expect(res).toEqual({ ok: false, error: "Couldn't run that — try again" });

    const tags = (globalThis as Record<string, unknown>).__lastSentryTags;
    const error = (globalThis as Record<string, unknown>).__lastSentryError;
    const extra = (globalThis as Record<string, unknown>).__lastSentryExtra;

    expect(error).toBeInstanceOf(Error);
    expect(tags).toMatchObject({ layer: "command-action", action: "runCommand", command: "runway" });

    const captured = JSON.stringify({ tags, extra, message: (error as Error).message });
    expect(captured).not.toContain("SENTINEL_QUESTION_MARKER_xyz");
    expect(captured).not.toContain(question);
  });
});

// ---------------------------------------------------------------------------
// re-validation of a poisoned RoutedCommand (defense in depth).
// ---------------------------------------------------------------------------

describe("runCommand — re-validates params from routeCommand (defense in depth)", () => {
  it("a RoutedCommand with Zod-invalid params degrades to the help result rather than crashing", async () => {
    vi.mocked(routeCommand).mockResolvedValueOnce({
      id: "customer_lookup",
      // query must be a string — this is deliberately the wrong type.
      params: { query: 12345 },
    });
    const res = await runCommand({ question: "whatever, routeCommand is mocked" });
    expect(res).toEqual({ ok: true, result: HELP_RESULT, command: "help" });
  });
});

// ---------------------------------------------------------------------------
// help routing wired all the way through.
// ---------------------------------------------------------------------------

describe("runCommand — an unroutable question", () => {
  it("returns ok:true with the help result and command:'help'", async () => {
    const res = await runCommand({ question: "zzxxqq flibberflobber" });
    expect(res).toEqual({ ok: true, result: HELP_RESULT, command: "help" });
  });
});

// ---------------------------------------------------------------------------
// happy path — two commands, end to end, non-demo.
// ---------------------------------------------------------------------------

describe("runCommand — happy path (non-demo, real db)", () => {
  it("runway: a stat result", async () => {
    const res = await runCommand({ question: "how's my runway" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("runway");
    expect(res.result.kind).toBe("stat");
  });

  it("at_risk_customers: a populated table result", async () => {
    const c = await insertCustomer({ name: "Drifting Customer" });
    await insertSnapshot({ customerId: c.id, band: "at_risk", capturedOn: "2026-07-01" });

    const res = await runCommand({ question: "show at-risk customers" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("at_risk_customers");
    expect(res.result.kind).toBe("table");
    if (res.result.kind === "table") {
      expect(res.result.rows.map((r) => r[0])).toEqual(["Drifting Customer"]);
      expect(res.result.links).toEqual([`/customers/${c.id}/edit`]);
    }
  });
});
