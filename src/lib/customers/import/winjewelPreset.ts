import { z } from "zod";
import type { CustomerAddress } from "@/db/customers";

/**
 * WinJewel CSV column preset — pure header-matching + row-mapping, no db,
 * no session. Spec §4 (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md).
 *
 * The ROADMAP tags this feature `aiya-jewelry`, but module routing (C-2/C-3)
 * doesn't exist yet, so this ships as a single-file preset inside the core
 * customers/import surface — the eventual module extraction is one move.
 */

/** Every field this preset can populate on an imported customer row. */
export type ImportField =
  | "externalRef"
  | "name"
  | "businessName"
  | "email"
  | "phone"
  | "street1"
  | "street2"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "firstSeenAt";

/** field -> the CSV column index it was matched to, for fields present in the file. */
export type HeaderMap = Partial<Record<ImportField, number>>;

export type ImportCustomer = {
  externalRef: string;
  name: string;
  businessName?: string;
  email?: string;
  phone?: string;
  address?: CustomerAddress;
  firstSeenAt?: Date;
};

export type ImportRowResult =
  | { ok: true; value: ImportCustomer }
  | { ok: false; errors: string[] }; // human-readable, field-scoped ("Row N: <field> ...")

type HeaderAlias = { field: ImportField; aliases: readonly string[]; required: boolean };

/**
 * Data-driven alias table (spec §4). Case/space-insensitive; extending it
 * when the real AIYA export arrives is a one-line-per-alias change.
 * externalRef + name are the only required fields — everything else is
 * optional and simply absent from the map when no column matches.
 */
export const WINJEWEL_HEADER_ALIASES: readonly HeaderAlias[] = [
  { field: "externalRef", aliases: ["Customer ID", "CustID", "Customer No", "Cust#"], required: true },
  { field: "name", aliases: ["Name", "Customer Name", "Contact"], required: true },
  { field: "businessName", aliases: ["Company", "Business", "Business Name"], required: false },
  { field: "email", aliases: ["Email", "E-mail"], required: false },
  { field: "phone", aliases: ["Phone", "Phone 1", "Telephone"], required: false },
  { field: "street1", aliases: ["Address", "Address 1", "Street"], required: false },
  { field: "street2", aliases: ["Address 2"], required: false },
  { field: "city", aliases: ["City"], required: false },
  { field: "state", aliases: ["State", "ST"], required: false },
  { field: "zip", aliases: ["Zip", "Zip Code", "Postal Code"], required: false },
  { field: "country", aliases: ["Country"], required: false },
  { field: "firstSeenAt", aliases: ["Customer Since", "Since", "First Sale", "Created"], required: false },
] as const;

const MAX_NAME_LEN = 200;
const MAX_BUSINESS_NAME_LEN = 200;

/** trim + lowercase + collapse internal whitespace runs to one space. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Matches a CSV header row against the WinJewel alias table. Unknown
 * columns are silently ignored. When the same field's alias appears more
 * than once, the first (leftmost) matching column wins.
 *
 * Returns `{ ok: false, missing }` naming exactly which REQUIRED fields
 * (externalRef and/or name) couldn't be matched to any column.
 */
export function matchHeaders(
  headers: string[],
): { ok: true; map: HeaderMap } | { ok: false; missing: string[] } {
  const aliasToField = new Map<string, ImportField>();
  for (const { field, aliases } of WINJEWEL_HEADER_ALIASES) {
    for (const alias of aliases) {
      aliasToField.set(normalizeHeader(alias), field);
    }
  }

  const map: HeaderMap = {};
  headers.forEach((header, index) => {
    const field = aliasToField.get(normalizeHeader(header));
    if (field !== undefined && map[field] === undefined) {
      map[field] = index;
    }
  });

  const missing = WINJEWEL_HEADER_ALIASES.filter(
    (a) => a.required && map[a.field] === undefined,
  ).map((a) => a.field);

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, map };
}

