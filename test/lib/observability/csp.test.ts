import { describe, it, expect } from "vitest";
import { parseSentryIngestHost } from "@/lib/observability/csp";

describe("parseSentryIngestHost", () => {
  it("returns the exact ingest host from a real-shaped DSN", () => {
    expect(
      parseSentryIngestHost("https://abc123@o111222.ingest.sentry.io/4506789"),
    ).toBe("https://o111222.ingest.sentry.io");
  });

  it("returns the exact host for a region-specific ingest (us, de, etc.)", () => {
    expect(
      parseSentryIngestHost("https://abc@o42.ingest.us.sentry.io/9999"),
    ).toBe("https://o42.ingest.us.sentry.io");
  });

  it("returns null when DSN is undefined (demo / unconfigured builds)", () => {
    expect(parseSentryIngestHost(undefined)).toBeNull();
  });

  it("returns null when DSN is empty string", () => {
    expect(parseSentryIngestHost("")).toBeNull();
  });

  it("returns null when DSN is malformed", () => {
    expect(parseSentryIngestHost("not-a-url")).toBeNull();
    expect(parseSentryIngestHost("http://")).toBeNull();
  });

  it("strips the project path and the auth segment — only origin remains", () => {
    expect(
      parseSentryIngestHost("https://pubkey@o1.ingest.sentry.io/12345"),
    ).not.toContain("/12345");
    expect(
      parseSentryIngestHost("https://pubkey@o1.ingest.sentry.io/12345"),
    ).not.toContain("pubkey");
  });

  it("rejects non-https DSNs (defense in depth — Sentry DSNs are always https in production)", () => {
    expect(
      parseSentryIngestHost("http://abc@o1.ingest.sentry.io/12345"),
    ).toBeNull();
  });
});
