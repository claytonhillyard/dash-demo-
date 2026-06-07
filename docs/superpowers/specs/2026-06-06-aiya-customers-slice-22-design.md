# AIYA Dashboard — Slice 22: Customers + CRM panel — Design

**Date:** 2026-06-06
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 1b-1 (inventory admin CRUD pattern), slice 1b-3 (diamonds admin CRUD), slice 3 (multi-tenant invariant — explicit `orgId` everywhere, no defaults), slice 11 (Sentry observability — `runWithUser` catches and tags), slice 15 (TradeNet cross-circle inventory — reused JSONB shape inspiration).

**Numbering note:** Slices 19-21 are reserved for the parallel-agent track (they have an active multi-phase slice 18 split — 18a/18b/18c). Slice 22 is the foundation slice of a new "WinJewel migration + Invoice system" workstream that decomposes into slices 22 → 26 → 27 → 28 → 29 → 30. Slices 23 (AI image-to-listing), 24 (Activity feed), 25 (Watchlists + Resend) sit between and benefit from this slice.

---

## 1. Overview & Goals

A jewelry business runs on relationships. Every deal, invoice, payment, and follow-up ties back to a person or a business — and right now AIYA's dashboard has no concept of one. Slice 22 introduces the `customers` table and the admin CRUD surface that makes those relationships first-class. It's the smallest possible foundation for everything downstream: slice 24 (Activity Feed) wants per-customer audit rows, slice 25 (Watchlists) wants customer-scoped saved searches, slice 26 (WinJewel CSV import) writes the imported customer roster here, slices 27-30 (Invoices/PDF/Payments/History) all reference customer rows as their primary buyer entity.

This slice ships **no invoice logic, no payment tracking, no lifetime-value calculation**. It is a single org-scoped table with admin CRUD, a search-enabled list view, a single-page edit form, and an opinionated address shape that downstream slices reuse without re-litigating.

**Goals:**

- New `customers` table with the schema in §3.
- Three server actions wrapped in `runWithUser` + Zod: `createCustomer`, `updateCustomer`, `deleteCustomer`. Owner-only writes; defense-in-depth `org_id` WHERE on every UPDATE/DELETE.
- Two query functions in `src/db/customers.ts`: `getCustomers(db, viewerOrgId, opts?)` and `getCustomerById(db, viewerOrgId, id)`. SQL-enforced `org_id = $viewerOrgId` predicate; no application-layer tenant filtering.
- New `/customers` admin route mirroring `/inventory` and `/diamonds`. Table view with free-text search + add button; form view for create + edit + delete.
- Sidebar nav extended with a "Customers" link in the admin group.
- Demo seed: 3 authored `DEMO_CUSTOMERS` entries on `DEMO_AIYA_ORG_ID` so the live demo shows a populated CRM.
- Cross-org isolation test, write-side authz truth table, Zod validation edge-case tests, migration smoke test, two component tests (table + form).

## 2. Non-Goals (each has a named home)

- **Tags / segmentation** — defer to a tiny follow-up slice if needed (`customer_tags` join table).
- **Lifetime value calculation** — slice 27 (invoices) is the first surface that computes this. Slice 22 doesn't try.
- **Per-customer activity journal / notes thread** — slice 24 (activity feed) is the right home for time-ordered entries.
- **Customer photos / avatars** — out of scope.
- **Customer-scoped private deals / circles** — circles (slice 4) already exist; this is a different abstraction.
- **Soft delete / archive** — hard delete only in slice 22.
- **Multi-phone / multi-email** — single-value columns; multi-value lives in a future polish slice if real workflow demands it.
- **Email format normalization (lowercase) or deduplication** — Zod validates format; storage preserves case as entered. Dedup is a per-tenant operational concern, not slice 22's.
- **Customer-facing portal / self-service** — out of scope.
- **GDPR/CCPA "export my data" / "delete my data"** — out of scope for slice 22; revisit when AIYA expands to EU jurisdictions.

## 3. Schema

### 3.1 `customers` (new)

