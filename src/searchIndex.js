// searchIndex.js
// A small in-memory full-text search over translated (and original) page text
// across every document processed in this session. Deliberately simple —
// substring matching with snippet extraction — so it needs no extra library.

/** @typedef {{ docId: string, docName: string, pageNumber: number, original: string, translation: string }} IndexedPage */

/** @type {IndexedPage[]} */
let pages = [];

export function clearIndex() {
  pages = [];
}

export function removeDocument(docId) {
  pages = pages.filter((p) => p.docId !== docId);
}

/**
 * @param {string} docId
 * @param {string} docName
 * @param {number} pageNumber
 * @param {string} original
 * @param {string} translation
 */
export function indexPage(docId, docName, pageNumber, original, translation) {
  const existing = pages.find((p) => p.docId === docId && p.pageNumber === pageNumber);
  if (existing) {
    existing.original = original;
    existing.translation = translation;
    existing.docName = docName;
  } else {
    pages.push({ docId, docName, pageNumber, original, translation });
  }
}

function makeSnippet(text, query, contextChars = 60) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const before = escapeHtml(text.slice(start, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length, end));
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/**
 * @param {string} query
 * @returns {Array<{ docId: string, docName: string, pageNumber: number, field: "translation"|"original", snippetHtml: string }>}
 */
export function search(query) {
  const q = query.trim();
  if (q.length < 2) return [];

  const results = [];
  for (const page of pages) {
    const translationSnippet = makeSnippet(page.translation || "", q);
    if (translationSnippet) {
      results.push({
        docId: page.docId,
        docName: page.docName,
        pageNumber: page.pageNumber,
        field: "translation",
        snippetHtml: translationSnippet,
      });
      continue; // prefer one hit per page in results list
    }
    const originalSnippet = makeSnippet(page.original || "", q);
    if (originalSnippet) {
      results.push({
        docId: page.docId,
        docName: page.docName,
        pageNumber: page.pageNumber,
        field: "original",
        snippetHtml: originalSnippet,
      });
    }
  }
  return results.slice(0, 50);
}
