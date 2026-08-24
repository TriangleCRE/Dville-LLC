#!/usr/bin/env node
/* =========================================================================
   scripts/backfill-contact-metadata.js — manual/local use only.

   Fills in `priority`, `reliability`, `sourceNote` and `sourceUrl` on any
   contact rows that predate those fields — safe to re-run, and only ever
   sets a field that's currently missing/empty (never overwrites a real
   edit made through the dashboard). The live site now does this
   automatically on first use too (see api/_lib/db.js's ensureReady) —
   this script is here for checking/fixing a database by hand if needed.

   Usage:
     DATABASE_URL=postgres://... node scripts/backfill-contact-metadata.js
   ========================================================================= */
const { makePool, ensureSchema, backfillContactMetadata, getConnectionString } = require("../api/_lib/db");

async function main() {
  if (!getConnectionString()) {
    console.error("Set DATABASE_URL (or POSTGRES_URL) before running this script.");
    process.exit(1);
  }
  const pool = makePool();
  try {
    await ensureSchema(pool);
    await backfillContactMetadata(pool);
    console.log("✓ Contact priority/reliability metadata is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
