// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { customers, draftingPrefs, activityEvents } from "@/db/schema";
import { saveDraftingPrefs, saveCustomerStyleNote, __setTestDb } from "@/lib/drafting/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

let db: Db;

beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// Fixtures — local to this file, same rationale as
// test/lib/payments/actions.test.ts (not imported from a sibling actions
// test file, so this stays independent of that module's own mock surface).
// ---------------------------------------------------------------------------

async function insertCustomer(
  overrides: Partial<{ orgId: number; name: string; styleNote: string | null }> = {},
) {
  const [row] = await db
    .insert(customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Priya Mehta",
      styleNote: overrides.styleNote ?? null,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// saveDraftingPrefs
// ---------------------------------------------------------------------------

describe("saveDraftingPrefs — happy path", () => {
  it("inserts a first row and writes an org-level audit row", async () => {
    const res = await saveDraftingPrefs({ tone: "Warm but concise", signature: "— Clayton" });
    expect(res).toEqual({ ok: true });

    const rows = await db.select().from(draftingPrefs).where(eq(draftingPrefs.orgId, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: 1,
      tone: "Warm but concise",
      signature: "— Clayton",
    });

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "org"), eq(activityEvents.verb, "updated")));
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(1);
    expect(actRow.summary).toBe("Updated email drafting preferences");
    expect(actRow.payload).toEqual({});
    // The audit row must never carry the free-form tone/signature text —
    // asserting no "@" is the house structural PII guard (slice 36/41
    // lineage), even though neither field is an email address; the point is
    // the audit payload/summary stay free of the saved free text entirely.
    expect(JSON.stringify(actRow)).not.toContain("@");
  });

  it("saving twice updates the SAME row rather than inserting a second one", async () => {
    const first = await saveDraftingPrefs({ tone: "First tone", signature: "First sig" });
    expect(first).toEqual({ ok: true });
    const second = await saveDraftingPrefs({ tone: "Second tone", signature: "Second sig" });
    expect(second).toEqual({ ok: true });

    const rows = await db.select().from(draftingPrefs).where(eq(draftingPrefs.orgId, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tone: "Second tone", signature: "Second sig" });
  });

  it("empty strings store as NULL, not empty string", async () => {
    const res = await saveDraftingPrefs({ tone: "", signature: "" });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(draftingPrefs).where(eq(draftingPrefs.orgId, 1));
    expect(row?.tone).toBeNull();
    expect(row?.signature).toBeNull();
  });

  it("omitted fields store as NULL", async () => {
    const res = await saveDraftingPrefs({});
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(draftingPrefs).where(eq(draftingPrefs.orgId, 1));
    expect(row?.tone).toBeNull();
    expect(row?.signature).toBeNull();
  });

  it("does not revalidate any path — no page depends on prefs yet", async () => {
    await saveDraftingPrefs({ tone: "x" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveDraftingPrefs — Zod caps", () => {
  it("rejects a tone over 500 characters, writing no row", async () => {
    const res = await saveDraftingPrefs({ tone: "x".repeat(501) });
    expect(res).toEqual({
      ok: false,
      error: "tone: Too big: expected string to have <=500 characters",
    });
    expect(await db.select().from(draftingPrefs)).toHaveLength(0);
  });

  it("accepts a tone at exactly 500 characters", async () => {
    const res = await saveDraftingPrefs({ tone: "x".repeat(500) });
    expect(res).toEqual({ ok: true });
  });

  it("rejects a signature over 200 characters, writing no row", async () => {
    const res = await saveDraftingPrefs({ signature: "x".repeat(201) });
    expect(res).toEqual({
      ok: false,
      error: "signature: Too big: expected string to have <=200 characters",
    });
    expect(await db.select().from(draftingPrefs)).toHaveLength(0);
  });

  it("accepts a signature at exactly 200 characters", async () => {
    const res = await saveDraftingPrefs({ signature: "x".repeat(200) });
    expect(res).toEqual({ ok: true });
  });
});

describe("saveDraftingPrefs — authz", () => {
  it("returns Unauthorized with no session, writing no row", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await saveDraftingPrefs({ tone: "x" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(draftingPrefs)).toHaveLength(0);
  });
});

describe("saveDraftingPrefs — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks writes and returns the disabled message", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await saveDraftingPrefs({ tone: "x", signature: "y" });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(draftingPrefs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// saveCustomerStyleNote
// ---------------------------------------------------------------------------

describe("saveCustomerStyleNote — happy path", () => {
  it("updates the style note and writes a customer audit row", async () => {
    const customer = await insertCustomer({ name: "Yuki Tanaka" });
    const res = await saveCustomerStyleNote({
      customerId: customer.id,
      styleNote: "Prefers concise, no small talk",
    });
    expect(res).toEqual({ ok: true });

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row?.styleNote).toBe("Prefers concise, no small talk");

    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "customer"), eq(activityEvents.verb, "updated")));
    expect(actRow).toBeDefined();
    expect(actRow.actor).toBe("boss");
    expect(actRow.entityId).toBe(customer.id);
    expect(actRow.summary).toBe("Updated style note for Yuki Tanaka");
    expect(actRow.payload).toEqual({});
    expect(JSON.stringify(actRow)).not.toContain("@");
  });

  it("revalidates the customer edit page", async () => {
    const customer = await insertCustomer();
    await saveCustomerStyleNote({ customerId: customer.id, styleNote: "note" });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain(`/customers/${customer.id}/edit`);
  });

  it("empty string clears an existing note to NULL", async () => {
    const customer = await insertCustomer({ styleNote: "existing note" });
    const res = await saveCustomerStyleNote({ customerId: customer.id, styleNote: "" });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row?.styleNote).toBeNull();
  });
});

describe("saveCustomerStyleNote — Zod caps", () => {
  it("rejects a style note over 300 characters", async () => {
    const customer = await insertCustomer();
    const res = await saveCustomerStyleNote({
      customerId: customer.id,
      styleNote: "x".repeat(301),
    });
    expect(res).toEqual({
      ok: false,
      error: "styleNote: Too big: expected string to have <=300 characters",
    });
  });

  it("accepts a style note at exactly 300 characters", async () => {
    const customer = await insertCustomer();
    const res = await saveCustomerStyleNote({
      customerId: customer.id,
      styleNote: "x".repeat(300),
    });
    expect(res).toEqual({ ok: true });
  });
});

describe("saveCustomerStyleNote — authz", () => {
  it("forbids a cross-org customer id, leaving the row unchanged", async () => {
    const foreignCustomer = await insertCustomer({
      orgId: 999,
      name: "Foreign",
      styleNote: "original",
    });
    const res = await saveCustomerStyleNote({
      customerId: foreignCustomer.id,
      styleNote: "hijacked",
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [row] = await db.select().from(customers).where(eq(customers.id, foreignCustomer.id));
    expect(row?.styleNote).toBe("original");
  });

  it("forbids a missing customer id", async () => {
    const res = await saveCustomerStyleNote({ customerId: 9_999_999, styleNote: "x" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns Unauthorized with no session, leaving the row unchanged", async () => {
    const customer = await insertCustomer({ styleNote: "before" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await saveCustomerStyleNote({ customerId: customer.id, styleNote: "after" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row?.styleNote).toBe("before");
  });
});

describe("saveCustomerStyleNote — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks writes and returns the disabled message", async () => {
    const customer = await insertCustomer({ styleNote: "before" });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await saveCustomerStyleNote({ customerId: customer.id, styleNote: "after" });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row?.styleNote).toBe("before");
  });
});
