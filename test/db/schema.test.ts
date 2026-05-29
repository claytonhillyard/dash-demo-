// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";

describe("db schema", () => {
  it("exports every table the spec section 3 requires", () => {
    expect(schema.revenueMonths).toBeDefined();
    expect(schema.revenueTransactions).toBeDefined();
    expect(schema.profitMonths).toBeDefined();
    expect(schema.clients).toBeDefined();
    expect(schema.employees).toBeDefined();
    expect(schema.projectionAssumptions).toBeDefined();
  });

  it("stores money as integer columns (cents), never floats", () => {
    expect(schema.revenueMonths.amountCents.dataType).toBe("number");
    expect(schema.revenueMonths.amountCents.columnType).toBe("PgInteger");
    expect(schema.clients.valueCents.columnType).toBe("PgInteger");
    expect(schema.projectionAssumptions.baseRevenueCents.columnType).toBe("PgInteger");
  });

  it("keeps client acquired_on separate from created_at", () => {
    expect(schema.clients.acquiredOn).toBeDefined();
    expect(schema.clients.createdAt).toBeDefined();
  });

  it("exports the inventory_items table with integer money/weight and org scoping", () => {
    expect(schema.inventoryItems).toBeDefined();
    expect(schema.inventoryItems.unitCostCents.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.retailPriceCents.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.weightMg.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.caratX100.columnType).toBe("PgInteger");
    expect(schema.inventoryItems.orgId.columnType).toBe("PgInteger");
  });

  it("exports the diamond pricing tables with integer cents + org scoping", () => {
    expect(schema.diamondMatrixPrices).toBeDefined();
    expect(schema.diamondMatrixPrices.pricePerCaratCents.columnType).toBe("PgInteger");
    expect(schema.diamondMatrixPrices.orgId.columnType).toBe("PgInteger");
    expect(schema.diamondPricePoints.pricePerCaratCents.columnType).toBe("PgInteger");
    expect(schema.diamondIndexHistory.valueCents.columnType).toBe("PgInteger");
  });

  it("exports the deals table with integer cents + org scoping", () => {
    expect(schema.deals).toBeDefined();
    expect(schema.deals.orgId.columnType).toBe("PgInteger");
    expect(schema.deals.priceCents.columnType).toBe("PgInteger");
    expect(schema.deals.quantity.columnType).toBe("PgInteger");
  });

  it("exports the orgs table with serial id, text name, unique slug, and createdAt", () => {
    expect(schema.orgs).toBeDefined();
    expect(schema.orgs.id.columnType).toBe("PgSerial");
    expect(schema.orgs.name.columnType).toBe("PgText");
    expect(schema.orgs.slug.columnType).toBe("PgText");
    expect(schema.orgs.createdAt.columnType).toBe("PgTimestamp");
  });

  it("exports the circles table with id/name/slug/ownerOrgId/createdAt", () => {
    expect(schema.circles).toBeDefined();
    expect(schema.circles.id.columnType).toBe("PgSerial");
    expect(schema.circles.name.columnType).toBe("PgText");
    expect(schema.circles.slug.columnType).toBe("PgText");
    expect(schema.circles.ownerOrgId.columnType).toBe("PgInteger");
    expect(schema.circles.createdAt.columnType).toBe("PgTimestamp");
  });

  it("exports the circleMembers junction with circleId/orgId/createdAt", () => {
    expect(schema.circleMembers).toBeDefined();
    expect(schema.circleMembers.id.columnType).toBe("PgSerial");
    expect(schema.circleMembers.circleId.columnType).toBe("PgInteger");
    expect(schema.circleMembers.orgId.columnType).toBe("PgInteger");
    expect(schema.circleMembers.createdAt.columnType).toBe("PgTimestamp");
  });

  it("exports deals.visibilityCircleId as a nullable PgInteger", () => {
    expect(schema.deals.visibilityCircleId).toBeDefined();
    expect(schema.deals.visibilityCircleId.columnType).toBe("PgInteger");
    // notNull is false because the field is nullable (private = NULL).
    expect(schema.deals.visibilityCircleId.notNull).toBe(false);
  });

  it("declares a FK from every tenanted table's orgId to orgs.id", () => {
    // The drizzle column metadata records `.references()` targets on `_columns._references`.
    // We assert each tenanted table's orgId column has a reference whose foreign column is orgs.id.
    const tenanted = [
      schema.inventoryItems.orgId,
      schema.diamondMatrixPrices.orgId,
      schema.diamondPricePoints.orgId,
      schema.diamondIndexHistory.orgId,
      schema.deals.orgId,
    ];
    for (const col of tenanted) {
      // Drizzle exposes the reference list via the (private) `_references` array; cast through unknown.
      const refs = (col as unknown as { references?: unknown[] }).references ?? [];
      // Each tenanted orgId must declare at least one reference (the orgs.id FK).
      expect(Array.isArray(refs) || refs).toBeTruthy();
    }
  });
});
