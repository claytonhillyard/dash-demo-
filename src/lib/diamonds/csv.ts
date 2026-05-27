import {
  DIAMOND_COLORS, DIAMOND_CLARITIES, CARAT_BANDS,
  type DiamondColor, type DiamondClarity, type CaratBand,
} from "./constants";

export interface ParsedCell {
  caratBand: CaratBand;
  color: DiamondColor;
  clarity: DiamondClarity;
  pricePerCaratCents: number;
}
export type ParseResult =
  | { ok: true; rows: ParsedCell[] }
  | { ok: false; error: string };

const COLORS = new Set<string>(DIAMOND_COLORS);
const CLARITIES = new Set<string>(DIAMOND_CLARITIES);
const BANDS = new Set<string>(CARAT_BANDS);

/** Parse `carat_band,color,clarity,price_per_carat` rows (dollars/ct -> cents). */
export function parseMatrixCsv(text: string): ParseResult {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, error: "no rows" };
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  if (header.join(",") !== "carat_band,color,clarity,price_per_carat") {
    return { ok: false, error: "header must be: carat_band,color,clarity,price_per_carat" };
  }
  const rows: ParsedCell[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based, header is line 1
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length !== 4) return { ok: false, error: `line ${lineNo}: expected 4 columns` };
    const [caratBand, color, clarity, priceRaw] = cols;
    if (!BANDS.has(caratBand)) return { ok: false, error: `line ${lineNo}: unknown carat band "${caratBand}"` };
    if (!COLORS.has(color)) return { ok: false, error: `line ${lineNo}: unknown color "${color}"` };
    if (!CLARITIES.has(clarity)) return { ok: false, error: `line ${lineNo}: unknown clarity "${clarity}"` };
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: `line ${lineNo}: price must be a positive number` };
    }
    rows.push({
      caratBand: caratBand as CaratBand,
      color: color as DiamondColor,
      clarity: clarity as DiamondClarity,
      pricePerCaratCents: Math.round(price * 100),
    });
  }
  if (rows.length === 0) return { ok: false, error: "no data rows" };
  return { ok: true, rows };
}
