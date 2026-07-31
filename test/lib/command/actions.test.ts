// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

// Slice 35b-2: confirmWriteCommand's happy-path test calls through to the
// REAL saveCustomerStyleNote (drafting/actions.ts), which — unlike anything
// runCommand's own read executors do — calls `revalidatePath` on success.
// Same mock as test/lib/command/writeRegistry.test.ts (and every other
// action-module test file that exercises a real write) for the identical
// "no Next.js request context in a Vitest run" reason.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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

// Partial mock of the WRITE registry (slice 35b-2): every export passes
// through unchanged EXCEPT add_customer_note's `execute`, wrapped in a
// vi.fn() that calls the real implementation (-> the real
// saveCustomerStyleNote, drafting/actions.ts) by default, and can be
// overridden in exactly one test (the Sentry-marker test below) to force an
// unexpected throw — `execute` on all 3 real delegates never actually
// throws in practice (each one's own `run()` wrapper swallows every failure
// into a returned `{ok:false,error}`), so simulating one is the only way to
// exercise confirmWriteCommand's own catch block at all. `.preview` is left
// completely real for every write command (only `.execute` is wrapped),
// same "one function wrapped, rest passes through" shape as the COMMANDS
// mock above.
vi.mock("@/lib/command/writeRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/command/writeRegistry")>();
  return {
    ...actual,
    WRITE_COMMANDS: {
      ...actual.WRITE_COMMANDS,
      add_customer_note: {
        ...actual.WRITE_COMMANDS.add_customer_note,
        execute: vi.fn(actual.WRITE_COMMANDS.add_customer_note.execute),
      },
    },
  };
});

import type { Db } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import * as schema from "@/db/schema";
import { runCommand, confirmWriteCommand, __setTestDb } from "@/lib/command/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { COMMANDS, HELP_RESULT } from "@/lib/command/registry";
import { routeCommand } from "@/lib/command/route";
import { WRITE_COMMANDS } from "@/lib/command/writeRegistry";
import { __setTestDb as setDraftingTestDb } from "@/lib/drafting/actions";
import { toUtcDay } from "@/lib/sentinel/capture";

/**
 * runCommand action tests (spec §5, §7 row 4, shared-db; extended by spec
 * §3.1/§3.2 in slice 35b-2 for the write branch + `confirmWriteCommand`).
 * `routeCommand`'s own AI-parsing behavior is NOT re-tested here — that's
 * route.test.ts's job. No AI_GATEWAY_API_KEY is configured in this test
 * environment (same fact test/lib/drafting/actions.test.ts's own happy-path
 * test documents), so `generateAiText` itself always falls back to
 * simulated here, which means every test below (demo mode or not) is
 * effectively rules-routed — exactly what makes this file focused purely on
 * the ACTION's own plumbing (auth, validation, error handling), not the
 * router's.
 *
 * Only `saveCustomerStyleNote`'s test-db seam (drafting/actions.ts) is
 * wired below, not payments'/invoices' — every `confirmWriteCommand` test
 * in this file uses `add_customer_note` as its one representative write
 * command (the simplest of the 3 delegates, needing no email seam), and the
 * runCommand-write-branch tests only ever reach `preview` (which takes `db`
 * as a plain argument, not via its own module-local seam — writeRegistry.ts's
 * signature), never `execute` — so record_payment's/send_invoice's own
 * delegates (recordPayment/sendInvoice) are never actually invoked here.
 * Full delegation coverage for ALL 3 commands' `execute` already lives in
 * test/lib/command/writeRegistry.test.ts; this file's job is proving
 * `runCommand`/`confirmWriteCommand`'s OWN plumbing around whichever write
 * command is in play, not re-proving each delegate's own behavior.
 */

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  await setDraftingTestDb(db);
});
beforeEach(async () => {
  vi.mocked(requireSession).mockClear();
  vi.mocked(COMMANDS.runway.run).mockClear();
  vi.mocked(routeCommand).mockClear();
  vi.mocked(WRITE_COMMANDS.add_customer_note.execute).mockClear();
  (globalThis as Record<string, unknown>).__lastSentryError = undefined;
  (globalThis as Record<string, unknown>).__lastSentryTags = undefined;
  (globalThis as Record<string, unknown>).__lastSentryExtra = undefined;
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await setDraftingTestDb(null);
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

// Slice 35b-2 fixtures — local to this file (house convention: mirror the
// sibling test's scaffold, test/lib/command/writeRegistry.test.ts, rather
// than import fixtures across test files).
let invoiceCounter = 0;

async function insertInvoice(overrides: {
  orgId?: number;
  customerId: number;
  invoiceNumber?: string;
  status?: "draft" | "issued" | "void";
  totalCents?: number;
}) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 100_000;
  const status = overrides.status ?? "issued";
  const [row] = await db
    .insert(schema.invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      invoiceNumber: overrides.invoiceNumber ?? `INV-ACT-${String(invoiceCounter).padStart(4, "0")}`,
      status,
      billTo: { name: "Test Customer" },
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: status === "draft" ? null : "2026-01-01",
    })
    .returning();
  return row!;
}

