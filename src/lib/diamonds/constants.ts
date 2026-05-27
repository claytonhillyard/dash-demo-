export const SHEETS = ["natural", "lab"] as const;
export type Sheet = (typeof SHEETS)[number];

export const SHAPES = ["round", "fancy"] as const;
export type Shape = (typeof SHAPES)[number];

export const DIAMOND_COLORS = [
  "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
] as const;
export type DiamondColor = (typeof DIAMOND_COLORS)[number];

export const DIAMOND_CLARITIES = [
  "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "SI3", "I1", "I2", "I3",
] as const;
export type DiamondClarity = (typeof DIAMOND_CLARITIES)[number];

export const CARAT_BANDS = [
  "0.01-0.03", "0.04-0.07", "0.08-0.14", "0.15-0.17", "0.18-0.22", "0.23-0.29",
  "0.30-0.39", "0.40-0.49", "0.50-0.69", "0.70-0.89", "0.90-0.99", "1.00-1.49",
  "1.50-1.99", "2.00-2.99", "3.00-3.99", "4.00-4.99", "5.00-5.99", "10.00-10.99",
] as const;
export type CaratBand = (typeof CARAT_BANDS)[number];

/** The single cell whose price IS the index, applied per sheet. */
export const BENCHMARK = {
  shape: "round" as Shape,
  color: "G",
  clarity: "VS1",
  caratBand: "1.00-1.49",
};

export const NAMED_POINT_KINDS = ["fancy_diamond", "gem"] as const;
export type NamedPointKind = (typeof NAMED_POINT_KINDS)[number];
