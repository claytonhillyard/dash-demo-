import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

// require() works on .js CommonJS files in a vitest run; this is the same
// way @lhci/cli loads the config at runtime.
const configPath = resolve(__dirname, "..", "lighthouserc.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require(configPath) as {
  ci: {
    collect: {
      startServerCommand: string;
      startServerReadyPattern?: string;
      url: string[];
      numberOfRuns: number;
      settings: {
        preset: string;
        onlyCategories?: string[];
      };
    };
    assert: {
      assertions: Record<string, unknown>;
    };
    upload: {
      target: string;
      outputDir?: string;
    };
  };
};

describe("lighthouserc.js — shape invariants", () => {
  it("exports a CommonJS object with a `ci` key", () => {
    expect(config).toBeDefined();
    expect(config.ci).toBeDefined();
    expect(typeof config.ci).toBe("object");
  });
});

describe("lighthouserc.js — collect block", () => {
  it("audits exactly two URLs: /login and /", () => {
    expect(config.ci.collect.url).toEqual([
      "http://localhost:3000/login",
      "http://localhost:3000/",
    ]);
  });

  it("runs three samples per URL (median-of-three smooths variance)", () => {
    expect(config.ci.collect.numberOfRuns).toBe(3);
  });

  it("uses the desktop preset (slice 14 is desktop-only — see spec §2.7)", () => {
    expect(config.ci.collect.settings.preset).toBe("desktop");
  });

  it("startServerCommand sets NEXT_PUBLIC_DEMO_MODE=true (auth-bypass invariant)", () => {
    expect(config.ci.collect.startServerCommand).toContain(
      "NEXT_PUBLIC_DEMO_MODE=true",
    );
  });

  it("startServerCommand sets the dummy SESSION_SECRET (middleware import satisfies)", () => {
    expect(config.ci.collect.startServerCommand).toContain(
      "SESSION_SECRET=lighthouse-ci-noop-secret",
    );
  });
});

describe("lighthouserc.js — assert block", () => {
  it("asserts LCP (largest-contentful-paint) — matches slice 12 LCP signal", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "largest-contentful-paint",
    );
  });

  it("asserts CLS (cumulative-layout-shift) — matches slice 12 CLS signal", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "cumulative-layout-shift",
    );
  });

  it("asserts TBT (total-blocking-time) — lab proxy for slice 12 INP signal (§2.4.1)", () => {
    expect(config.ci.assert.assertions).toHaveProperty("total-blocking-time");
  });

  it("asserts performance category score", () => {
    expect(config.ci.assert.assertions).toHaveProperty("categories:performance");
  });

  it("asserts accessibility category score (slice 1c posture)", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "categories:accessibility",
    );
  });

  it("asserts best-practices category score", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "categories:best-practices",
    );
  });

  it("does NOT assert SEO category (not a marketing site)", () => {
    expect(config.ci.assert.assertions).not.toHaveProperty("categories:seo");
  });
});

describe("lighthouserc.js — upload block", () => {
  it("uploads to the filesystem only (no public storage, no LHCI server)", () => {
    expect(config.ci.upload.target).toBe("filesystem");
  });

  it("writes reports to .lighthouseci/ (gitignored)", () => {
    expect(config.ci.upload.outputDir).toBe(".lighthouseci");
  });
});
