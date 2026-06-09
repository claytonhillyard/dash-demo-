import { describe, it, expect } from "vitest";
import {
  addressInput,
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
} from "@/lib/customers/validation";

// ---------------------------------------------------------------------------
// addressInput
// ---------------------------------------------------------------------------

describe("addressInput", () => {
  it("normalizes {} to undefined", () => {
    const r = addressInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("rejects all-empty-string sub-fields (each must be .min(1) when present)", () => {
    // Pre-fix: this test branched on whether success/failure landed and
    // vacuously passed. The actual behavior: empty strings fail .min(1) on
    // each sub-field. Empty objects fall through to the all-undefined branch
    // (next test). The client form normalizes "" → undefined before submit
    // so this combination never reaches the server in practice.
    const r = addressInput.safeParse({ street1: "", city: "" });
    expect(r.success).toBe(false);
  });

  it("normalizes all-undefined fields to undefined", () => {
    const r = addressInput.safeParse({
      street1: undefined,
      city: undefined,
      country: undefined,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("normalizes undefined input to undefined", () => {
    const r = addressInput.safeParse(undefined);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeUndefined();
  });

  it("keeps non-empty addresses intact", () => {
    const r = addressInput.safeParse({ city: "Mumbai", country: "IN" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ city: "Mumbai", country: "IN" });
  });

  it("trims whitespace on city/state/zip", () => {
    const r = addressInput.safeParse({
      city: "  Mumbai  ",
      state: "  MH  ",
      zip: "  400004  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data?.city).toBe("Mumbai");
      expect(r.data?.state).toBe("MH");
      expect(r.data?.zip).toBe("400004");
    }
  });

  it("rejects country codes that aren't ISO-2 (too long)", () => {
    const r = addressInput.safeParse({ country: "USA" });
    expect(r.success).toBe(false);
  });

  it("rejects lowercase country codes", () => {
    const r = addressInput.safeParse({ country: "us" });
    expect(r.success).toBe(false);
  });

  it("rejects single-letter country code", () => {
    const r = addressInput.safeParse({ country: "U" });
    expect(r.success).toBe(false);
  });

  it("rejects country codes with digits", () => {
    const r = addressInput.safeParse({ country: "U1" });
    expect(r.success).toBe(false);
  });

  it("rejects city longer than 100 chars", () => {
    const r = addressInput.safeParse({ city: "x".repeat(101) });
    expect(r.success).toBe(false);
  });

  it("rejects street1 longer than 200 chars", () => {
    const r = addressInput.safeParse({ street1: "x".repeat(201) });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCustomerInput
// ---------------------------------------------------------------------------

describe("createCustomerInput", () => {
  it("accepts the minimum input — just name", () => {
    const r = createCustomerInput.safeParse({ name: "Alice" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Alice");
  });

  it("requires name (missing)", () => {
    const r = createCustomerInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it("requires name (empty string)", () => {
    const r = createCustomerInput.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });

  it("requires name (whitespace-only collapses to empty after trim)", () => {
    const r = createCustomerInput.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects name longer than 200 chars", () => {
    const r = createCustomerInput.safeParse({ name: "x".repeat(201) });
    expect(r.success).toBe(false);
  });

  it("accepts name exactly 200 chars", () => {
    const r = createCustomerInput.safeParse({ name: "x".repeat(200) });
    expect(r.success).toBe(true);
  });

  it("rejects malformed email", () => {
    const r = createCustomerInput.safeParse({
      name: "Alice",
      email: "not-an-email",
    });
    expect(r.success).toBe(false);
  });

  it("rejects email missing @", () => {
    const r = createCustomerInput.safeParse({
      name: "Alice",
      email: "aliceatexample.com",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid email", () => {
    const r = createCustomerInput.safeParse({
      name: "Alice",
      email: "alice@example.com",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("alice@example.com");
  });

  it("rejects notes longer than 2000 chars", () => {
    const r = createCustomerInput.safeParse({
      name: "X",
      notes: "z".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("accepts notes exactly 2000 chars", () => {
    const r = createCustomerInput.safeParse({
      name: "X",
      notes: "z".repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects businessName longer than 200 chars", () => {
    const r = createCustomerInput.safeParse({
      name: "X",
      businessName: "z".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects phone longer than 50 chars", () => {
    const r = createCustomerInput.safeParse({
      name: "X",
      phone: "1".repeat(51),
    });
    expect(r.success).toBe(false);
  });

  it("silently drops externalRef from the wire (reserved for slice 26 import)", () => {
    // Slice 22 design intentionally omits externalRef from the user-facing
    // schema; Zod's default object behavior strips unknown keys.
    const r = createCustomerInput.safeParse({
      name: "X",
      externalRef: "WJ-10421",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).externalRef).toBeUndefined();
    }
  });

  it("trims surrounding whitespace on every text field", () => {
    const r = createCustomerInput.safeParse({
      name: "  Alice  ",
      businessName: "  Acme  ",
      email: "  alice@example.com  ",
      phone: "  555-0100  ",
      notes: "  hello  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Alice");
      expect(r.data.businessName).toBe("Acme");
      expect(r.data.email).toBe("alice@example.com");
      expect(r.data.phone).toBe("555-0100");
      expect(r.data.notes).toBe("hello");
    }
  });

  it("normalizes an all-empty address to undefined", () => {
    const r = createCustomerInput.safeParse({
      name: "Alice",
      address: {},
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.address).toBeUndefined();
  });

  it("propagates nested address country error", () => {
    const r = createCustomerInput.safeParse({
      name: "Alice",
      address: { country: "USA" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a fully-populated payload (sans externalRef)", () => {
    const r = createCustomerInput.safeParse({
      name: "Priya Mehta",
      businessName: "Mehta Diamonds",
      email: "priya@mehtadiamonds.in",
      phone: "+91 22 5555 1100",
      address: { city: "Mumbai", country: "IN" },
      notes: "Wholesale partner.",
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateCustomerInput
// ---------------------------------------------------------------------------

describe("updateCustomerInput", () => {
  it("requires a positive integer id", () => {
    const r = updateCustomerInput.safeParse({ name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("rejects id = 0", () => {
    const r = updateCustomerInput.safeParse({ id: 0, name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("rejects negative id", () => {
    const r = updateCustomerInput.safeParse({ id: -1, name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer id", () => {
    const r = updateCustomerInput.safeParse({ id: 1.5, name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("accepts a valid id + name", () => {
    const r = updateCustomerInput.safeParse({ id: 42, name: "Alice" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.id).toBe(42);
      expect(r.data.name).toBe("Alice");
    }
  });

  it("still requires name", () => {
    const r = updateCustomerInput.safeParse({ id: 42 });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteCustomerInput
// ---------------------------------------------------------------------------

describe("deleteCustomerInput", () => {
  it("accepts a positive integer id", () => {
    const r = deleteCustomerInput.safeParse({ id: 42 });
    expect(r.success).toBe(true);
  });

  it("rejects id = 0", () => {
    const r = deleteCustomerInput.safeParse({ id: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects negative id", () => {
    const r = deleteCustomerInput.safeParse({ id: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects missing id", () => {
    const r = deleteCustomerInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects string id", () => {
    const r = deleteCustomerInput.safeParse({ id: "42" });
    expect(r.success).toBe(false);
  });
});
