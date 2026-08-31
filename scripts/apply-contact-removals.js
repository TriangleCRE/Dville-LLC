#!/usr/bin/env node
/* =========================================================================
   scripts/apply-contact-removals.js — manual/local use only.

   Deletes records someone decided shouldn't be in the dashboard at all
   (see api/_lib/contactRemovals.json — currently just Thomas, an owner of
   Triangle rather than an outreach target). Only ever deletes a row whose
   content still matches its guard exactly, so a record someone has since
   edited (a real phone number found, a note added) is left alone for a
   person to remove by hand instead of being silently discarded. The live
   site now does this automatically on first use too (see api/_lib/db.js's
   ensureReady) — this script is here for checking/fixing a database by
   hand if needed.

   Usage:
     DATABASE_URL=postgres://... node scripts/apply-contact-removals.js
   ========================================================================= */
const { makePool, ensureSchema, applyContactRemovals, getConnectionString } = require("../api/_lib/db");

async function main() {
  if (!getConnectionString()) {
    console.error("Set DATABASE_URL (or POSTGRES_URL) before running this script.");
    process.exit(1);
  }
  const pool = makePool();
  try {
    await ensureSchema(pool);
    await applyContactRemovals(pool);
    console.log("✓ Applied the contact-removals list.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Removal failed:", err);
  process.exit(1);
});
