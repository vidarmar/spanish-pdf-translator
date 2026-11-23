// api/_auth.js
// Shared sign-in check for the serverless functions. The leading underscore
// tells Vercel this is a helper, not an endpoint of its own.
//
// Accounts live in ONE Vercel environment variable, APP_USERS, written as
//   username:password,username2:password2
// (no commas inside passwords; the first ":" separates name from password).
// Change or remove a person there and redeploy to revoke their access.

import { timingSafeEqual } from "node:crypto";

function loadUsers() {
  const raw = process.env.APP_USERS || "";
  const users = new Map();
  for (const entry of raw.split(",")) {
    const i = entry.indexOf(":");
    if (i <= 0) continue;
    const name = entry.slice(0, i).trim().toLowerCase();
    const pass = entry.slice(i + 1).trim();
    if (name && pass) users.set(name, pass);
  }
  return users;
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing similar on a length mismatch
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Reads the x-app-auth header (base64 of "username:password") and checks it
 * against APP_USERS. Returns the username on success, or null.
 */
export function checkCredentials(req) {
  const header = req.headers["x-app-auth"];
  if (typeof header !== "string" || !header) return null;

  let decoded;
  try {
    decoded = Buffer.from(header, "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i <= 0) return null;
  const name = decoded.slice(0, i).trim().toLowerCase();
  const pass = decoded.slice(i + 1);

  const expected = loadUsers().get(name);
  if (!expected) {
    safeEqual(pass, pass);
    return null;
  }
  return safeEqual(pass, expected) ? name : null;
}

/**
 * Call at the top of every endpoint that costs money. Sends the error
 * response itself and returns false if the request isn't signed in.
 */
export async function requireAuth(req, res) {
  if (loadUsers().size === 0) {
    // Fail closed: with no accounts configured, nobody gets in.
    res.status(500).json({ error: "Sign-in is not set up: add APP_USERS in Vercel → Settings → Environment Variables" });
    return false;
  }
  if (checkCredentials(req)) return true;

  // Small delay on a wrong password to slow down guessing.
  await new Promise((r) => setTimeout(r, 1000));
  res.status(401).json({ error: "Wrong username or password" });
  return false;
}
