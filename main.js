// main.js
// Wires up the UI: file input / drag-drop / folder picker, the processing
// pipeline (extract text -> OCR fallback -> translate), the document viewer,
// search, and export.

// Only modules with no external/CDN dependency are imported statically.
// pdfProcessor.js, ocr.js, and exportDocx.js each pull a library from a CDN
// (pdf.js, Tesseract.js, docx) — if any one of those CDN loads fails, we
// don't want it to take the whole app down. They're loaded lazily via
// loadModule() below, the first time they're actually needed, so a failure
// in one (e.g. the DOCX export library) can never block basic functionality
// like selecting or dragging in a PDF.
import { translatePages } from "./translateClient.js";
import { indexPage, removeDocument as removeFromSearchIndex, search } from "./searchIndex.js";

const moduleCache = new Map();

/**
 * Dynamically import a local module the first time it's needed, caching the
 * result. Throws a clear error (surfaced to the user) if the module — or a
 * CDN dependency it imports — fails to load.
 * @param {string} path
 */
async function loadModule(path) {
  if (moduleCache.has(path)) return moduleCache.get(path);
  try {
    const mod = await import(path);
    moduleCache.set(path, mod);
    return mod;
  } catch (err) {
    console.error(`Failed to load module ${path}:`, err);
    throw new Error(
      `Could not load a required library (${path}). This is usually a network/CDN issue — check your internet connection, try disabling any ad blocker or content blocker for this site, or try a different browser. (${err.message})`
    );
  }
}

/** @typedef {{
 *   id: string,
 *   name: string,
 *   status: "processing" | "translating" | "done" | "error",
 *   errorMessage?: string,
 *   pages: Array<{ pageNumber: number, original: string, translation: string, needsOcr: boolean }>,
 * }} DocState */

/** @type {Map<string, DocState>} */
const documents = new Map();
let activeDocId = null;
let viewMode = "side-by-side";

const el = {
  dropZone: document.getElementById("drop-zone"),
  pickFilesBtn: document.getElementById("pick-files-btn"),
  pickFolderBtn: document.getElementById("pick-folder-btn"),
  fileInput: document.getElementById("file-input"),
  folderSupportNote: document.getElementById("folder-support-note"),
  documentList: document.getElementById("document-list"),
  viewerEmpty: document.getElementById("viewer-empty"),
  viewerContent: document.getElementById("viewer-content"),
  viewerTitle: document.getElementById("viewer-title"),
  viewerStatus: document.getElementById("viewer-status"),
  pagesContainer: document.getElementById("pages-container"),
  viewModeSelect: document.getElementById("view-mode-select"),
  exportBtn: document.getElementById("export-docx-btn"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
};

init();

function init() {
  if (!("showDirectoryPicker" in window)) {
    el.pickFolderBtn.hidden = true;
    el.folderSupportNote.hidden = false;
  }

  el.pickFilesBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => {
    handleFiles([...el.fileInput.files]);
    el.fileInput.value = "";
  });
  el.pickFolderBtn.addEventListener("click", pickFolder);

  ["dragenter", "dragover"].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.add("drag-active");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove("drag-active");
    })
  );
  el.dropZone.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    handleFiles(files);
  });

  el.viewModeSelect.addEventListener("change", () => {
    viewMode = el.viewModeSelect.value;
    renderActiveDocument();
  });

  el.exportBtn.addEventListener("click", async () => {
    const doc = documents.get(activeDocId);
    if (!doc) return;
    el.exportBtn.disabled = true;
    el.exportBtn.textContent = "Exporting…";
    try {
      const { exportDocumentAsDocx } = await loadModule("./exportDocx.js");
      await exportDocumentAsDocx(
        {
          name: doc.name,
          pages: doc.pages.map((p) => ({
            pageNumber: p.pageNumber,
            original: p.original,
            translation: p.translation,
          })),
        },
        { mode: viewMode === "translation-only" ? "translation-only" : "side-by-side" }
      );
    } catch (err) {
      console.error(err);
      alert(`Export failed: ${err.message}`);
    } finally {
      el.exportBtn.disabled = false;
      el.exportBtn.textContent = "Export as .docx";
    }
  });

  let searchDebounce;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(el.searchInput.value), 150);
  });
}