/** Reads + trims a mapped field out of a data row; "" when unmapped or blank. */
function readField(map: HeaderMap, row: string[], field: ImportField): string {
  const idx = map[field];
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Builds the `CustomerAddress` JSONB shape from the row's address columns.
 * All-empty -> undefined (never `{}` — slice-22 rule: never store an empty
 * address object).
 */
function buildAddress(parts: {
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}): CustomerAddress | undefined {
  const address: CustomerAddress = {};
  if (parts.street1 !== "") address.street1 = parts.street1;
  if (parts.street2 !== "") address.street2 = parts.street2;
  if (parts.city !== "") address.city = parts.city;
  if (parts.state !== "") address.state = parts.state;
  if (parts.zip !== "") address.zip = parts.zip;
  if (parts.country !== "") address.country = parts.country;
  return Object.keys(address).length > 0 ? address : undefined;
}

/**
 * Validates year/month/day as a real calendar date (rejects month 13, Feb
 * 30, etc. — the naive `new Date(Date.UTC(...))` constructor rolls those
 * over into the next month instead of erroring, which would silently
 * corrupt migration data).
 */
function buildUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/**
 * Accepts MM/DD/YYYY, M/D/YY (2-digit year pivot: <30 -> 20xx, else 19xx),
 * and YYYY-MM-DD. Returns null for anything else, including syntactically
 * shaped-but-out-of-range dates.
 *
 * Uses String.prototype.match rather than RegExp.prototype.exec — same
 * capture-group result for a non-global pattern, no functional difference.
 */
function parseUsDate(raw: string): Date | null {
  const iso = raw.match(ISO_DATE);
  if (iso) {
    return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const us = raw.match(US_DATE);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const yearRaw = us[3]!;
    const year =
      yearRaw.length === 2 ? (Number(yearRaw) < 30 ? 2000 : 1900) + Number(yearRaw) : Number(yearRaw);
    return buildUtcDate(year, month, day);
  }

  return null;
}

const emailSchema = z.email();

/**
 * Maps one already-shape-normalized CSV data row (see src/lib/csv/parse.ts —
 * ragged rows are pre-padded/truncated to header length) to an
 * `ImportCustomer`, or a field-scoped error list.
 *
 * `rowIndex` is 1-based, counting data rows only (header excluded), and is
 * embedded into every error message so a flattened error list reads
 * standalone without the caller re-zipping index + errors.
 *
 * Every applicable field is checked — the errors array accumulates ALL
 * failures on the row in one pass, not just the first, so an operator
 * fixing the source file sees everything wrong at once.
 */
export function mapRow(map: HeaderMap, row: string[], rowIndex: number): ImportRowResult {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`Row ${rowIndex}: ${msg}`);

  const externalRef = readField(map, row, "externalRef");
  if (externalRef === "") err("externalRef is required");

  const name = readField(map, row, "name");
  if (name === "") {
    err("name is required");
  } else if (name.length > MAX_NAME_LEN) {
    err(`name must be ${MAX_NAME_LEN} characters or fewer`);
  }

  const businessNameRaw = readField(map, row, "businessName");
  let businessName: string | undefined;
  if (businessNameRaw !== "") {
    if (businessNameRaw.length > MAX_BUSINESS_NAME_LEN) {
      err(`businessName must be ${MAX_BUSINESS_NAME_LEN} characters or fewer`);
    } else {
      businessName = businessNameRaw;
    }
  }

  const emailRaw = readField(map, row, "email");
  let email: string | undefined;
  if (emailRaw !== "") {
    const parsed = emailSchema.safeParse(emailRaw);
    if (!parsed.success) {
      err("email is invalid");
    } else {
      email = parsed.data;
    }
  }

  const phoneRaw = readField(map, row, "phone");
  const phone = phoneRaw !== "" ? phoneRaw : undefined;

  const address = buildAddress({
    street1: readField(map, row, "street1"),
    street2: readField(map, row, "street2"),
    city: readField(map, row, "city"),
    state: readField(map, row, "state"),
    zip: readField(map, row, "zip"),
    country: readField(map, row, "country"),
  });

  const firstSeenAtRaw = readField(map, row, "firstSeenAt");
  let firstSeenAt: Date | undefined;
  if (firstSeenAtRaw !== "") {
    const parsed = parseUsDate(firstSeenAtRaw);
    if (parsed === null) {
      err("firstSeenAt is not a valid date");
    } else {
      firstSeenAt = parsed;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ImportCustomer = { externalRef, name };
  if (businessName !== undefined) value.businessName = businessName;
  if (email !== undefined) value.email = email;
  if (phone !== undefined) value.phone = phone;
  if (address !== undefined) value.address = address;
  if (firstSeenAt !== undefined) value.firstSeenAt = firstSeenAt;

  return { ok: true, value };
}
