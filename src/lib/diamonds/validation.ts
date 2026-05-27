import { z } from "zod";
import {
  SHEETS, SHAPES, DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS, NAMED_POINT_KINDS,
} from "./constants";

const cents = z.number().int().min(0);

export const matrixCellInput = z.object({
  sheet: z.enum(SHEETS),
  shape: z.enum(SHAPES),
  color: z.enum(DIAMOND_COLORS),
  clarity: z.enum(DIAMOND_CLARITIES),
  caratBand: z.enum(CARAT_BANDS),
  pricePerCaratCents: cents,
});
export type MatrixCellInput = z.infer<typeof matrixCellInput>;

export const pricePointInput = z.object({
  label: z.string().min(1, "label is required").max(120),
  kind: z.enum(NAMED_POINT_KINDS),
  pricePerCaratCents: cents,
});
export type PricePointInput = z.infer<typeof pricePointInput>;

export const pricePointUpdateInput = pricePointInput.extend({ id: z.number().int() });
export type PricePointUpdateInput = z.infer<typeof pricePointUpdateInput>;

export const importInput = z.object({
  sheet: z.enum(SHEETS),
  shape: z.enum(SHAPES),
  csv: z.string().min(1, "paste CSV rows"),
});
export type ImportInput = z.infer<typeof importInput>;

export { firstZodError } from "@/lib/company/validation";
