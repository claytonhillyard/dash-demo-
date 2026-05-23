// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (cookieStore.value ? { name: n, value: cookieStore.value } : undefined),
  }),
}));

import { createSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/requireSession";

const SECRET = "test-secret-test-secret-test-secret";

describe("requireSession", () => {
  beforeEach(() => {
    cookieStore.value = undefined;
    process.env.SESSION_SECRET = SECRET;
  });

  it("returns the session user for a valid cookie", async () => {
    cookieStore.value = await createSession("boss", SECRET);
    expect(await requireSession()).toEqual({ user: "boss" });
  });

  it("throws when no cookie is present", async () => {
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });

  it("throws when the cookie is invalid", async () => {
    cookieStore.value = "garbage.token.value";
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });
});