async function pickFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const files = [];
    for await (const entry of walkDirectory(dirHandle)) {
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".pdf")) {
        files.push(await entry.getFile());
      }
    }
    if (files.length === 0) {
      alert("No PDF files found in that folder.");
      return;
    }
    handleFiles(files);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      alert(`Could not read that folder: ${err.message}`);
    }
  }
}

async function* walkDirectory(dirHandle) {
  for await (const [, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      yield handle;
    } else if (handle.kind === "directory") {
      yield* walkDirectory(handle);
    }
  }
}

function handleFiles(files) {
  for (const file of files) {
    const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
    const doc = { id, name: file.name, status: "processing", pages: [] };
    documents.set(id, doc);
    renderDocumentList();
    if (!activeDocId) setActiveDocument(id);
    processDocument(id, file);
  }
}

async function processDocument(id, file) {
  const doc = documents.get(id);
  try {
    renderStatusIfActive(id, "Loading PDF library…");
    const { processPdfFile } = await loadModule("./pdfProcessor.js");

    const { pages } = await processPdfFile(file, {
      onProgress: () => {
        renderStatusIfActive(id, "Extracting text…");
      },
    });

    doc.pages = pages.map((p) => ({
      pageNumber: p.pageNumber,
      original: p.text,
      translation: "",
      needsOcr: p.needsOcr,
    }));
    renderDocumentList();
    renderActiveDocument();

    // OCR any pages that had no extractable text layer.
    const pagesNeedingOcr = pages.filter((p) => p.needsOcr);
    if (pagesNeedingOcr.length > 0) {
      renderStatusIfActive(id, "Loading OCR library…");
    }
    const { ocrImage } = pagesNeedingOcr.length > 0 ? await loadModule("./ocr.js") : {};
    for (const [i, p] of pages.entries()) {
      if (p.needsOcr) {
        renderStatusIfActive(id, `Running OCR on page ${p.pageNumber}…`);
        const text = await ocrImage(p.imageDataUrl);
        doc.pages[i].original = text;
        renderActiveDocument();
      }
    }

    doc.status = "translating";
    renderDocumentList();
    renderStatusIfActive(id, "Translating…");

    await translatePages(doc.pages, {
      onPageTranslated: (pageNumber, translation) => {
        const page = doc.pages.find((p) => p.pageNumber === pageNumber);
        if (page) {
          page.translation = translation;
          indexPage(doc.id, doc.name, pageNumber, page.original, translation);
          renderActiveDocument();
        }
      },
    });

    doc.status = "done";
  } catch (err) {
    console.error(err);
    doc.status = "error";
    doc.errorMessage = err.message || String(err);
  } finally {
    renderDocumentList();
    // If the document errored out before any pages were even created (e.g.
    // a CDN library failed to load, or PDF extraction itself failed), there
    // are no page blocks for a per-page error to show up in — so also put
    // the error in the status line, which is always visible regardless of
    // how far processing got.
    renderStatusIfActive(id, doc.status === "error" ? `⚠ ${doc.errorMessage}` : "", doc.status === "error");
    // Re-render the viewer so a translation failure replaces any stuck
    // "Translating…" placeholders with a visible error instead of leaving
    // pages looking like they're still in progress forever.
    renderActiveDocument();
  }
}

function setActiveDocument(id) {
  activeDocId = id;
  renderDocumentList();
  renderActiveDocument();
}

