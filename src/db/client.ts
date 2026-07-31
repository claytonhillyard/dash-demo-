import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// neon-serverless (over a WebSocket connection) replaces neon-http here
// because neon-http throws at runtime on `db.transaction()` — recordPayment's
// overpay guard (and any future multi-statement write) needs real
// transactions against Neon in production, not just on local pglite.
// neon-serverless needs a WebSocket constructor on Node < 22 (Netlify's
// netlify.toml pins Node 20, which has no global WebSocket); the `ws`
// package supplies it below. This is a no-op wherever a native WebSocket
// already exists (Node 22+, edge runtimes). Neon migrations are unaffected —
// they still run offline via `npm run db:migrate`, never through this module.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  neonConfig.webSocketConstructor = ws;
}

export type Db =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

// The generated migrations in ./drizzle are the single source of truth for the
// schema. The local pglite (dev + tests) applies them via the migrator, so there
// is no hand-maintained DDL that could drift out of sync with schema.ts or the
// committed migration.
const MIGRATIONS_FOLDER = "drizzle";

let singleton: Db | null = null;
let migrationPromise: Promise<void> | null = null;

export function getDb(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (url) {
    singleton = drizzleNeon(new Pool({ connectionString: url }), { schema });
  } else {
    // Desktop builds persist across launches via PGLITE_DATA_DIR (set by desktop/main.js
    // to <userData>/pglite-data); unset (tests/dev) keeps today's in-memory behavior.
    const dataDir = process.env.PGLITE_DATA_DIR;
    const client = new PGlite(dataDir || undefined);
    const db = drizzlePglite(client, { schema });
    // Local pglite bootstrap. We capture (not discard) the migration promise so
    // request paths can await readiness via ensureDbReady() — otherwise the very
    // first query can race ahead of CREATE TABLE. Neon (prod) is migrated offline
    // via `npm run db:migrate`, so there is no promise to await there.
    migrationPromise = migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    singleton = db;
  }
  return singleton;
}

/**
 * Returns the db only after any pending local migration has finished. Use this
 * (instead of getDb()) in request paths that read/write immediately, so the
 * first query never races the local pglite migration. No-op wait under Neon.
 */
export async function ensureDbReady(): Promise<Db> {
  const db = getDb();
  if (migrationPromise) await migrationPromise;
  return db;
}

/** Fresh, isolated, migrated in-memory pglite for a single test. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

export { sql };
