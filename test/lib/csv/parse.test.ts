import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv/parse";

// Truth table for the RFC-4180 subset in spec §3
// (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md).
// The parser never rejects a file for SHAPE — pad/truncate ragged rows, skip
// trailing blank lines — only structurally broken quoting throws (§8
// decision 1: the mapper owns semantic validity, not the parser).

// ---------------------------------------------------------------------------
// Structure: headers/rows split, empty input, header-only
// ---------------------------------------------------------------------------
describe("parseCsv — structure", () => {
  it("splits a simple grid into headers and rows", () => {
    const result = parseCsv("a,b\n1,2\n3,4\n");
    expect(result).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("returns empty headers and rows for an empty string", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("returns rows: [] for header-only input, with or without a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual({ headers: ["a", "b"], rows: [] });
    expect(parseCsv("a,b")).toEqual({ headers: ["a", "b"], rows: [] });
  });
});

// ---------------------------------------------------------------------------
// Quoting: commas, escaped quotes, embedded newlines, whitespace
// ---------------------------------------------------------------------------
describe("parseCsv — quoting", () => {
  it("a quoted field may contain a comma", () => {
    const result = parseCsv('a,b\n"x,y",2\n');
    expect(result).toEqual({ headers: ["a", "b"], rows: [["x,y", "2"]] });
  });

  it('a doubled quote "" inside a quoted field unescapes to a literal "', () => {
    const result = parseCsv('h\n"a""b"\n');
    expect(result).toEqual({ headers: ["h"], rows: [['a"b']] });
  });

  it("a quoted field may contain an embedded newline", () => {
    const result = parseCsv('h1,h2\n"line1\nline2",v\n');
    expect(result).toEqual({ headers: ["h1", "h2"], rows: [["line1\nline2", "v"]] });
  });

  it("whitespace inside a quoted field is preserved exactly", () => {
    const result = parseCsv('h\n"  hi  "\n');
    expect(result).toEqual({ headers: ["h"], rows: [["  hi  "]] });
  });

  it("whitespace in an unquoted field is not trimmed", () => {
    const result = parseCsv("h\n  hi  \n");
    expect(result).toEqual({ headers: ["h"], rows: [["  hi  "]] });
  });
});

// ---------------------------------------------------------------------------
// Line endings and BOM
// ---------------------------------------------------------------------------
describe("parseCsv — line endings and BOM", () => {
  it("accepts CRLF line endings", () => {
    const result = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(result).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("strips a leading UTF-8 BOM", () => {
    const bom = String.fromCharCode(0xfeff);
    const result = parseCsv(`${bom}a,b\n1,2\n`);
    expect(result).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });
});

// ---------------------------------------------------------------------------
// Ragged rows and blank lines: pad/truncate to header length
// ---------------------------------------------------------------------------
describe("parseCsv — ragged rows and blank lines", () => {
  it("pads a short row with empty strings to header length", () => {
    const result = parseCsv("a,b,c\n1,2\n");
    expect(result).toEqual({ headers: ["a", "b", "c"], rows: [["1", "2", ""]] });
  });

  it("truncates a long row to header length", () => {
    const result = parseCsv("a,b\n1,2,3,4\n");
    expect(result).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("skips fully-empty trailing lines, however many there are", () => {
    const result = parseCsv("a,b\n1,2\n\n\n");
    expect(result).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("turns an interior empty line into a padded row of empties", () => {
    const result = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(result).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["", ""],
        ["3", "4"],
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Broken quoting: the only thing the parser throws on
// ---------------------------------------------------------------------------
describe("parseCsv — broken quoting", () => {
  it("throws with the 1-based line number where the unterminated quote opened", () => {
    // Line 1: "a,b"; line 2: "1,2"; line 3 opens a quote that's never closed,
    // and EOF lands on line 4. The error should name line 3 (where the quote
    // opened — actionable for a human fixing the file), not line 4 (EOF).
    const text = 'a,b\n1,2\n"unterminated\nstill going';
    expect(() => parseCsv(text)).toThrow(/line 3/);
  });
});
