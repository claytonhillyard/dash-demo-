import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        // The primary text token. Without this, ~387 `text-text`/`text-text/NN`
        // classes across the app emitted no rule and silently inherited the
        // body color (so muted variants like `text-text/70` rendered at full
        // brightness). Defining it makes those alpha variants actually mute
        // (review chip). `--text` has a single definition in globals.css — no
        // light-theme variant — so this is unambiguous.
        text: "hsl(var(--text))",
        // SOLID secondary/tertiary text tokens (C-9). Prefer these over the
        // `text-text/NN` opacity ladder: composited, 43% of those uses landed
        // below WCAG AA (text-text/40 measured ~3.3:1). These are measured
        // against --bg instead. The ladder still works; C-10 migrates callers.
        "text-muted": "hsl(var(--text-muted))",
        "text-dim": "hsl(var(--text-dim))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        "surface-3": "hsl(var(--surface-3))",
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        gold: "hsl(var(--gold))",
        "gold-deep": "hsl(var(--gold-deep))",
        "gold-soft": "hsl(var(--gold-soft))",
        teal: "hsl(var(--teal))",
        // Status colors now read from the vars so they can clear AA on dark
        // surfaces (bad was hard-coded at ~4.2:1 against the panel).
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        bad: "hsl(var(--bad))",
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
