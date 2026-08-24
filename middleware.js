/* =========================================================================
   Edge Middleware — password gate
   Runs on every request except /api/login (so the login endpoint itself
   stays reachable) and checks for a valid session cookie before letting
   the request continue — to the real static dashboard, or to any other
   /api/* route (e.g. /api/records), which sits behind this same gate.
   Without a valid cookie: an /api/* request gets a plain 401 JSON
   response; anything else gets a self-contained login page served
   directly in place of the real page, so nothing about the dashboard's
   HTML/JS/data is ever revealed pre-auth.
   ========================================================================= */
export const config = {
  matcher: ["/((?!api/login).*)"],
};

const COOKIE_NAME = "dville_session";

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function isValidSession(request, secret) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const expected = await hmacHex(secret, exp);
  return expected === mac;
}

function loginPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Danville Marketing Command Center</title>
<style>
  :root{--green:#1A9E36;--green-dk:#14802B;--ink:#23272B;--ink-2:#3F464D;--muted:#6B7480;--bg:#F2F4F6;--card:#FFFFFF;--line:#E2E6EA;--red:#C2382C;--red-sf:#FBEDEB;--red-bd:#F0C4BE;}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;
    background:var(--bg); color:var(--ink); min-height:100%;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .card{
    width:100%; max-width:360px; background:var(--card); border:1px solid var(--line);
    border-radius:12px; box-shadow:0 12px 34px rgba(16,24,32,.13), 0 3px 8px rgba(16,24,32,.07);
    padding:28px 26px;
  }
  .brand{font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--green-dk); margin:0 0 6px}
  h1{font-size:19px; font-weight:680; letter-spacing:-.01em; margin:0 0 6px}
  .sub{font-size:13px; color:var(--muted); margin:0 0 20px; line-height:1.5}
  label{display:block; font-size:12.5px; font-weight:600; color:var(--ink-2); margin-bottom:6px}
  input[type=password]{
    width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px;
    font-size:15px; background:var(--bg); color:var(--ink); outline:none; letter-spacing:.02em;
  }
  input[type=password]:focus{border-color:var(--green); background:#fff; box-shadow:0 0 0 3px rgba(26,158,54,.12)}
  button{
    width:100%; margin-top:14px; padding:10px 12px; border:none; border-radius:8px;
    background:var(--green); color:#fff; font-size:14px; font-weight:620; cursor:pointer;
    font-family:inherit; transition:.12s;
  }
  button:hover{background:var(--green-dk)}
  button:disabled{opacity:.6; cursor:default}
  .err{
    display:none; margin-top:12px; padding:9px 11px; font-size:12.5px;
    color:var(--red); background:var(--red-sf); border:1px solid var(--red-bd); border-radius:7px;
  }
</style>
</head>
<body>
  <form class="card" id="f" autocomplete="off">
    <div class="brand">Triangle Investments</div>
    <h1>Danville Marketing Command Center</h1>
    <p class="sub">Enter the passcode to continue.</p>
    <label for="passcode">Passcode</label>
    <input type="password" id="passcode" name="passcode" autofocus autocomplete="off">
    <button type="submit" id="go">Continue</button>
    <div class="err" id="err">Incorrect passcode. Try again.</div>
  </form>
  <script>
    var f = document.getElementById('f');
    var btn = document.getElementById('go');
    var err = document.getElementById('err');
    var input = document.getElementById('passcode');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var passcode = input.value;
      if (!passcode) return;
      btn.disabled = true; btn.textContent = 'Checking…'; err.style.display = 'none';
      fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode: passcode })
      })
        .then(function (r) {
          return r.json().catch(function () { return { ok: false }; });
        })
        .then(function (j) {
          if (j.ok) {
            window.location.reload();
          } else {
            btn.disabled = false; btn.textContent = 'Continue';
            err.style.display = 'block'; input.value = ''; input.focus();
          }
        })
        .catch(function () {
          btn.disabled = false; btn.textContent = 'Continue';
          err.style.display = 'block';
        });
    });
  </script>
</body>
</html>`;
}

export default async function middleware(request) {
  const secret = process.env.PASSCODE;
  if (secret && (await isValidSession(request, secret))) {
    return; // valid session — let the request through (to the dashboard, or to /api/*)
  }

  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ ok: false, error: "Not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  return new Response(loginPage(), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
