#!/usr/bin/env node
/* =========================================================================
   scripts/seed.js — manual/local use only.

   Loads the canonical seed data into the `records` table, but ONLY if the
   table is completely empty — it never overwrites real edits. The live
   site does this automatically on first use (see api/_lib/db.js's
   ensureReady) — this script exists for seeding a local/dev database, or
   for re-checking a production database by hand.

   Usage:
     DATABASE_URL=postgres://... node scripts/seed.js
     DATABASE_URL=postgres://... node scripts/seed.js --force   # wipe + reseed regardless
   ========================================================================= */
const { makePool, ensureSchema, isEmpty, seedAll, withTransaction, getConnectionString } = require("../api/_lib/db");

async function main() {
  if (!getConnectionString()) {
    console.error("Set DATABASE_URL (or POSTGRES_URL) before running this script.");
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  const pool = makePool();
  try {
    await ensureSchema(pool);

    if (force) {
      await withTransaction(pool, async (client) => {
        await client.query("DELETE FROM records");
        await seedAll(client);
      });
      console.log("✓ Cleared existing records and reseeded (--force).");
      return;
    }

    if (await isEmpty(pool)) {
      await withTransaction(pool, (client) => seedAll(client));
      console.log("✓ Table was empty — seeded the canonical data.");
    } else {
      console.log("Table already has data — left untouched. Pass --force to wipe and reseed.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