```ts
customers
  id              serial PK
  org_id          int    NOT NULL  FK → orgs(id)              -- slice-3 invariant
  name            text   NOT NULL                              -- contact person (always populated)
  business_name   text   NULL                                  -- optional company name
  email           text   NULL                                  -- Zod-validated at the action layer
  phone           text   NULL                                  -- free-text, no format enforcement
  address         jsonb  NULL                                  -- {street1, street2, city, state, zip, country}
  notes           text   NULL                                  -- ≤ 2000 chars (Zod cap)
  external_ref    text   NULL                                  -- WinJewel customer id (slice 26 idempotency)
  first_seen_at   timestamptz NULL                             -- WinJewel CustomerSince (slice 26)
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()
```

Indexes:
- `(org_id, created_at DESC)` named `customers_org_created_idx` — primary list path
- **Partial unique** `(org_id, external_ref) WHERE external_ref IS NOT NULL` named `customers_org_external_ref_unique` — guarantees WinJewel import is idempotent without forbidding NULL duplicates on directly-created rows

> **Why no full-text search index in slice 22.** Slice 22's search is `ILIKE '%query%'` across (name, business_name, email, phone). For ≤ 10K customers per org that's fine on Postgres + pglite. If volume justifies it later, a separate slice can add a `to_tsvector(name || ' ' || coalesce(business_name, ''))` GIN index without changing this schema.

### 3.2 Address shape (JSONB content)

```ts
type CustomerAddress = {
  street1?: string;  // up to 200 chars
  street2?: string;  // up to 200 chars
  city?:    string;  // up to 100 chars
  state?:   string;  // up to 100 chars
  zip?:     string;  // up to 20 chars
  country?: string;  // ISO 3166-1 alpha-2 (US, IN, FR, JP, …)
};
```

All sub-fields optional. The whole `address` is optional too. An empty object at the action layer normalizes to `null` at write — never store a `{}` row.

### 3.3 Why the two future-proofing columns

`external_ref` and `first_seen_at` are slice 22's contribution to slice 26 (WinJewel import). Both are nullable and have zero UX impact today.

- **`external_ref`** anchors import idempotency. WinJewel's customer table has a stable customer ID; slice 26's CSV import uses an UPSERT keyed on `(org_id, external_ref)` so re-running the wizard doesn't duplicate rows. Without this column, slice 26 would either have to add it migration-style after-the-fact (which costs a migration) or do fuzzy deduplication (which costs correctness).
- **`first_seen_at`** preserves WinJewel's `CustomerSince` field. We could overload `created_at` to mean "when this customer first became a customer," but that overload breaks downstream sort order (slice 24 activity feed wants "row creation time" not "first-contact time"). A separate column keeps both honest.

Both are NULL for customers created directly via the slice 22 form. The slice 22 form does NOT expose either field in the UI.

### 3.4 Demo seed (`DEMO_CUSTOMERS`)

Authored TS constant appended to `src/lib/demo/seed.ts` (matches the slice-10/16/17 demo seed pattern — no runtime DB inserts; the query layer short-circuits in demo mode and the RSC reads this directly).

Three entries on `DEMO_AIYA_ORG_ID`:

1. **Mehta Diamonds Pvt Ltd** — contact "Priya Mehta", address Mumbai, partner-tier.
2. **Saint-Cloud Atelier** — contact "Jean-Marc Auclair", address Paris.
3. **Anita Sharma** — individual retail buyer, San Francisco address, no business name.

This gives the demo a populated table on first render (no awkward "no customers yet" empty state) and the seed-test asserts the count + shape.

## 4. Authz rules (all server-enforced via `runWithUser`)

1. **Create (`createCustomer`)** — `org_id` is set from `session.orgId`, never from the wire. There is no cross-org-create attack surface.
2. **Update (`updateCustomer`)** — pre-flight SELECT confirms `customer.org_id === caller.orgId`. UPDATE WHERE includes `eq(customers.orgId, callerOrgId)` defense-in-depth so a TOCTOU race can never write to a row in another org.
3. **Delete (`deleteCustomer`)** — same pattern as update. Hard delete.
4. **Read (`getCustomers`, `getCustomerById`)** — SQL `WHERE org_id = $viewerOrgId` filter at every read. No application-layer filtering, no `.filter(r => r.orgId === viewer)` after the SQL.

