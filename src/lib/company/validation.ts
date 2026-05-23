import { z } from "zod";

const intCents = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const year = z.number().int().min(1900).max(3000);
const month = z.number().int().min(1).max(12);

export const revenueMonthInput = z.object({
  year,
  month,
  amountCents: intCents,
});
export type RevenueMonthInput = z.infer<typeof revenueMonthInput>;

export const revenueTransactionInput = z.object({
  occurredOn: isoDate,
  amountCents: intCents,
  memo: z.string().max(280).optional(),
});
export type RevenueTransactionInput = z.infer<typeof revenueTransactionInput>;

export const profitMonthInput = z.object({
  year,
  month,
  amountCents: intCents,
});
export type ProfitMonthInput = z.infer<typeof profitMonthInput>;

export const clientInput = z.object({
  name: z.string().min(1, "name is required").max(120),
  status: z.enum(["active", "prospect", "churned"]),
  valueCents: intCents.min(0),
  acquiredOn: isoDate,
});
export type ClientInput = z.infer<typeof clientInput>;

export const employeeInput = z.object({
  name: z.string().min(1, "name is required").max(120),
  role: z.string().min(1, "role is required").max(120),
  hiredOn: isoDate,
});
export type EmployeeInput = z.infer<typeof employeeInput>;

export const projectionInput = z.object({
  baseYear: year,
  baseRevenueCents: intCents.min(0),
  cagrPct: z.number().int().min(-100).max(1000),
  perYearOverrides: z.record(z.string(), intCents),
});
export type ProjectionInput = z.infer<typeof projectionInput>;

/** Flatten the first zod issue into a single human-readable message for the UI. */
export function firstZodError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