/** Every write-relevant table's row count — the "mutates nothing" proofs
 *  below compare this before/after a `runCommand` write-question call.
 *  Same idiom as writeRegistry.test.ts's identical helper. */
async function tableCounts() {
  const [customerRows, invoiceRows, paymentRows] = await Promise.all([
    db.select().from(schema.customers),
    db.select().from(schema.invoices),
    db.select().from(schema.payments),
  ]);
  return { customers: customerRows.length, invoices: invoiceRows.length, payments: paymentRows.length };
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

// ---------------------------------------------------------------------------
// Slice 35b-2 — runCommand's write branch (spec §3.1): preview only, ZERO
// mutation. `confirmWriteCommand` (further below) is the only function in
// this whole file — or this whole slice — that ever writes anything.
// ---------------------------------------------------------------------------

describe("runCommand — write branch (slice 35b-2): preview only, never mutates", () => {
  it("a write question returns a `confirm` result with preview()'s exact resolvedParams, and mutates nothing", async () => {
    const c = await insertCustomer({ name: "Priya Mehta" });
    const inv = await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-7001", totalCents: 100_000 });

    const before = await tableCounts();
    const res = await runCommand({ question: "record a $40 cash payment on INV-2026-7001" });
    const after = await tableCounts();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("record_payment");
    expect(res.result.kind).toBe("confirm");
    if (res.result.kind !== "confirm") throw new Error("unreachable");
    expect(res.result.commandId).toBe("record_payment");
    expect(res.result.resolvedParams).toEqual({
      invoiceId: inv.id,
      amountCents: 4_000,
      method: "cash",
      receivedDate: toUtcDay(new Date()),
    });
    expect(res.result.summary).toContain("INV-2026-7001");
    expect(res.result.details).toContainEqual(["Invoice", "INV-2026-7001"]);
    expect(res.result.warning).toBe("Records a payment against this invoice.");

    // The load-bearing assertion: previewing a write question is exactly as
    // read-only as answering any read question — nothing in the payments/
    // invoices/customers tables moved.
    expect(after).toEqual(before);
  });

  it("a write whose preview fails (record_payment on a draft invoice) returns ok:false with no confirm result", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, invoiceNumber: "INV-2026-7002", status: "draft" });

    const before = await tableCounts();
    const res = await runCommand({ question: "record a $10 payment on INV-2026-7002" });
    const after = await tableCounts();

    expect(res).toEqual({ ok: false, error: "Payments can only be recorded on issued invoices" });
    expect(after).toEqual(before);
  });

  it("a write question with nothing extractable (no invoice/amount) degrades to the help result (defense in depth)", async () => {
    const res = await runCommand({ question: "record a payment" });
    expect(res).toEqual({ ok: true, result: HELP_RESULT, command: "help" });
  });

  it("a read question still returns its normal (non-confirm) result, unaffected by the write branch", async () => {
    const res = await runCommand({ question: "how's my runway" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("runway");
    expect(res.result.kind).toBe("stat");
    expect(res.result.kind).not.toBe("confirm");
  });
});

describe("runCommand — demo mode: write questions still preview (read-only); the block happens at confirm", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a write question in demo mode still returns a `confirm` result built from seed data", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // INV-2026-0001 (demo seed, src/lib/demo/seed.ts) is issued, ~$11,940
    // still outstanding after its two seeded payments — well clear of a
    // $100 payment, so this exercises the full preview resolution
    // (invoice + balance read) against seed data, not just routing.
    const res = await runCommand({ question: "record a $100 payment on INV-2026-0001" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.command).toBe("record_payment");
    expect(res.result.kind).toBe("confirm");
    if (res.result.kind !== "confirm") throw new Error("unreachable");
    expect(res.result.commandId).toBe("record_payment");
    expect(res.result.resolvedParams).toMatchObject({ amountCents: 10_000, method: "other" });
  });
});

