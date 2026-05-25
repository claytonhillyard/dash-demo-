import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        border: "hsl(var(--border))",
        gold: "hsl(var(--gold))",
        "gold-deep": "hsl(var(--gold-deep))",
        "gold-soft": "hsl(var(--gold-soft))",
        teal: "hsl(var(--teal))",
        ok: "hsl(142 60% 45%)",
        warn: "hsl(41 90% 55%)",
        bad: "hsl(0 70% 55%)",
        "accent-purple": "hsl(var(--accent-purple))",
        "accent-blue": "hsl(var(--accent-blue))",
        "accent-pink": "hsl(var(--accent-pink))",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
