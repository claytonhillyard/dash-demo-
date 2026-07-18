import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv } from "@/lib/csv/parse";
import {
  matchHeaders,
  mapRow,
  WINJEWEL_HEADER_ALIASES,
  type HeaderMap,
  type ImportField,
} from "@/lib/customers/import/winjewelPreset";

// Contract: spec §4 (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md)
// of the WinJewel CSV import design. matchHeaders/mapRow are pure — no db,
// no session, no cross-row state.
//
// rowIndex convention: 1-based, counting DATA rows only (the header row is
// excluded — the first row after the header is row 1). mapRow embeds it
// into each error string so a flattened error list is self-describing on
// its own, without a caller having to re-zip index + errors together.

// ---------------------------------------------------------------------------
// Alias matrix — every alias in the exported table resolves to its field,
// case- and surrounding-whitespace-insensitively.
// ---------------------------------------------------------------------------
describe("matchHeaders — alias matrix (every alias in WINJEWEL_HEADER_ALIASES)", () => {
  // externalRef + name are the only required fields; pad headers with a
  // satisfied alias for whichever required field ISN'T the one under test,
  // so a lone optional-field case isn't rejected for an unrelated missing
  // requirement, and so a required-field case under test isn't shadowed by
  // a duplicate filler alias for the same field.
  function requiredFillerFor(field: ImportField): string[] {
    const fillers: string[] = [];
    if (field !== "externalRef") fillers.push("Customer ID");
    if (field !== "name") fillers.push("Name");
    return fillers;
  }

  for (const { field, aliases } of WINJEWEL_HEADER_ALIASES) {
    for (const alias of aliases) {
      it(`resolves "${alias}" -> ${field}, case-insensitively`, () => {
        const headers = [...requiredFillerFor(field), alias.toUpperCase()];
        const result = matchHeaders(headers);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.map[field]).toBe(headers.length - 1);
        }
      });
    }
  }
});

