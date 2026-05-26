import { z } from "zod";

export const INVENTORY_CATEGORIES = [
  "Rings", "Necklaces", "Earrings", "Bracelets", "Pendants",
  "Chains", "Watch Bands", "Diamonds", "Gems",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_STATUSES = ["in_stock", "reserved", "sold"] as const;
export const METALS = ["gold", "silver", "platinum", "other"] as const;

const cents = z.number().int().min(0);

export const inventoryItemInput = z.object({
  category: z.enum(INVENTORY_CATEGORIES),
  name: z.string().min(1, "name is required").max(160),
  sku: z.string().max(80).optional(),
  quantity: z.number().int().min(0),
  status: z.enum(INVENTORY_STATUSES),
  unitCostCents: cents,
  retailPriceCents: cents,
  metal: z.enum(METALS).optional(),
  weightMg: z.number().int().min(0).optional(),
  caratX100: z.number().int().min(0).optional(),
  cut: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  clarity: z.string().max(40).optional(),
});
export type InventoryItemInput = z.infer<typeof inventoryItemInput>;

export const inventoryItemUpdateInput = inventoryItemInput.extend({ id: z.number().int() });
export type InventoryItemUpdateInput = z.infer<typeof inventoryItemUpdateInput>;

/** Reuse the shared single-message flattener from the company slice. */
export { firstZodError } from "@/lib/company/validation";
