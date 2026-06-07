import { sql } from "drizzle-orm";
import { type Db } from "@/db/client";
import { isDemoMode } from "@/lib/demo/mode";

function rowsOf<T>(res: unknown): T[] {
  return (res as { rows: T[] }).rows;
}

export type CustomerAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type CustomerView = {
  id: number;
  name: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  notes: string | null;
  externalRef: string | null;
  firstSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Returns customers in the viewer's org. Search is a free-text ILIKE across
 * name, business_name, email, phone. Ordered by (name ASC, created_at DESC).
 *
 * Demo mode short-circuits to DEMO_CUSTOMERS filtered by org (slice 22 spec §3.4)
 * — the RSC reads the constant directly rather than depending on this branch,
 * but it's here for symmetry and as a safety net.
 *
 * NOTE (Phase A): DEMO_CUSTOMERS is added in Phase C C1. Until then, the demo
 * branch throws on the missing named export. Tests in Phase A never exercise
 * demo mode (no NEXT_PUBLIC_DEMO_MODE=true), so this is fine. Phase C wires it.
 */
export async function getCustomers(
  db: Db,
  viewerOrgId: number,
  opts: { search?: string; limit?: number } = {},
): Promise<CustomerView[]> {
  if (isDemoMode()) {
    // TODO(slice-22 Phase C C1): replace with `const { DEMO_CUSTOMERS } = await import("@/lib/demo/seed");`
    throw new Error("DEMO_CUSTOMERS not yet exported (slice 22 Phase C C1)");
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const search = opts.search?.trim() ?? null;

  const res = await db.execute(sql`
    SELECT id, name, business_name, email, phone, address, notes,
           external_ref, first_seen_at, created_at, updated_at
    FROM customers
    WHERE org_id = ${viewerOrgId}
      AND (
        ${search}::text IS NULL
        OR name ILIKE '%' || ${search}::text || '%'
        OR business_name ILIKE '%' || ${search}::text || '%'
        OR email ILIKE '%' || ${search}::text || '%'
        OR phone ILIKE '%' || ${search}::text || '%'
      )
    ORDER BY name ASC, created_at DESC
    LIMIT ${limit}
  `);

  const rows = rowsOf<{
    id: number;
    name: string;
    business_name: string | null;
    email: string | null;
    phone: string | null;
    address: CustomerAddress | null;
    notes: string | null;
    external_ref: string | null;
    first_seen_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(res);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    businessName: r.business_name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    externalRef: r.external_ref,
    firstSeenAt:
      r.first_seen_at === null
        ? null
        : r.first_seen_at instanceof Date
          ? r.first_seen_at
          : new Date(r.first_seen_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}

/**
 * Returns one customer if it exists in the viewer's org. Returns null when
 * the row doesn't exist OR exists in a different org — caller has no way to
 * distinguish the two cases. By design.
 */
export async function getCustomerById(
  db: Db,
  viewerOrgId: number,
  id: number,
): Promise<CustomerView | null> {
  if (isDemoMode()) {
    // TODO(slice-22 Phase C C1): replace with `const { DEMO_CUSTOMERS } = await import("@/lib/demo/seed");`
    throw new Error("DEMO_CUSTOMERS not yet exported (slice 22 Phase C C1)");
  }

  const res = await db.execute(sql`
    SELECT id, name, business_name, email, phone, address, notes,
           external_ref, first_seen_at, created_at, updated_at
    FROM customers
    WHERE id = ${id} AND org_id = ${viewerOrgId}
    LIMIT 1
  `);

  const [r] = rowsOf<{
    id: number;
    name: string;
    business_name: string | null;
    email: string | null;
    phone: string | null;
    address: CustomerAddress | null;
    notes: string | null;
    external_ref: string | null;
    first_seen_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(res);
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    businessName: r.business_name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    notes: r.notes,
    externalRef: r.external_ref,
    firstSeenAt:
      r.first_seen_at === null
        ? null
        : r.first_seen_at instanceof Date
          ? r.first_seen_at
          : new Date(r.first_seen_at),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  };
}
