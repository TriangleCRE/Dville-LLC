/* =========================================================================
   Shared Postgres access for the dashboard's records.
   Used by api/records.js (self-healing on every cold start) and by
   scripts/migrate.js + scripts/seed.js (manual/local use).
   ========================================================================= */
const { Pool } = require("pg");
const seedData = require("./seedData");
const contactMetadata = require("./contactMetadata.json");

function getConnectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    null
  );
}

function makePool() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error("No database connection string set (DATABASE_URL / POSTGRES_URL)");
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  return new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 5,
  });
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS records (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, record_id)
);
CREATE INDEX IF NOT EXISTS records_kind_idx ON records (kind);
`;

async function ensureSchema(db) {
  await db.query(CREATE_SQL);
}

async function isEmpty(db) {
  const { rows } = await db.query("SELECT 1 FROM records LIMIT 1");
  return rows.length === 0;
}

/* kind (internal) <-> the list keys the front end already uses in S */
const KIND_TO_LIST = {
  action: "actions",
  question: "questions",
  contact: "contacts",
  org: "orgs",
  promo: "promos",
};
const LIST_TO_KIND = Object.fromEntries(Object.entries(KIND_TO_LIST).map(([k, v]) => [v, k]));

const KIND_TO_SEED = {
  action: seedData.SEED_ACTIONS,
  question: seedData.SEED_QUESTIONS,
  contact: seedData.SEED_CONTACTS,
  org: seedData.SEED_ORGS,
  promo: seedData.SEED_PROMOS,
};

/* One id prefix per kind for manually-created records, matching the
   scheme the front end always used for its "+ New ..." buttons. */
const PREFIX = { action: "X", question: "QX", contact: "CX", org: "MX", promo: "PX" };

async function seedAll(db) {
  for (const [kind, list] of Object.entries(KIND_TO_SEED)) {
    for (const rec of list) {
      await db.query(
        "INSERT INTO records (kind, record_id, data) VALUES ($1,$2,$3) ON CONFLICT (kind, record_id) DO NOTHING",
        [kind, rec.id, JSON.stringify(rec)]
      );
    }
  }
}

async function nextRecordId(db, kind) {
  const prefix = PREFIX[kind];
  const { rows } = await db.query("SELECT record_id FROM records WHERE kind=$1", [kind]);
  const seen = new Set(rows.map((r) => r.record_id));
  let n = 1;
  while (seen.has(prefix + String(n).padStart(2, "0"))) n++;
  return prefix + String(n).padStart(2, "0");
}

/* Fills in priority/reliability/sourceNote/sourceUrl on contacts that
   predate those fields (i.e. were seeded before this feature existed),
   using the same best-guess metadata the seed data itself now ships with.
   Only ever sets a field that's currently missing/empty, so it can never
   overwrite a real edit made through the dashboard. Cheap no-op once
   every contact already has these fields. */
async function backfillContactMetadata(db) {
  const { rows } = await db.query(
    "SELECT record_id, data FROM records WHERE kind='contact' AND (data->>'priority' IS NULL OR data->>'priority'='' OR data->>'reliability' IS NULL OR data->>'reliability'='')"
  );
  for (const row of rows) {
    const meta = contactMetadata[row.record_id];
    if (!meta) continue; // a contact added after the original seed — nothing to backfill from
    const data = row.data;
    const patch = {};
    if (!data.priority) patch.priority = meta.priority;
    if (!data.reliability) patch.reliability = meta.reliability;
    if (!data.sourceNote) patch.sourceNote = meta.sourceNote;
    if (!data.sourceUrl && meta.sourceUrl) patch.sourceUrl = meta.sourceUrl;
    if (Object.keys(patch).length === 0) continue;
    const merged = Object.assign({}, data, patch);
    await db.query(
      "UPDATE records SET data=$1, updated_at=now() WHERE kind='contact' AND record_id=$2",
      [JSON.stringify(merged), row.record_id]
    );
  }
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------
   Self-healing: on first use in a warm serverless instance, make sure the
   table exists and, ONLY if it's completely empty, load the seed data —
   all inside one transaction, so a failure partway through leaves the
   table verifiably empty (never half-seeded) and the next request retries
   cleanly. Memoized per warm instance so healthy requests don't repeat the
   check; the memo is cleared on failure so a transient DB hiccup doesn't
   permanently wedge a warm instance.
   ------------------------------------------------------------------------- */
let readyPromise = null;
function ensureReady(pool) {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureSchema(pool);
      if (await isEmpty(pool)) {
        await withTransaction(pool, (client) => seedAll(client));
      }
      // Runs every time too (not just on a fresh seed), so a database that
      // was already seeded before priority/reliability existed heals itself
      // the same way — no manual backfill script required on the live site.
      await backfillContactMetadata(pool);
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

module.exports = {
  makePool,
  getConnectionString,
  ensureSchema,
  isEmpty,
  seedAll,
  nextRecordId,
  ensureReady,
  backfillContactMetadata,
  withTransaction,
  PREFIX,
  KIND_TO_LIST,
  LIST_TO_KIND,
  KIND_TO_SEED,
};
