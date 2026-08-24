#!/usr/bin/env node
/* =========================================================================
   scripts/migrate.js — manual/local use only.

   Creates the `records` table (and its index) if they don't already
   exist. Safe to run any number of times. The live site does this
   automatically on first use (see api/_lib/db.js's ensureReady) — this
   script exists for setting up a local/dev database by hand.

   Usage:
     DATABASE_URL=postgres://... node scripts/migrate.js
   ========================================================================= */
const { makePool, ensureSchema, getConnectionString } = require("../api/_lib/db");

async function main() {
  if (!getConnectionString()) {
    console.error("Set DATABASE_URL (or POSTGRES_URL) before running this script.");
    process.exit(1);
  }
  const pool = makePool();
  try {
    await ensureSchema(pool);
    console.log("✓ records table is ready.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
