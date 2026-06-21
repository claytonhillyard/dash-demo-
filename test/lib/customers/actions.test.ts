// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import {
  getSharedDb,
  resetSharedDb,
  closeSharedDb,
} from "../../helpers/shared-db";
import { customers, activityEvents } from "@/db/schema";
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  __setTestDb,
} from "@/lib/customers/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";

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
// createCustomer
// ---------------------------------------------------------------------------

describe("createCustomer — happy path", () => {
  it("inserts a row in the caller's org (org_id from session, not wire)", async () => {
    const res = await createCustomer({
      name: "Priya Mehta",
      businessName: "Mehta Diamonds",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBeGreaterThan(0);
    }
    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].name).toBe("Priya Mehta");
    expect(rows[0].businessName).toBe("Mehta Diamonds");
    // Future-proofing columns remain NULL on direct creates.
    expect(rows[0].externalRef).toBeNull();
    expect(rows[0].firstSeenAt).toBeNull();
    // Activity event assertion
    const newCustomerId = res.ok ? res.id : -1;
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.entityType, "customer"))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toMatchObject({
      orgId: 1,
      entityType: "customer",
      entityId: newCustomerId,
      verb: "created",
    });
    expect(actRow.summary).toMatch(/^Added /);
  });

  it("ignores any wire-provided org_id and uses session.orgId", async () => {
    // Caller tries to "create as org 999" by stuffing org_id on the wire.
    // Schema doesn't carry it; Zod silently drops the unknown key and the
    // insert uses session.orgId. raw: unknown lets us pass arbitrary shapes.
    const raw: Record<string, unknown> = {
      name: "Spoof",
      orgId: 999,
      org_id: 999,
    };
    await createCustomer(raw);
    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
  });

  it("normalizes an empty address to NULL at write", async () => {
    await createCustomer({ name: "X", address: {} });
    const [row] = await db.select().from(customers);
    expect(row.address).toBeNull();
  });

  it("stores a non-empty address as a JSONB object", async () => {
    await createCustomer({
      name: "X",
      address: { city: "Mumbai", country: "IN" },
    });
    const [row] = await db.select().from(customers);
    expect(row.address).toMatchObject({ city: "Mumbai", country: "IN" });
  });

  it("revalidates /customers on success", async () => {
    await createCustomer({ name: "Alice" });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/customers");
  });
});

describe("createCustomer — validation", () => {
  it("rejects empty name with a typed Zod error", async () => {
    const res = await createCustomer({ name: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/name/i);
    expect(await db.select().from(customers)).toHaveLength(0);
  });

  it("rejects missing name", async () => {
    const res = await createCustomer({});
    expect(res.ok).toBe(false);
    expect(await db.select().from(customers)).toHaveLength(0);
  });

  it("rejects malformed email", async () => {
    const res = await createCustomer({
      name: "Alice",
      email: "not-an-email",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/email/i);
    expect(await db.select().from(customers)).toHaveLength(0);
  });

  it("rejects oversize country code in address", async () => {
    const res = await createCustomer({
      name: "Alice",
      address: { country: "USA" },
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(customers)).toHaveLength(0);
  });

  it("rejects notes longer than 2000 chars", async () => {
    const res = await createCustomer({
      name: "Alice",
      notes: "z".repeat(2001),
    });
    expect(res.ok).toBe(false);
    expect(await db.select().from(customers)).toHaveLength(0);
  });
});

describe("createCustomer — auth", () => {
  it("returns Unauthorized when no session (no insert)", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await createCustomer({ name: "Should not insert" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(customers)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateCustomer
// ---------------------------------------------------------------------------

describe("updateCustomer — happy path", () => {
  it("lets the owner update their own customer", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "Old name" })
      .returning();
    const res = await updateCustomer({ id: r.id, name: "New name" });
    expect(res).toEqual({ ok: true });
    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, r.id));
    expect(after.name).toBe("New name");
    // Activity event assertion
    const actRows = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.entityType, "customer"),
          eq(activityEvents.verb, "updated"),
        ),
      );
    expect(actRows.length).toBe(1);
    expect(
      (actRows[0]!.payload as Record<string, unknown>).changedFields,
    ).toBeInstanceOf(Array);
  });

  it("revalidates /customers and /customers/:id on success", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    await updateCustomer({ id: r.id, name: "Y" });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/customers");
    expect(calls).toContain(`/customers/${r.id}`);
  });

  it("updates updated_at when the row changes", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    const before = r.updatedAt.getTime();
    // Sleep a tiny bit so timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 10));
    await updateCustomer({ id: r.id, name: "Y" });
    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, r.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before);
  });
});

describe("updateCustomer — authz", () => {
  it("forbids updating a customer in a different org", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 999, name: "Untouchable" })
      .returning();
    const res = await updateCustomer({ id: r.id, name: "PWNED" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, r.id));
    expect(after.name).toBe("Untouchable");
  });

  it("forbids updating a non-existent id (looks like 'not found' = Forbidden)", async () => {
    const res = await updateCustomer({ id: 9_999_999, name: "X" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns Unauthorized with no session", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await updateCustomer({ id: r.id, name: "Y" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, r.id));
    expect(after.name).toBe("X");
  });
});

describe("updateCustomer — validation", () => {
  it("rejects empty name", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "Original" })
      .returning();
    const res = await updateCustomer({ id: r.id, name: "" });
    expect(res.ok).toBe(false);
  });

  it("rejects missing id", async () => {
    const res = await updateCustomer({ name: "X" });
    expect(res.ok).toBe(false);
  });

  it("rejects malformed email", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    const res = await updateCustomer({
      id: r.id,
      name: "X",
      email: "not-an-email",
    });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteCustomer
// ---------------------------------------------------------------------------

describe("deleteCustomer — happy path", () => {
  it("lets the owner delete their own customer", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "Bye" })
      .returning();
    const res = await deleteCustomer({ id: r.id });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(rows).toHaveLength(0);
    // Activity event assertion
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.entityType, "customer"),
          eq(activityEvents.verb, "deleted"),
        ),
      );
    expect(actRow.summary).toMatch(/^Deleted /);
  });

  it("revalidates /customers on success", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    await deleteCustomer({ id: r.id });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/customers");
  });
});

describe("deleteCustomer — authz", () => {
  it("forbids deleting a customer in a different org", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 999, name: "Survives" })
      .returning();
    const res = await deleteCustomer({ id: r.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Survives");
  });

  it("forbids deleting a non-existent id", async () => {
    const res = await deleteCustomer({ id: 9_999_999 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns Unauthorized with no session", async () => {
    const [r] = await db
      .insert(customers)
      .values({ orgId: 1, name: "X" })
      .returning();
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await deleteCustomer({ id: r.id });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    const rows = await db.select().from(customers).where(eq(customers.id, r.id));
    expect(rows).toHaveLength(1);
  });
});

describe("deleteCustomer — validation", () => {
  it("rejects missing id", async () => {
    const res = await deleteCustomer({});
    expect(res.ok).toBe(false);
  });

  it("rejects negative id", async () => {
    const res = await deleteCustomer({ id: -1 });
    expect(res.ok).toBe(false);
  });

  it("rejects non-integer id", async () => {
    const res = await deleteCustomer({ id: 1.5 });
    expect(res.ok).toBe(false);
  });
});

// Activity emission best-effort guarantee is covered by
// test/lib/activity/recordActivitySafely.test.ts — that wrapper
// swallows all errors, so action handlers can `await` it safely.
