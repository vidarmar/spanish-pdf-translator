// api/login.js
// Checks a username/password without translating anything (so it costs no
// AI credits). The browser calls this from the sign-in screen.

import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!(await requireAuth(req, res))) return;
  res.status(200).json({ ok: true });
}