Violations throw `ForbiddenError` inside the `runWithUser` callback; the wrapper catches and returns `{ok:false, error:"Forbidden"}` with zero DB writes. Same slice-3/10/16/17 pattern.

**No new auth primitive is introduced.** Slice 22 reuses `runWithUser` + `ForbiddenError` directly.

## 5. Server actions (`src/lib/customers/actions.ts`)

```ts
createCustomer(raw): Promise<ActionResult>
updateCustomer(raw): Promise<ActionResult>     // input includes id
deleteCustomer({ id }): Promise<ActionResult>
```

All wrap `runWithUser` and use Zod schemas from new file `src/lib/customers/validation.ts`.

### 5.1 `createCustomer`

```ts
createCustomerInput = z.object({
  name:          z.string().trim().min(1, "Name is required").max(200),
  businessName:  z.string().trim().min(1).max(200).optional(),
  email:         z.string().trim().email("Invalid email").optional(),
  phone:         z.string().trim().min(1).max(50).optional(),
  address:       addressInput,
  notes:         z.string().trim().min(1).max(2000).optional(),
});
```

Behavior:
1. Validate input.
2. Insert with `org_id = orgId` (from session), `external_ref = null`, `first_seen_at = null`.
3. Wrapper revalidates `/` and `/customers`.

### 5.2 `updateCustomer`

```ts
updateCustomerInput = createCustomerInput.extend({
  id: z.number().int().positive(),
});
```

Behavior:
1. Validate input.
2. Pre-flight SELECT to confirm row exists in caller's org — if not, `ForbiddenError`.
3. UPDATE with `set({...input, updatedAt: new Date()})` and `where(and(eq(id), eq(orgId, callerOrgId)))`.

### 5.3 `deleteCustomer`

```ts
deleteCustomerInput = z.object({
  id: z.number().int().positive(),
});
```

Behavior:
1. Validate input.
2. DELETE `where(and(eq(customers.id, input.id), eq(customers.orgId, callerOrgId)))`. Returning row-count not strictly needed — affecting 0 rows because of FK ownership mismatch is silently fine; the caller already got `{ok:true}` because no error was raised.

### 5.4 Zod address shape

Defined alongside the action schemas:

```ts
addressInput = z.object({
  street1: z.string().trim().max(200).optional(),
  street2: z.string().trim().max(200).optional(),
  city:    z.string().trim().max(100).optional(),
  state:   z.string().trim().max(100).optional(),
  zip:     z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).optional(),       // ISO-2: "US", "IN", "FR", "JP", …
}).optional().transform((v) => {
  // Empty object → null. Don't store a row with `address = {}`.
  if (!v) return undefined;
  const hasAny = Object.values(v).some((s) => s !== undefined && s !== "");
  return hasAny ? v : undefined;
});
```

## 6. Query layer (`src/db/customers.ts`)

### 6.1 `getCustomers(db, viewerOrgId, opts?: { search?: string; limit?: number }): Promise<CustomerView[]>`

```ts
type CustomerAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

type CustomerView = {
  id: number;
  name: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  notes: string | null;
  externalRef: string | null;
  firstSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

SQL skeleton:

```sql
SELECT id, name, business_name, email, phone, address, notes,
       external_ref, first_seen_at, created_at, updated_at
FROM customers
WHERE org_id = $viewerOrgId
  AND (
    $search IS NULL
    OR name ILIKE '%' || $search || '%'
    OR business_name ILIKE '%' || $search || '%'
    OR email ILIKE '%' || $search || '%'
    OR phone ILIKE '%' || $search || '%'
  )
