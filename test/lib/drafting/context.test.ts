// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { customers, invoices, payments, customerHealthSnapshots, activityEvents } from "@/db/schema";
import { buildDraftingContext } from "@/lib/drafting/context";

let db: Db;

beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// Fixtures — local inserts, following the shared-db seed helper pattern from
// test/db/runway.test.ts / test/lib/investor/collect.test.ts.
// ---------------------------------------------------------------------------

async function insertCustomer(
  overrides: Partial<{
    orgId: number;
    name: string;
    businessName: string | null;
    email: string | null;
    styleNote: string | null;
  }> = {},
) {
  const [row] = await db
    .insert(customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Priya Mehta",
      businessName: overrides.businessName ?? null,
      email: overrides.email ?? null,
      styleNote: overrides.styleNote ?? null,
    })
    .returning();
  return row!;
}

let invoiceCounter = 0;

async function insertInvoice(overrides: {
  orgId?: number;
  customerId: number;
  status?: "draft" | "issued" | "void";
  totalCents?: number;
  issueDate?: string | null;
}) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 1_000;
  const [row] = await db
    .insert(invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      invoiceNumber: `INV-TEST-${String(invoiceCounter).padStart(4, "0")}`,
      status: overrides.status ?? "issued",
      billTo: { name: "Test Customer" },
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: overrides.issueDate === undefined ? "2026-07-15" : overrides.issueDate,
    })
    .returning();
  return row!;
}

async function insertPayment(overrides: {
  orgId?: number;
  invoiceId: number;
  amountCents?: number;
  receivedDate?: string;
}) {
  const [row] = await db
    .insert(payments)
    .values({
      orgId: overrides.orgId ?? 1,
      invoiceId: overrides.invoiceId,
      amountCents: overrides.amountCents ?? 500,
      method: "cash",
      receivedDate: overrides.receivedDate ?? "2026-07-15",
    })
    .returning();
  return row!;
}

async function insertSnapshot(overrides: {
  orgId?: number;
  customerId: number;
  band: "healthy" | "watch" | "at_risk";
  capturedOn: string;
  score?: number;
}) {
  await db.insert(customerHealthSnapshots).values({
    orgId: overrides.orgId ?? 1,
    customerId: overrides.customerId,
    score: overrides.score ?? 50,
    band: overrides.band,
    components: { recency: 10, frequency: 10, breadth: 10 },
    capturedOn: overrides.capturedOn,
  });
}

async function insertActivity(overrides: { orgId?: number; entityId: number; summary: string }) {
  await db.insert(activityEvents).values({
    orgId: overrides.orgId ?? 1,
    entityType: "customer",
    entityId: overrides.entityId,
    verb: "updated",
    summary: overrides.summary,
    actor: "test-user",
  });
  // Force monotonic created_at when iterating fast — pglite resolves to
  // microseconds but we want guaranteed ordering for assertions (same
  // convention as test/db/activityEvents.test.ts's insertEvents helper).
  await new Promise((r) => setTimeout(r, 2));
}

