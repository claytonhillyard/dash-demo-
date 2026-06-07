-- schema-only; no seed data in this migration.
-- inventory_bids.quantity_requested defaults to 1 — backfills slice-18
-- rows with the semantically-correct "1 unit" interpretation. Demo seeds
-- live in src/lib/demo/seed.ts and never touch the DB.
-- See docs/superpowers/plans/2026-06-07-aiya-inventory-bid-fulfillment-slice-18b.md.
ALTER TABLE "inventory_bids" ADD COLUMN "quantity_requested" integer DEFAULT 1 NOT NULL;