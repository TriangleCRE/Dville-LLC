/* =========================================================================
   /api/records
   The dashboard's data API, backed by Postgres (see api/_lib/db.js).
   Sits behind the same passcode session as the rest of the site — see
   api/_lib/auth.js and middleware.js.

   GET    /api/records                     -> { actions, questions, contacts, orgs, promos }
   POST   /api/records   { kind, record }  -> create one record (server assigns the id)
   POST   /api/records   { reset: true }   -> wipe + reload the canonical seed data
   PUT    /api/records?kind=&id=  <record> -> update one record
   PUT    /api/records   { actions, ... }  -> bulk-replace the whole dataset (import a backup)
   DELETE /api/records?kind=&id=           -> delete one record
   ========================================================================= */
const { requireSession } = require("./_lib/auth");
const {
  makePool,
  ensureReady,
  nextRecordId,
  seedAll,
  withTransaction,
  KIND_TO_LIST,
  LIST_TO_KIND,
} = require("./_lib/db");

const VALID_KINDS = Object.keys(KIND_TO_LIST);

let pool;
function getPool() {
  if (!pool) pool = makePool();
  return pool;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  return body && typeof body === "object" ? body : {};
}

function emptyDataset() {
  return { actions: [], questions: [], contacts: [], orgs: [], promos: [] };
}

async function loadDataset(db) {
  const { rows } = await db.query("SELECT kind, data FROM records ORDER BY id ASC");
  const out = emptyDataset();
  for (const row of rows) {
    const listKey = KIND_TO_LIST[row.kind];
    if (listKey) out[listKey].push(row.data);
  }
  return out;
}

async function handleGet(db, res) {
  res.status(200).json(await loadDataset(db));
}

async function handlePost(db, req, res) {
  const body = parseBody(req);

  if (body.reset === true) {
    await withTransaction(db, async (client) => {
      await client.query("DELETE FROM records");
      await seedAll(client);
    });
    res.status(200).json(await loadDataset(db));
    return;
  }

  const { kind, record } = body;
  if (!VALID_KINDS.includes(kind) || !record || typeof record !== "object" || Array.isArray(record)) {
    res.status(400).json({ ok: false, error: "Invalid kind or record" });
    return;
  }
  const id = await nextRecordId(db, kind);
  const toInsert = Object.assign({}, record, { id });
  await db.query("INSERT INTO records (kind, record_id, data) VALUES ($1,$2,$3)", [
    kind,
    id,
    JSON.stringify(toInsert),
  ]);
  res.status(201).json(toInsert);
}

async function bulkReplace(db, body) {
  await withTransaction(db, async (client) => {
    await client.query("DELETE FROM records");
    for (const listKey of Object.values(KIND_TO_LIST)) {
      const kind = LIST_TO_KIND[listKey];
      const list = Array.isArray(body[listKey]) ? body[listKey] : [];
      for (const rec of list) {
        if (!rec || typeof rec !== "object" || !rec.id) continue;
        await client.query("INSERT INTO records (kind, record_id, data) VALUES ($1,$2,$3)", [
          kind,
          String(rec.id),
          JSON.stringify(rec),
        ]);
      }
    }
  });
}

async function handlePut(db, req, res) {
  const query = req.query || {};
  const kind = typeof query.kind === "string" ? query.kind : undefined;
  const id = typeof query.id === "string" ? query.id : undefined;

  if (!kind && !id) {
    // Bulk-replace path: PUT /api/records with the whole { actions, questions, ... } shape.
    const body = parseBody(req);
    const looksLikeDataset = ["actions", "questions", "contacts", "orgs", "promos"].some((k) =>
      Array.isArray(body[k])
    );
    if (!looksLikeDataset) {
      res.status(400).json({ ok: false, error: "Missing kind/id, and body isn't a full dataset" });
      return;
    }
    await bulkReplace(db, body);
    res.status(200).json(await loadDataset(db));
    return;
  }

  if (!VALID_KINDS.includes(kind) || !id) {
    res.status(400).json({ ok: false, error: "Invalid kind or id" });
    return;
  }
  const record = parseBody(req);
  const toSave = Object.assign({}, record, { id }); // id is authoritative from the URL, never the body
  const result = await db.query(
    "UPDATE records SET data=$1, updated_at=now() WHERE kind=$2 AND record_id=$3 RETURNING data",
    [JSON.stringify(toSave), kind, id]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }
  res.status(200).json(result.rows[0].data);
}

async function handleDelete(db, req, res) {
  const query = req.query || {};
  const kind = typeof query.kind === "string" ? query.kind : undefined;
  const id = typeof query.id === "string" ? query.id : undefined;
  if (!VALID_KINDS.includes(kind) || !id) {
    res.status(400).json({ ok: false, error: "Missing kind or id" });
    return;
  }
  const result = await db.query("DELETE FROM records WHERE kind=$1 AND record_id=$2", [kind, id]);
  if (result.rowCount === 0) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }
  res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (!requireSession(req)) {
    res.status(401).json({ ok: false, error: "Not signed in" });
    return;
  }

  let db;
  try {
    db = getPool();
    await ensureReady(db);
  } catch (e) {
    console.error("records: database unavailable", e);
    res.status(503).json({ ok: false, error: "Database unavailable" });
    return;
  }

  try {
    if (req.method === "GET") return await handleGet(db, res);
    if (req.method === "POST") return await handlePost(db, req, res);
    if (req.method === "PUT") return await handlePut(db, req, res);
    if (req.method === "DELETE") return await handleDelete(db, req, res);
    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("records: request failed", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
};
