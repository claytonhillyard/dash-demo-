// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { documents, customers } from "@/db/schema";
import { getDocuments, getDocumentForDownload, type DocumentType } from "@/db/documents";

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

async function insertDoc(
  orgId: number,
  overrides: Partial<{
    title: string;
    docType: DocumentType;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByLabel: string;
    customerId: number | null;
    createdAt: Date;
  }> = {},
) {
  const [row] = await db
    .insert(documents)
    .values({
      orgId,
      title: overrides.title ?? "Doc",
      docType: overrides.docType ?? "other",
      storageKey: overrides.storageKey ?? `k-${Math.random()}`,
      mimeType: overrides.mimeType ?? "application/pdf",
      sizeBytes: overrides.sizeBytes ?? 100,
      uploadedByLabel: overrides.uploadedByLabel ?? "boss",
      customerId: overrides.customerId ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning();
  return row;
}

describe("getDocuments", () => {
  it("returns org documents newest-first", async () => {
    await insertDoc(1, { title: "Old", createdAt: new Date(Date.now() - 10_000) });
    await insertDoc(1, { title: "New", createdAt: new Date() });
    const rows = await getDocuments(db, 1);
    expect(rows.map((r) => r.title)).toEqual(["New", "Old"]);
  });

  it("excludes documents belonging to a different org (org-999 invisible)", async () => {
    await insertDoc(1, { title: "Mine" });
    await insertDoc(999, { title: "Theirs" });
    const rows = await getDocuments(db, 1);
    expect(rows.map((r) => r.title)).toEqual(["Mine"]);
  });

  it("filters by customerId when provided", async () => {
    const [cust] = await db.insert(customers).values({ orgId: 1, name: "Cust" }).returning();
    await insertDoc(1, { title: "Linked", customerId: cust.id });
    await insertDoc(1, { title: "OrgLevel", customerId: null });
    const rows = await getDocuments(db, 1, { customerId: cust.id });
    expect(rows.map((r) => r.title)).toEqual(["Linked"]);
  });

  it("never exposes storageKey on list rows", async () => {
    await insertDoc(1, { title: "X" });
    const rows = await getDocuments(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("storageKey");
  });

  it("returns [] for an org with no documents", async () => {
    expect(await getDocuments(db, 1)).toEqual([]);
  });
});

describe("getDocumentForDownload", () => {
  it("returns storageKey/mimeType/title for an org-owned document", async () => {
    const row = await insertDoc(1, {
      title: "Contract",
      storageKey: "org/1/documents/x.pdf",
      mimeType: "application/pdf",
    });
    const result = await getDocumentForDownload(db, 1, row.id);
    expect(result).toEqual({
      storageKey: "org/1/documents/x.pdf",
      mimeType: "application/pdf",
      title: "Contract",
    });
  });

  it("returns null for a cross-org id", async () => {
    const row = await insertDoc(999, { title: "Theirs" });
    expect(await getDocumentForDownload(db, 1, row.id)).toBeNull();
  });

  it("returns null for a missing id", async () => {
    expect(await getDocumentForDownload(db, 1, 999_999)).toBeNull();
  });
});

describe("getDocuments / getDocumentForDownload — demo mode", () => {
  const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO;
    vi.resetModules();
  });

  it("getDocuments returns the demo seed rows for org 1, newest-first, with no storageKey", async () => {
    const mod = await import("@/db/documents");
    const { DEMO_DOCUMENTS } = await import("@/lib/demo/seed");
    const rows = await mod.getDocuments(db, 1);
    expect(rows).toHaveLength(DEMO_DOCUMENTS.length);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i].createdAt.getTime());
    }
    expect(rows[0]).not.toHaveProperty("storageKey");
  });

  it("getDocuments filters demo rows by customerId", async () => {
    const mod = await import("@/db/documents");
    const rows = await mod.getDocuments(db, 1, { customerId: 2204 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.customerId === 2204)).toBe(true);
  });

  it("getDocuments returns [] for an unseeded org", async () => {
    const mod = await import("@/db/documents");
    expect(await mod.getDocuments(db, 999_999)).toEqual([]);
  });

  it("getDocumentForDownload returns the seeded descriptor for a demo id", async () => {
    const mod = await import("@/db/documents");
    const { DEMO_DOCUMENTS } = await import("@/lib/demo/seed");
    const seed = DEMO_DOCUMENTS[0];
    const result = await mod.getDocumentForDownload(db, seed.orgId, seed.id);
    expect(result).toEqual({
      storageKey: seed.storageKey,
      mimeType: seed.mimeType,
      title: seed.title,
    });
  });

  it("getDocumentForDownload cross-org lookup on a demo id returns null", async () => {
    const mod = await import("@/db/documents");
    const { DEMO_DOCUMENTS } = await import("@/lib/demo/seed");
    const seed = DEMO_DOCUMENTS[0];
    expect(await mod.getDocumentForDownload(db, 999_999, seed.id)).toBeNull();
  });
});
