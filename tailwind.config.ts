import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        surface: "hsl(var(--surface))",
        gold: "hsl(var(--gold))",
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
        display: ["var(--font-display)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