// ---------------------------------------------------------------------------
// Slice 35b-2 — confirmWriteCommand: the ONLY mutation point.
// ---------------------------------------------------------------------------

describe("confirmWriteCommand — happy path executes via the delegate + audits", () => {
  it("add_customer_note: updates the customer row and the delegate's own audit row exists", async () => {
    const c = await insertCustomer({ name: "Yuki Tanaka" });
    const res = await confirmWriteCommand({
      commandId: "add_customer_note",
      resolvedParams: { customerId: c.id, styleNote: "Prefers concise emails" },
    });
    expect(res).toEqual({ ok: true });
    expect(WRITE_COMMANDS.add_customer_note.execute).toHaveBeenCalledTimes(1);

    const [updated] = await db.select().from(schema.customers).where(eq(schema.customers.id, c.id));
    expect(updated!.styleNote).toBe("Prefers concise emails");

    const [audit] = await db
      .select()
      .from(schema.activityEvents)
      .where(and(eq(schema.activityEvents.entityType, "customer"), eq(schema.activityEvents.verb, "updated")));
    expect(audit).toBeDefined();
    expect(audit!.entityId).toBe(c.id);
  });
});

describe("confirmWriteCommand — demo mode is blocked by the delegate's own guard (single source of the message)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the delegate's exact demo message, not a second/different one", async () => {
    const c = await insertCustomer();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await confirmWriteCommand({
      commandId: "add_customer_note",
      resolvedParams: { customerId: c.id, styleNote: "x" },
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });

    // Confirmed unchanged — the demo guard fired INSIDE the delegate, before
    // any write.
    const [row] = await db.select().from(schema.customers).where(eq(schema.customers.id, c.id));
    expect(row!.styleNote).toBeNull();
  });
});

describe("confirmWriteCommand — authz and validation", () => {
  it("returns Unauthorized with no session (before Zod ever sees the input)", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("no session"));
    const res = await confirmWriteCommand({ commandId: "add_customer_note", resolvedParams: {} });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rejects a raw payload missing commandId", async () => {
    const res = await confirmWriteCommand({ resolvedParams: {} });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toContain("commandId");
  });

  it('a forged commandId ("__proto__" / "constructor" / an outright made-up id) -> "Unknown command", never a throw', async () => {
    for (const bad of ["__proto__", "constructor", "toString", "delete_all"]) {
      const res = await confirmWriteCommand({ commandId: bad, resolvedParams: { anything: true } });
      expect(res).toEqual({ ok: false, error: "Unknown command" });
    }
    // No delegate was ever reached for any of the forged ids above.
    expect(WRITE_COMMANDS.add_customer_note.execute).not.toHaveBeenCalled();
  });
});

describe("confirmWriteCommand — resolvedParams NEVER reach Sentry, even when execute throws", () => {
  it("a marker embedded in resolvedParams never appears in the captured Sentry tags/extra", async () => {
    const MARKER = "SENTINEL_RESOLVEDPARAMS_MARKER_xyz";
    // The thrown error deliberately does NOT contain the marker — this
    // isolates the claim under test (resolvedParams itself never leaks)
    // from the unrelated, already-covered claim that thrown-error text is
    // PII-stripped by safeErrShape.
    vi.mocked(WRITE_COMMANDS.add_customer_note.execute).mockRejectedValueOnce(new Error("boom"));
    const c = await insertCustomer();

    const res = await confirmWriteCommand({
      commandId: "add_customer_note",
      resolvedParams: { customerId: c.id, styleNote: `${MARKER} — do not leak this` },
    });
    expect(res).toEqual({ ok: false, error: "Couldn't complete that — try again" });

    const tags = (globalThis as Record<string, unknown>).__lastSentryTags;
    const extra = (globalThis as Record<string, unknown>).__lastSentryExtra;
    const error = (globalThis as Record<string, unknown>).__lastSentryError;

    expect(error).toBeInstanceOf(Error);
    expect(tags).toMatchObject({
      layer: "command-action",
      action: "confirmWriteCommand",
      command: "add_customer_note",
    });
    expect(JSON.stringify({ tags, extra })).not.toContain(MARKER);
  });
});
