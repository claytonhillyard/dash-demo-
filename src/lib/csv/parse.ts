export type CsvParseResult = { headers: string[]; rows: string[][] };

/**
 * Parses CSV text against the RFC-4180 subset this app's imports need.
 * Single character-walk state machine — no regex.
 *
 * Supported:
 *  - comma-separated fields, optionally wrapped in double quotes
 *  - `""` inside a quoted field escapes a literal `"`
 *  - quoted fields may embed literal commas and newlines
 *  - both CRLF and LF line endings
 *  - a leading UTF-8 BOM is stripped before parsing
 *
 * Shape contract (spec §3 / §8 decision 1 — data-quality errors belong to
 * the mapper/preview, not a parse crash; this function never rejects a file
 * for SHAPE):
 *  - the first row is `headers`; every row after it is a data row in `rows`
 *  - fully-empty trailing lines (one or many) are dropped entirely
 *  - a fully-empty line before the last data row becomes a one-field row of
 *    `""`, then padded like any other short row — it is NOT dropped
 *  - short rows are padded with `""` up to `headers.length`
 *  - long rows are truncated to `headers.length`
 *  - empty input returns `{ headers: [], rows: [] }`; header-only input
 *    returns `rows: []`
 *
 * The ONLY thing this function throws on is structurally broken quoting — an
 * opening `"` with no matching close before EOF. That's not a row-shape
 * problem the mapper can route around; it's unparseable text. The thrown
 * message names the 1-based line where the unterminated quote OPENED (not
 * the EOF line), since that's where a human needs to look to fix the file.
 */
export function parseCsv(text: string): CsvParseResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rawRows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;
  let line = 1;
  let quoteOpenLine = 1;

  const pushField = () => {
    row.push(field);
    field = "";
    atFieldStart = true;
  };
  const pushRow = () => {
    pushField();
    rawRows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
        continue;
      }
      if (c === "\n") line++;
      field += c;
      continue;
    }

    if (c === '"' && atFieldStart) {
      inQuotes = true;
      quoteOpenLine = line;
      atFieldStart = false;
      continue;
    }
    if (c === ",") {
      pushField();
      continue;
    }
    if (c === "\r" && text[i + 1] === "\n") continue; // swallow; \n below ends the row
    if (c === "\n") {
      pushRow();
      line++;
      continue;
    }

    field += c;
    atFieldStart = false;
  }

  if (inQuotes) throw new Error(`Unterminated quoted field starting at line ${quoteOpenLine}`);
  if (field !== "" || row.length > 0) pushRow();

  // Fully-empty trailing lines (however many) are dropped; an interior blank
  // line survives as a one-field `[""]` row and gets padded below.
  while (rawRows.length > 0) {
    const last = rawRows[rawRows.length - 1];
    if (last.length === 1 && last[0] === "") rawRows.pop();
    else break;
  }

  if (rawRows.length === 0) return { headers: [], rows: [] };

  const headers = rawRows[0];
  const rows = rawRows.slice(1).map((r) => {
    if (r.length === headers.length) return r;
    return r.length < headers.length
      ? [...r, ...Array(headers.length - r.length).fill("")]
      : r.slice(0, headers.length);
  });

  return { headers, rows };
}
