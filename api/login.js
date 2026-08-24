/* =========================================================================
   POST /api/login
   Checks the submitted passcode against the PASSCODE environment variable
   on the server and, if it matches, sets a signed session cookie. The
   passcode itself is never sent to the browser or embedded in any
   front-end code — only this function (and the Edge Middleware that reads
   the resulting cookie) ever sees it, via process.env.
   ========================================================================= */
const crypto = require("crypto");

const COOKIE_NAME = "dville_session";
// Safety-net cap on the token's validity. The cookie itself is set with no
// Max-Age/Expires, so browsers already drop it at the end of the browsing
// session — this just bounds how long a copied cookie value would work.
const SESSION_MS = 24 * 60 * 60 * 1000;

function hmacHex(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/* Constant-time-ish string compare: pad both to the same length so
   timingSafeEqual never throws on a length mismatch, then separately
   confirm the real lengths matched. */
function safeEqual(a, b) {
  const abuf = Buffer.from(String(a), "utf8");
  const bbuf = Buffer.from(String(b), "utf8");
  const len = Math.max(abuf.length, bbuf.length, 1);
  const apad = Buffer.concat([abuf, Buffer.alloc(len - abuf.length)]);
  const bpad = Buffer.concat([bbuf, Buffer.alloc(len - bbuf.length)]);
  return crypto.timingSafeEqual(apad, bpad) && abuf.length === bbuf.length;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false });
    return;
  }

  const secret = process.env.PASSCODE;
  if (!secret) {
    // Misconfigured deployment (env var not set) — fail closed, no details leaked.
    res.status(500).json({ ok: false });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const entered = body && typeof body.passcode === "string" ? body.passcode : "";

  if (!entered || !safeEqual(entered, secret)) {
    res.status(401).json({ ok: false });
    return;
  }

  const exp = Date.now() + SESSION_MS;
  const token = exp + "." + hmacHex(secret, String(exp));
  const cookie = [
    COOKIE_NAME + "=" + token,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
  res.status(200).json({ ok: true });
};
