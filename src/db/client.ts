import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

// The generated migrations in ./drizzle are the single source of truth for the
// schema. The local pglite (dev + tests) applies them via the migrator, so there
// is no hand-maintained DDL that could drift out of sync with schema.ts or the
// committed migration.
const MIGRATIONS_FOLDER = "drizzle";

let singleton: Db | null = null;

export function getDb(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (url) {
    singleton = drizzleNeon(neon(url), { schema });
  } else {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    // Best-effort local bootstrap so a fresh dev machine works without a manual migrate step.
    void migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    singleton = db;
  }
  return singleton;
}

/** Fresh, isolated, migrated in-memory pglite for a single test. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

export { sql };