describe("matchHeaders — whitespace handling", () => {
  it("collapses internal whitespace when matching a multi-word alias", () => {
    const result = matchHeaders(["Customer ID", "Name", "Customer   Since"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.map.firstSeenAt).toBe(2);
  });

  it("trims leading/trailing whitespace around a header", () => {
    const result = matchHeaders(["Customer ID", "  Name  "]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.map.name).toBe(1);
  });
});

describe("matchHeaders — unknown columns", () => {
  it("ignores columns that match no alias (ok:true, unknown column simply unmapped)", () => {
    const result = matchHeaders(["Customer ID", "Name", "Loyalty Tier"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map.externalRef).toBe(0);
      expect(result.map.name).toBe(1);
      expect(Object.values(result.map)).not.toContain(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Missing required headers — externalRef + name are the only required
// fields; matchHeaders must name exactly which ones couldn't be matched.
// ---------------------------------------------------------------------------
describe("matchHeaders — missing required headers", () => {
  it("names both externalRef and name when neither is present", () => {
    const result = matchHeaders(["Email", "Phone"]);
    expect(result).toEqual({ ok: false, missing: ["externalRef", "name"] });
  });

  it("names only externalRef when name is present but externalRef isn't", () => {
    const result = matchHeaders(["Name", "Email"]);
    expect(result).toEqual({ ok: false, missing: ["externalRef"] });
  });

  it("names only name when externalRef is present but name isn't", () => {
    const result = matchHeaders(["Customer ID", "Email"]);
    expect(result).toEqual({ ok: false, missing: ["name"] });
  });
});

// ---------------------------------------------------------------------------
// Fixture-driven integration — parse test/fixtures/winjewel-customers.csv
// with the 26-1 parser, match its MIXED-alias header row, then map every
// row and assert the exact per-row outcome the fixture was authored to
// produce (spec §7 bullet 4).
// ---------------------------------------------------------------------------
describe("mapRow — fixture-driven integration (test/fixtures/winjewel-customers.csv)", () => {
  const csvText = readFileSync("test/fixtures/winjewel-customers.csv", "utf8");
  const { headers, rows } = parseCsv(csvText);
  const matched = matchHeaders(headers);
  if (!matched.ok) {
    throw new Error(
      `fixture header alias matching failed unexpectedly: missing ${JSON.stringify(
        (matched as { missing: string[] }).missing,
      )}`,
    );
  }
  const map: HeaderMap = matched.map;
  const results = rows.map((row, i) => mapRow(map, row, i + 1));

  it("the mixed-alias header row resolves every field the fixture uses", () => {
    expect(map).toEqual({
      externalRef: 0,
      name: 1,
      businessName: 2,
      email: 3,
      phone: 4,
      street1: 5,
      street2: 6,
      city: 7,
      state: 8,
      zip: 9,
      country: 10,
      firstSeenAt: 11,
    });
  });

  it("parses exactly 12 data rows from the fixture", () => {
    expect(rows.length).toBe(12);
  });

  it("row 1 — happy, full address, MM/DD/YYYY date", () => {
    expect(results[0]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1001",
        name: "Priya Sharma",
        businessName: "Sharma Gems",
        email: "priya@sharmagems.com",
        phone: "212-555-0101",
        address: {
          street1: "100 Diamond Row",
          street2: "Suite 4",
          city: "New York",
          state: "NY",
          zip: "10036",
          country: "US",
        },
        firstSeenAt: new Date(Date.UTC(2019, 2, 14)),
      },
    });
  });

  it("row 2 — happy, quoted comma inside the company name, no phone/address", () => {
    expect(results[1]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1002",
        name: "Owen Clarke",
        businessName: "Smith, Jones & Co",
        email: "owen@smithjones.example",
        firstSeenAt: new Date(Date.UTC(2020, 6, 1)),
      },
    });
  });

  it("row 3 — happy, minimal required-only row (externalRef + name, nothing else)", () => {
    expect(results[2]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1003",
        name: "Fatima Noor",
      },
    });
  });

  it("row 4 — happy, 2-digit year date pivots to 20xx (1/5/29 -> 2029), no street2", () => {
    expect(results[3]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1004",
        name: "Diego Alvarez",
        businessName: "Alvarez & Sons",
        email: "diego@alvarezsons.example",
        phone: "415-555-0110",
        address: {
          street1: "55 Market St",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
          country: "US",
        },
        firstSeenAt: new Date(Date.UTC(2029, 0, 5)),
      },
    });
  });

  it("row 5 — happy, email + phone only, no business/address/date", () => {
    expect(results[4]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1005",
        name: "Grace Kim",
        email: "grace.kim@example.com",
        phone: "646-555-0199",
      },
    });
  });

  it("row 6 — bad email is the only error (field-scoped, doesn't block other rows)", () => {
    expect(results[5]).toEqual({
      ok: false,
      errors: ["Row 6: email is invalid"],
    });
  });

  it("row 7 — bad date (regex-shaped but out-of-range: month 13, day 45) is the only error", () => {
    expect(results[6]).toEqual({
      ok: false,
      errors: ["Row 7: firstSeenAt is not a valid date"],
    });
  });

  it("row 8 — duplicate external_ref of row 1 still maps ok:true (dedup is the 26-3 pipeline's job, not mapRow's — mapRow has no cross-row visibility)", () => {
    expect(results[7]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1001",
        name: "Priya Sharma-Patel",
        businessName: "Sharma Gems",
        email: "priya.patel@sharmagems.com",
        phone: "212-555-0102",
        firstSeenAt: new Date(Date.UTC(2022, 8, 9)),
      },
    });
    expect((results[7] as { ok: true; value: { externalRef: string } }).value.externalRef).toBe(
      (results[0] as { ok: true; value: { externalRef: string } }).value.externalRef,
    );
  });

  it("row 9 — missing name is the only error", () => {
    expect(results[8]).toEqual({
      ok: false,
      errors: ["Row 9: name is required"],
    });
  });

  it("row 10 — happy, partial address (city + country only)", () => {
    expect(results[9]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1010",
        name: "Liu Wei",
        address: { city: "Beijing", country: "CN" },
      },
    });
  });

  it("row 11 — happy, free-text phone formatting preserved verbatim", () => {
    expect(results[10]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1011",
        name: "Oscar Diaz",
        phone: "(212) 555-0134",
      },
    });
  });

  it("row 12 — happy, YYYY-MM-DD date, partial address (no state)", () => {
    expect(results[11]).toEqual({
      ok: true,
      value: {
        externalRef: "WJ-1012",
        name: "Anaïs Fournier",
        businessName: "Fournier Bijoux",
        email: "anais@fournierbijoux.example",
        address: {
          street1: "12 Rue de la Paix",
          city: "Paris",
          zip: "75002",
          country: "FR",
        },
        firstSeenAt: new Date(Date.UTC(2020, 10, 3)),
      },
    });
  });

  it("every ok:true row has a non-empty externalRef and name (required-field contract)", () => {
    for (const r of results) {
      if (r.ok) {
        expect(r.value.externalRef.length).toBeGreaterThan(0);
        expect(r.value.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("exactly 3 of the 12 rows are invalid (bad email, bad date, missing name)", () => {
    expect(results.filter((r) => !r.ok).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Targeted unit rows — isolated cases against a synthetic HeaderMap,
// decoupled from the fixture's column layout.
// ---------------------------------------------------------------------------
describe("mapRow — targeted unit rows", () => {
  const map: HeaderMap = {
    externalRef: 0,
    name: 1,
    businessName: 2,
    email: 3,
    phone: 4,
    street1: 5,
    street2: 6,
    city: 7,
    state: 8,
    zip: 9,
    country: 10,
    firstSeenAt: 11,
  };

  function blankRow(): string[] {
    return Array(12).fill("");
  }

  /** A row that satisfies both required fields, with optional overrides. */
  function rowWith(overrides: Partial<Record<keyof HeaderMap, string>>): string[] {
    const row = blankRow();
    row[map.externalRef!] = "REQ-1";
    row[map.name!] = "Required Name";
    for (const [field, value] of Object.entries(overrides)) {
      const idx = map[field as keyof HeaderMap];
      if (idx !== undefined) row[idx] = value;
    }
    return row;
  }

  describe("email", () => {
    it("a valid email maps through unchanged", () => {
      const result = mapRow(map, rowWith({ email: "a@b.com" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.email).toBe("a@b.com");
    });

    it("an invalid email produces a field-scoped error, not a silent drop", () => {
      const result = mapRow(map, rowWith({ email: "not-valid" }), 1);
      expect(result).toEqual({ ok: false, errors: ["Row 1: email is invalid"] });
    });
  });

  describe("firstSeenAt date parsing", () => {
    it("MM/DD/YYYY", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "06/15/2018" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.firstSeenAt).toEqual(new Date(Date.UTC(2018, 5, 15)));
      }
    });

    it("M/D/YY pivots to 20xx when the 2-digit year is < 30 (1/5/29 -> 2029)", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "1/5/29" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.firstSeenAt).toEqual(new Date(Date.UTC(2029, 0, 5)));
      }
    });

    it("M/D/YY pivots to 19xx when the 2-digit year is >= 30 (1/5/31 -> 1931)", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "1/5/31" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.firstSeenAt).toEqual(new Date(Date.UTC(1931, 0, 5)));
      }
    });

    it("YYYY-MM-DD", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "2021-09-30" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.firstSeenAt).toEqual(new Date(Date.UTC(2021, 8, 30)));
      }
    });

    it("unparseable free text produces a field-scoped error, not a silent null", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "not a date" }), 1);
      expect(result).toEqual({
        ok: false,
        errors: ["Row 1: firstSeenAt is not a valid date"],
      });
    });

    it("a syntactically-shaped but out-of-range date errors (Feb 30 doesn't roll over to Mar 2)", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "02/30/2024" }), 1);
      expect(result).toEqual({
        ok: false,
        errors: ["Row 1: firstSeenAt is not a valid date"],
      });
    });

    it("an empty firstSeenAt is fine — the field is optional", () => {
      const result = mapRow(map, rowWith({ firstSeenAt: "" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.firstSeenAt).toBeUndefined();
    });
  });

  describe("caps (mirrors slice-22 Zod: name 200, businessName 200)", () => {
    it("name over 200 chars errors", () => {
      const result = mapRow(map, rowWith({ name: "x".repeat(201) }), 1);
      expect(result).toEqual({
        ok: false,
        errors: ["Row 1: name must be 200 characters or fewer"],
      });
    });

    it("name at exactly 200 chars is fine (boundary)", () => {
      const result = mapRow(map, rowWith({ name: "x".repeat(200) }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name.length).toBe(200);
    });

    it("businessName over 200 chars errors", () => {
      const result = mapRow(map, rowWith({ businessName: "x".repeat(201) }), 1);
      expect(result).toEqual({
        ok: false,
        errors: ["Row 1: businessName must be 200 characters or fewer"],
      });
    });
  });

  describe("required fields (externalRef, name)", () => {
    it("blank externalRef errors", () => {
      const row = rowWith({});
      row[map.externalRef!] = "";
      const result = mapRow(map, row, 1);
      expect(result).toEqual({ ok: false, errors: ["Row 1: externalRef is required"] });
    });

    it("blank name errors", () => {
      const row = rowWith({});
      row[map.name!] = "";
      const result = mapRow(map, row, 1);
      expect(result).toEqual({ ok: false, errors: ["Row 1: name is required"] });
    });

    it("a whitespace-only externalRef counts as blank (trimmed before the check)", () => {
      const row = rowWith({});
      row[map.externalRef!] = "   ";
      const result = mapRow(map, row, 1);
      expect(result).toEqual({ ok: false, errors: ["Row 1: externalRef is required"] });
    });

    it("accumulates every failing field's error on one row, not just the first", () => {
      const row = rowWith({ email: "nope", firstSeenAt: "nope" });
      row[map.name!] = "";
      const result = mapRow(map, row, 1);
      expect(result).toEqual({
        ok: false,
        errors: [
          "Row 1: name is required",
          "Row 1: email is invalid",
          "Row 1: firstSeenAt is not a valid date",
        ],
      });
    });
  });

  describe("address assembly (slice-22 CustomerAddress shape)", () => {
    it("assembles every provided sub-field", () => {
      const result = mapRow(
        map,
        rowWith({
          street1: "1 Main St",
          street2: "Apt 2",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          country: "US",
        }),
        1,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.address).toEqual({
          street1: "1 Main St",
          street2: "Apt 2",
          city: "Springfield",
          state: "IL",
          zip: "62701",
          country: "US",
        });
      }
    });

    it("an all-empty address maps to undefined, never {} (slice-22 rule)", () => {
      const result = mapRow(map, rowWith({}), 1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.address).toBeUndefined();
    });

    it("a partially-filled address includes only the provided sub-fields", () => {
      const result = mapRow(map, rowWith({ city: "Reno", state: "NV" }), 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.address).toEqual({ city: "Reno", state: "NV" });
      }
    });
  });
});
