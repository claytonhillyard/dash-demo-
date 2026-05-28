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

  it("returns { user, orgId } for a valid cookie", async () => {
    cookieStore.value = await createSession("boss", 1, SECRET);
    expect(await requireSession()).toEqual({ user: "boss", orgId: 1 });
  });

  it("returns the correct orgId for a non-AIYA session", async () => {
    cookieStore.value = await createSession("alice", 42, SECRET);
    expect(await requireSession()).toEqual({ user: "alice", orgId: 42 });
  });

  it("throws when no cookie is present", async () => {
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });

  it("throws when the cookie is invalid", async () => {
    cookieStore.value = "garbage.token.value";
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });
});
