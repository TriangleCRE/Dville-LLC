#!/usr/bin/env node
/* =========================================================================
   scripts/apply-aug21-update.js — manual/local use only.

   Applies the data changes from Dominique Moccia's 8/21/2026 CubeSmart
   action-items email to an existing database: inserts the handful of new
   action items and the new Professional Supply contact it introduced (only
   if a record with that id doesn't already exist), and guard-patches the
   existing records it resolved or corrected (the target date moving to
   10/13/2026, and what it answered about the Aug 20 call) — but only where
   every field being patched still holds its exact original pre-8/21 value,
   so a real edit already made through the dashboard is never overwritten.
   The live site now does this automatically on first use too (see
   api/_lib/db.js's ensureReady) — this script is here for checking/fixing
   a database by hand if needed.

   Usage:
     DATABASE_URL=postgres://... node scripts/apply-aug21-update.js
   ========================================================================= */
const { makePool, ensureSchema, applyAug21Update, getConnectionString } = require("../api/_lib/db");

async function main() {
  if (!getConnectionString()) {
    console.error("Set DATABASE_URL (or POSTGRES_URL) before running this script.");
    process.exit(1);
  }
  const pool = makePool();
  try {
    await ensureSchema(pool);
    await applyAug21Update(pool);
    console.log("✓ Applied the 8/21 CubeSmart action-items update.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