ORDER BY name ASC, created_at DESC
LIMIT LEAST($limit, 200)
```

Default `limit` is 50; caller can pass up to 200. `search` is optional. Demo-mode short-circuit: returns the `DEMO_CUSTOMERS` constant filtered by org (so the demo CRM renders 3 rows).

### 6.2 `getCustomerById(db, viewerOrgId, id): Promise<CustomerView | null>`

```sql
SELECT … FROM customers WHERE id = $id AND org_id = $viewerOrgId LIMIT 1
```

Returns `null` when the customer doesn't exist OR exists in a different org. The caller has no way to distinguish those two — by design.

Demo mode: filters `DEMO_CUSTOMERS` by `id`.

### 6.3 `rowsOf<T>` helper

Local to this file, same pattern as slice-10/16/17 query files.

## 7. UI

### 7.1 `/customers` admin route

New RSC page mirroring `/inventory` and `/diamonds`. Reads `getCustomers(db, orgId, { search: searchParams.q })` server-side.

Layout:
- Header: page title "Customers" + free-text search input (URL param `?q=...`) + "Add customer" button.
- Body: `CustomersTable` (server-rendered list) with Edit + Delete actions per row.
- Empty state: "No customers yet. Add your first customer or import from WinJewel (coming soon)."

### 7.2 `CustomersTable` component

Columns:
- **Customer** — `business_name ?? name` as the headline, contact name as sub-line when business is present
- **Email**
- **Phone**
- **Created** — relative time
- **Actions** — Edit (opens form) + Delete (confirmation modal)

Search input is a controlled `<form>` that submits as a URL param so it survives navigation and shares cleanly.

### 7.3 `CustomerForm` component

Two modes: create (`/customers/new`) and edit (`/customers/[id]/edit`).

Fields:
- Name (required)
- Business name (optional)
- Email (optional, format-validated by Zod)
- Phone (optional)
- Address — collapsible section with 6 fields (street1, street2, city, state, zip, country). All optional. Country is a `<select>` populated with ~20 common ISO-2 codes ("US", "IN", "FR", "GB", "JP", "AE", "SG", "HK", "IT", "DE", "CH", "BR", "MX", "CA", "AU", "TR", "TH", "ZA", "ES", "NL").
- Notes — textarea, ≤ 2000 chars, monospace input
- Submit → calls `createCustomer` or `updateCustomer`
- Cancel → routes back to `/customers`
- Error display — captures `{ok:false}` response and renders `<p role="alert">` near the submit button (slice-16 cleanup pattern)

The address section's "Address" toggle is closed by default in create mode and open in edit mode if any field is non-empty.

`external_ref` and `first_seen_at` are NOT exposed in the form. They exist purely to support slice 26's WinJewel import.

### 7.4 Sidebar nav

Add "Customers" link to the admin group in the sidebar (mirrors the slice-11 layout for "Inventory" / "Diamonds" / "Website" links).

### 7.5 Plain-text rendering contract

Notes render as React text children only:

```tsx
<p className="whitespace-pre-wrap">{customer.notes}</p>
```

React escapes the string content automatically. The repo's `eslint-plugin-react/no-danger` rule (already on) prevents any future authoring of HTML-injection from these strings. The XSS surface is zero because we never enter the surface — slice-10/16/17 invariant: never construct HTML from user data. HTML sanitization libraries are intentionally NOT added; they are unnecessary when the contract is "no HTML is ever constructed from customer data."

## 8. Testing strategy (mirrors slice 16/17 truth-table style)

### 8.1 `test/db/customers.test.ts` — query layer

- Cross-org isolation: seed org 1 with 3 customers, org 999 with 2; `getCustomers(db, 1)` returns 3, `getCustomers(db, 999)` returns 2.
- Search filter: `getCustomers(db, 1, { search: "mehta" })` finds Mehta-related rows by name OR business_name OR email OR phone.
- Ordering: name ASC, created_at DESC tiebreak.
- Limit: default 50, caller-supplied cap honored, max 200 enforced.
- `getCustomerById` for ID in a different org returns `null` (not the row).
- Demo mode returns the DEMO_CUSTOMERS constant filtered by org.

### 8.2 `test/lib/customers/customer-authz.test.ts` — write-side truth table

Matrix: `{owner, foreign-org} × {create, update, delete}`.
- Owner allowed → `{ok:true}` + row mutated as expected.
- Foreign org → `{ok:false, error:"Forbidden"}` + zero row mutation.
- Update with ID from another org: zero rows affected; row unchanged on inspection.

### 8.3 `test/lib/customers/customer-validation.test.ts` — Zod edge cases

- Empty `address: {}` → normalized to `undefined` (not stored).
- Invalid email → rejected with `error: /email/`.
- Country code wrong length ("USA") → rejected.
- Name empty → rejected.
- Notes >2000 chars → rejected.

### 8.4 `test/db/migration-customers-smoke.test.ts`

- Table exists with expected columns.
- `(org_id, external_ref)` partial unique fires on duplicate non-null insert.
- `(org_id, external_ref)` allows multiple NULL rows (partial WHERE excludes NULLs).

### 8.5 `test/components/admin/CustomersTable.test.tsx`

- Empty state renders the placeholder.
- 3 rows render with business headline for businesses and contact name for individuals.
- Search input submits as URL param.
- Delete confirmation modal renders before action fires.

### 8.6 `test/components/admin/CustomerForm.test.tsx`

- Create mode: empty initial state, submit fires `createCustomer` with parsed payload.
- Edit mode: pre-fills with the supplied customer.
- Address section toggle (open in edit mode when any field set; closed in create mode).
- Error path: action returns `{ok:false}` → alert renders.

### 8.7 `test/lib/demo/seed.test.ts` — extension

- Assert `DEMO_CUSTOMERS` has 3 entries on `DEMO_AIYA_ORG_ID`.
- Assert one has `business_name` set (Mehta), one has it (Saint-Cloud), one does not (Anita Sharma).

## 9. Migration & rollout

- New drizzle migration (next sequential — read `drizzle/meta/_journal.json` at execution time; likely `0013_*` given main is at `0012_lush_dracula` from slice 17).
- Migration is additive: one table, two indexes. No destructive changes.
- `outputFileTracingIncludes` already covers `./drizzle/**/*`. No Netlify config change.
- No env vars added.
- New npm dep: none.

## 10. Out-of-scope follow-ups (named, not built)

- **Slice 22 polish**: tags table, customer photos, multi-value phone/email.
- **Slice 23**: AI image-to-listing (separate workstream).
- **Slice 24**: Activity feed — first dashboard surface that reads customer rows for audit context.
- **Slice 25**: Watchlists + Resend — adds per-customer saved searches.
- **Slice 26**: WinJewel CSV import wizard — first writer to `external_ref` and `first_seen_at`.
- **Slice 27**: Invoice schema + form — first FK from invoices to customers.
- **Slice 28**: Invoice PDF + email send (reuses Resend infra from slice 25).
- **Slice 29**: Payments + balance tracking — audit-logged via slice 24.
- **Slice 30**: WinJewel invoice history import.

---

## Design summary table

| Concern | Choice |
|---|---|
| Schema | One table `customers`, org-scoped, slice-3 invariant |
| Address | `jsonb` column with structured shape (street1/street2/city/state/zip/country) |
| Customer type | `name` (always) + optional `business_name`; UI headline = business ?? name |
| Required fields | `name` only; everything else nullable |
| WinJewel future-proofing | `external_ref` (idempotency anchor) + `first_seen_at` (CustomerSince) |
| Indexes | `(org_id, created_at DESC)` + partial unique on `(org_id, external_ref)` |
| Search | `ILIKE` across name/business/email/phone; no full-text index in slice 22 |
| Authz | Owner-only writes; SQL `org_id = $viewer` for reads; defense-in-depth on UPDATEs |
| UI | New `/customers` admin route, table + form, sidebar nav entry |
| Right-rail panel | Defer to slice 24 (Activity Feed) |
| Demo mode | `DEMO_CUSTOMERS` authored constant (3 entries) |
| Security posture | Zod input validation at the boundary; React-escaped output everywhere; multi-tenant invariant enforced at every write + read; HTML sanitization libraries unnecessary because user data is never rendered as HTML |