describe("buildDraftingContext", () => {
  it("returns a full shape whose balance matches the slice-29 derivation (issued totals minus payments)", async () => {
    const c = await insertCustomer({ name: "Priya Mehta", email: "priya@example.com" });
    const inv = await insertInvoice({
      customerId: c.id,
      status: "issued",
      totalCents: 10_000,
      issueDate: "2026-07-01",
    });
    await insertPayment({ invoiceId: inv.id, amountCents: 4_000 });

    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.customerName).toBe("Priya Mehta");
    expect(ctx!.hasEmail).toBe(true);
    expect(ctx!.outstandingBalanceCents).toBe(6_000);
  });

  it("picks the last invoice by latest issueDate, with id as the tiebreak", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, issueDate: "2026-06-01", totalCents: 1_000 });
    await insertInvoice({ customerId: c.id, issueDate: "2026-07-01", totalCents: 2_000 });
    // Same issueDate as the row above, but inserted after it -> higher id ->
    // wins the tiebreak.
    const tie = await insertInvoice({ customerId: c.id, issueDate: "2026-07-01", totalCents: 3_000 });

    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.lastInvoice).toMatchObject({
      number: tie.invoiceNumber,
      totalCents: 3_000,
      status: "issued",
      issueDate: "2026-07-01",
    });
  });

  it("lastPaymentDate is the max received_date across the customer's invoices", async () => {
    const c = await insertCustomer();
    const inv1 = await insertInvoice({ customerId: c.id, issueDate: "2026-06-01" });
    const inv2 = await insertInvoice({ customerId: c.id, issueDate: "2026-07-01" });
    await insertPayment({ invoiceId: inv1.id, receivedDate: "2026-06-10" });
    await insertPayment({ invoiceId: inv2.id, receivedDate: "2026-07-20" });

    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.lastPaymentDate).toBe("2026-07-20");
  });

  it("a customer with no email on file has hasEmail false", async () => {
    const c = await insertCustomer({ email: null });
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.hasEmail).toBe(false);
  });

  it("a customer with no health snapshots has healthBand null", async () => {
    const c = await insertCustomer();
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.healthBand).toBeNull();
  });

  it("healthBand reflects the LATEST snapshot when several exist", async () => {
    const c = await insertCustomer();
    await insertSnapshot({ customerId: c.id, band: "healthy", capturedOn: "2026-07-01" });
    await insertSnapshot({ customerId: c.id, band: "watch", capturedOn: "2026-07-02" });
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.healthBand).toBe("watch");
  });

  it("recentActivity is capped at the 5 most recent summaries, most recent first", async () => {
    const c = await insertCustomer();
    for (let i = 0; i < 7; i++) {
      await insertActivity({ entityId: c.id, summary: `Event ${i}` });
    }
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx!.recentActivity).toHaveLength(5);
    expect(ctx!.recentActivity[0]).toBe("Event 6");
    expect(ctx!.recentActivity[4]).toBe("Event 2");
  });

  it("returns null for a customer that belongs to a different org (cross-org isolation)", async () => {
    const c = await insertCustomer({ orgId: 999 });
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(ctx).toBeNull();
  });

  it("returns null for a missing customer id", async () => {
    const ctx = await buildDraftingContext(db, 1, 9_999_999);
    expect(ctx).toBeNull();
  });

  it("structural PII guard: serializing the context of a customer with a seeded email contains no '@'", async () => {
    const c = await insertCustomer({
      email: "yuki.tanaka@example.com",
      styleNote: "Prefers concise emails",
    });
    const ctx = await buildDraftingContext(db, 1, c.id);
    expect(JSON.stringify(ctx)).not.toContain("@");
  });

  describe("demo mode", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("customer 2204 (Yuki Tanaka) resolves a fully populated demo context", async () => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
      const ctx = await buildDraftingContext(db, 1, 2204);
      expect(ctx).not.toBeNull();
      expect(ctx!.customerName).toBe("Yuki Tanaka");
      expect(ctx!.businessName).toBe("Ginza Pearl House");
      expect(ctx!.hasEmail).toBe(true);
      expect(ctx!.healthBand).toBe("watch"); // latest of the 3 seeded snapshots
      expect(ctx!.lastInvoice).not.toBeNull();
      expect(ctx!.lastInvoice!.number).toBe("INV-2026-0001");
      expect(ctx!.outstandingBalanceCents).toBeGreaterThan(0); // seed invoice is only partially paid
      expect(ctx!.lastPaymentDate).not.toBeNull();
    });

    it("a seed customer with no invoices/snapshots still resolves name/business, with empty aggregates", async () => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
      const ctx = await buildDraftingContext(db, 1, 2206); // Rohan Patel — no seeded invoices/snapshots
      expect(ctx).not.toBeNull();
      expect(ctx!.customerName).toBe("Rohan Patel");
      expect(ctx!.outstandingBalanceCents).toBe(0);
      expect(ctx!.lastInvoice).toBeNull();
      expect(ctx!.healthBand).toBeNull();
    });

    it("returns null for a missing/cross-org id in demo mode too", async () => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
      const ctx = await buildDraftingContext(db, 1, 9_999_999);
      expect(ctx).toBeNull();
    });
  });
});
