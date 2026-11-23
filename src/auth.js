// auth.js
// Sign-in screen for the translator. Credentials are checked by the server
// (/api/login, /api/translate); this file only shows the form and remembers
// the sign-in in this browser so you don't have to type it every visit.

const STORAGE_KEY = "pdfTranslator.auth";
let authHeader = "";

const el = {
  overlay: document.getElementById("login-overlay"),
  form: document.getElementById("login-form"),
  user: document.getElementById("login-username"),
  pass: document.getElementById("login-password"),
  remember: document.getElementById("login-remember"),
  error: document.getElementById("login-error"),
  submit: document.getElementById("login-submit"),
  signOut: document.getElementById("sign-out-btn"),
  who: document.getElementById("signed-in-as"),
};

function encode(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function store(value, persistent) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (value) (persistent ? localStorage : sessionStorage).setItem(STORAGE_KEY, value);
  } catch {
    /* storage blocked: sign-in just lasts until the tab closes */
  }
}

function load() {
  try {
    return localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function usernameFromHeader(h) {
  try {
    const bin = atob(h);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).split(":")[0];
  } catch {
    return "";
  }
}

function showSignedIn() {
  el.overlay.hidden = true;
  el.signOut.hidden = false;
  el.who.textContent = `Signed in as ${usernameFromHeader(authHeader)}`;
  el.who.hidden = false;
}

function showLogin(message = "") {
  el.overlay.hidden = false;
  el.signOut.hidden = true;
  el.who.hidden = true;
  el.error.textContent = message;
  el.error.hidden = !message;
  el.pass.value = "";
  (el.user.value ? el.pass : el.user).focus();
}

/** Header value sent with every translation request. */
export function getAuthHeader() {
  return authHeader;
}

/** Called by translateClient.js when the server answers 401. */
export function handleUnauthorized() {
  authHeader = "";
  store("", false);
  showLogin("Your sign-in is no longer valid. Please sign in again.");
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = el.user.value.trim();
  const pass = el.pass.value;
  if (!user || !pass) return;

  const header = encode(user, pass);
  el.submit.disabled = true;
  el.submit.textContent = "Signing in…";
  el.error.hidden = true;
  try {
    const res = await fetch("/api/login", { method: "POST", headers: { "x-app-auth": header } });
    if (res.ok) {
      authHeader = header;
      store(header, el.remember.checked);
      showSignedIn();
    } else {
      const body = await res.json().catch(() => ({}));
      showLogin(body.error || `Sign-in failed (${res.status})`);
    }
  } catch (err) {
    showLogin(`Could not reach the server: ${err.message}`);
  } finally {
    el.submit.disabled = false;
    el.submit.textContent = "Sign in";
  }
});

el.signOut.addEventListener("click", () => {
  authHeader = "";
  store("", false);
  el.user.value = "";
  showLogin();
});

// On page load: reuse a remembered sign-in if there is one. If it has since
// been changed in Vercel, the first translation gets a 401 and the sign-in
// screen comes back automatically.
authHeader = load();
if (authHeader) showSignedIn();
else showLogin();