function renderDocumentList() {
  el.documentList.innerHTML = "";
  for (const doc of documents.values()) {
    const li = document.createElement("li");
    li.className = "document-item" + (doc.id === activeDocId ? " active" : "");
    li.innerHTML = `
      <div class="doc-name">${escapeHtml(doc.name)}</div>
      <div class="doc-status${doc.status === "error" ? " error" : ""}">${statusLabel(doc)}</div>
    `;
    li.addEventListener("click", () => setActiveDocument(doc.id));
    el.documentList.appendChild(li);
  }
}

function statusLabel(doc) {
  switch (doc.status) {
    case "processing":
      return "Reading PDF…";
    case "translating":
      return "Translating…";
    case "done":
      return `Done · ${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"}`;
    case "error":
      return `Error: ${doc.errorMessage}`;
    default:
      return "";
  }
}

function renderStatusIfActive(id, message, isError = false) {
  if (id === activeDocId) {
    el.viewerStatus.textContent = message;
    el.viewerStatus.classList.toggle("viewer-status-error", isError);
  }
}

function renderActiveDocument() {
  const doc = documents.get(activeDocId);
  if (!doc) {
    el.viewerEmpty.hidden = false;
    el.viewerContent.hidden = true;
    return;
  }

  el.viewerEmpty.hidden = true;
  el.viewerContent.hidden = false;
  el.viewerTitle.textContent = doc.name;
  el.exportBtn.disabled = doc.pages.length === 0;

  // What to show in a translation slot that has no text yet: still in
  // progress ("Translating…"), or explain why it'll never fill in
  // (translation failed for the document).
  const pendingLabel =
    doc.status === "error"
      ? `Translation failed: ${escapeHtml(doc.errorMessage || "unknown error")}`
      : "Translating…";
  const pendingClass = doc.status === "error" ? "pending error" : "pending";

  el.pagesContainer.innerHTML = "";
  for (const page of doc.pages) {
    const block = document.createElement("div");
    block.className = "page-block";

    const columnsClass = viewMode === "side-by-side" ? "page-columns" : "page-columns single-column";
    let columnsHtml = "";
    if (viewMode === "side-by-side") {
      columnsHtml = `
        <div class="page-columns ${viewMode === "side-by-side" ? "" : "single-column"}">
          <div>
            <h3>Original (Spanish)</h3>
            <div class="page-text">${escapeHtml(page.original) || "<span class=\"page-text pending\">(no text)</span>"}</div>
          </div>
          <div>
            <h3>Translation (English)</h3>
            <div class="page-text ${page.translation ? "" : pendingClass}">${
        escapeHtml(page.translation) || pendingLabel
      }</div>
          </div>
        </div>
      `;
    } else if (viewMode === "translation-only") {
      columnsHtml = `
        <div class="page-columns single-column">
          <div>
            <h3>Translation (English)</h3>
            <div class="page-text ${page.translation ? "" : pendingClass}">${
        escapeHtml(page.translation) || pendingLabel
      }</div>
          </div>
        </div>
      `;
    } else {
      columnsHtml = `
        <div class="page-columns single-column">
          <div>
            <h3>Original (Spanish)</h3>
            <div class="page-text">${escapeHtml(page.original) || "(no text)"}</div>
          </div>
        </div>
      `;
    }

    block.innerHTML = `<div class="page-number">Page ${page.pageNumber}</div>${columnsHtml}`;
    el.pagesContainer.appendChild(block);
  }
}

function runSearch(query) {
  const results = search(query);
  el.searchResults.innerHTML = "";
  if (!query.trim()) return;
  if (results.length === 0) {
    el.searchResults.innerHTML = `<div class="note">No matches.</div>`;
    return;
  }
  for (const r of results) {
    const div = document.createElement("div");
    div.className = "search-result";
    div.innerHTML = `<span class="doc-name">${escapeHtml(r.docName)} · p.${r.pageNumber}</span>${r.snippetHtml}`;
    div.addEventListener("click", () => setActiveDocument(r.docId));
    el.searchResults.appendChild(div);
  }
}

window.addEventListener("beforeunload", () => {
  for (const doc of documents.values()) removeFromSearchIndex(doc.id);
});

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
