import { and, eq, desc, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedDeals } from "@/lib/demo/seed";
import type { DealKind, DealCategory, DealStatus } from "./constants";

export interface DealRow {
  id: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  createdAt: Date;
}

export interface DealFilters {
  status?: DealStatus;
  kind?: DealKind;
  category?: DealCategory;
}

const COLUMNS = {
  id: deals.id,
  kind: deals.kind,
  category: deals.category,
  subject: deals.subject,
  quantity: deals.quantity,
  priceCents: deals.priceCents,
  currency: deals.currency,
  status: deals.status,
  postedByLabel: deals.postedByLabel,
  createdAt: deals.createdAt,
} as const;

export async function getActiveDeals(
  db: Db,
  orgId: number,
  limit: number = 5,
): Promise<DealRow[]> {
  if (isDemoMode()) {
    return getSeedDeals().filter((d) => d.status === "Open").slice(0, limit);
  }
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(eq(deals.orgId, orgId), eq(deals.status, "Open")))
    .orderBy(desc(deals.createdAt))
    .limit(limit);
  return rows as DealRow[];
}

export async function getAllDeals(
  db: Db,
  orgId: number,
  filters: DealFilters = {},
): Promise<DealRow[]> {
  if (isDemoMode()) return getSeedDeals();
  const clauses: SQL[] = [eq(deals.orgId, orgId)];
  if (filters.status) clauses.push(eq(deals.status, filters.status));
  if (filters.kind) clauses.push(eq(deals.kind, filters.kind));
  if (filters.category) clauses.push(eq(deals.category, filters.category));
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(...clauses))
    .orderBy(desc(deals.createdAt));
  return rows as DealRow[];
}
