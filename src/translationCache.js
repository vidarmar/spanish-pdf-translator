// translationCache.js
// Saves finished page translations in this browser (IndexedDB), so the same
// page text is never sent to the paid translation API twice — even after a
// reload, or when the same PDF is opened again later.
//
// Entries are keyed by a SHA-256 hash of the page text. Bump CACHE_VERSION if
// the translation model or prompt changes and old results should be redone.
// Nothing here leaves the device. If IndexedDB is unavailable (some private
// browsing modes), every function quietly does nothing and the app just
// translates as before.

const DB_NAME = "pdfTranslator";
const STORE = "translations";
const CACHE_VERSION = "v1";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req?.result);
          tx.onerror = tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

async function keyFor(text) {
  // Normalise whitespace so trivial layout differences still hit the cache.
  const normalised = text.replace(/\s+/g, " ").trim();
  const bytes = new TextEncoder().encode(`${CACHE_VERSION}\n${normalised}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the saved translation for this text, or null. */
export async function getCachedTranslation(text) {
  try {
    const key = await keyFor(text);
    const entry = await run("readonly", (s) => s.get(key));
    return entry?.translation || null;
  } catch {
    return null;
  }
}

/** Saves a finished translation for this text. */
export async function saveTranslation(text, translation) {
  if (!translation) return;
  try {
    const key = await keyFor(text);
    await run("readwrite", (s) => s.put({ translation, savedAt: Date.now() }, key));
    notifyChange();
  } catch {
    /* saving is best-effort */
  }
}

/** Number of saved page translations. */
export async function countCachedTranslations() {
  return (await run("readonly", (s) => s.count())) ?? 0;
}

/** Deletes every saved translation in this browser. */
export async function clearTranslationCache() {
  await run("readwrite", (s) => s.clear());
  notifyChange();
}

const listeners = new Set();
/** Call `fn` whenever the cache contents change. */
export function onCacheChange(fn) {
  listeners.add(fn);
}
function notifyChange() {
  for (const fn of listeners) fn();
}
