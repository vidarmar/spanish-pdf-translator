// translateClient.js
// Sends extracted page text to the /api/translate serverless function, which
// proxies to the Claude API. The Anthropic API key stays server-side — the
// browser never sees it (see /api/translate.js).

import { getAuthHeader, handleUnauthorized } from "./auth.js";

const MAX_RETRIES = 2;
const MAX_CONCURRENT_REQUESTS = 3;

let activeRequests = 0;
const queue = [];

function runNext() {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS || queue.length === 0) return;
  const { task, resolve, reject } = queue.shift();
  activeRequests++;
  task()
    .then(resolve, reject)
    .finally(() => {
      activeRequests--;
      runNext();
    });
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });
}

/**
 * Translate a single chunk of Spanish text to English.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function translateText(text) {
  if (!text || !text.trim()) return "";

  return enqueue(async () => {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-app-auth": getAuthHeader() },
          body: JSON.stringify({ text, sourceLang: "es", targetLang: "en" }),
        });

        if (res.status === 401) {
          // Signed out or password changed: don't retry, show the sign-in
          // screen again.
          handleUnauthorized();
          const unauthorized = new Error("Not signed in — please sign in and add the PDF again");
          unauthorized.noRetry = true;
          throw unauthorized;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Translation request failed (${res.status}): ${body}`);
        }

        const data = await res.json();

        // Defense in depth: a 200 OK response with no usable translation
        // used to be treated as "done, nothing to show" — the page would
        // silently stay blank forever with no error anywhere, which looked
        // identical to the request never having happened at all. Treat it
        // as a real failure instead so it's surfaced to the user rather
        // than hidden.
        if (!data.translation || !data.translation.trim()) {
          throw new Error(
            `Translation service returned an empty result${data.error ? `: ${data.error}` : ""}`
          );
        }

        return data.translation;
      } catch (err) {
        lastError = err;
        if (err.noRetry) break;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
    }
    throw lastError;
  });
}

/**
 * Translate every page of a document, reporting progress as each page finishes.
 * @param {Array<{ pageNumber: number, text: string }>} pages
 * @param {{ onPageTranslated?: (pageNumber: number, translation: string) => void }} [opts]
 */
export async function translatePages(pages, opts = {}) {
  const { onPageTranslated } = opts;
  const results = await Promise.all(
    pages.map(async (page) => {
      const translation = await translateText(page.text);
      onPageTranslated?.(page.pageNumber, translation);
      return { pageNumber: page.pageNumber, translation };
    })
  );
  return results;
}
