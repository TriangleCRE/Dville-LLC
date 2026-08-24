/* =========================================================================
   Shared session-cookie check for API routes, mirroring the token scheme
   in /api/login.js and /middleware.js (timestamp + HMAC of that timestamp,
   keyed by PASSCODE). middleware.js already gates every non-/api/login
   request at the edge; this is the same check run again inside the
   function itself, so an API route is never reachable on the strength of
   the edge layer alone.
   ========================================================================= */
const crypto = require("crypto");

const COOKIE_NAME = "dville_session";

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function requireSession(req) {
  const secret = process.env.PASSCODE;
  if (!secret) return false;
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac("sha256", secret).update(exp).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { requireSession, COOKIE_NAME };
