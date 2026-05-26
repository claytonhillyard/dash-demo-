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
});
