/**
 * AIYA brilliant-cut diamond mark — a faceted gem rendered inline as SVG so the
 * brand has a real logo with no external asset/network dependency. The gradient
 * + facet lines read as a polished stone catching light.
 */
export function AiyaLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="AIYA Designs"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="aiya-gem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(43 70% 78%)" />
          <stop offset="50%" stopColor="hsl(43 74% 60%)" />
          <stop offset="100%" stopColor="hsl(38 65% 44%)" />
        </linearGradient>
      </defs>
      {/* crown (top table) */}
      <path d="M11 18 L24 6 L37 18 Z" fill="url(#aiya-gem)" opacity="0.9" />
      {/* pavilion (bottom point) */}
      <path d="M11 18 L37 18 L24 43 Z" fill="url(#aiya-gem)" />
      {/* facet lines */}
      <g stroke="hsl(222 30% 6%)" strokeWidth="1" opacity="0.55">
        <path d="M11 18 L24 6 M24 6 L37 18 M11 18 L37 18" />
        <path d="M17.5 12 L20 18 M30.5 12 L28 18 M24 6 L24 18" />
        <path d="M11 18 L24 43 M37 18 L24 43 M20 18 L24 43 M28 18 L24 43" />
      </g>
    </svg>
  );
}
