// pdfProcessor.js
// Loads a PDF file entirely in the browser (via pdf.js) and extracts per-page text.
// Pages that have no meaningful extractable text (i.e. scanned/image-only pages)
// are flagged with `needsOcr: true` and a rendered canvas image is returned so the
// caller can run OCR (see ocr.js) on just those pages.

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";

// A page with fewer than this many non-whitespace characters is treated as
// having no usable text layer and gets routed to OCR instead.
const MIN_TEXT_LENGTH = 8;

// Render scale used when a page needs to be rasterized for OCR. Higher scale
// improves OCR accuracy at the cost of speed/memory.
const OCR_RENDER_SCALE = 2;

/**
 * @param {File|Blob} file
 * @param {{ onProgress?: (info: { stage: string, page: number, pageCount: number }) => void }} [opts]
 * @returns {Promise<{ pageCount: number, pages: Array<{ pageNumber: number, text: string, needsOcr: boolean, imageDataUrl: string|null }> }>}
 */
export async function processPdfFile(file, opts = {}) {
  const { onProgress } = opts;
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress?.({ stage: "extracting-text", page: pageNumber, pageCount: pdf.numPages });

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length >= MIN_TEXT_LENGTH) {
      pages.push({ pageNumber, text, needsOcr: false, imageDataUrl: null });
      continue;
    }

    // No usable text layer — rasterize the page so it can be OCR'd.
    onProgress?.({ stage: "rasterizing", page: pageNumber, pageCount: pdf.numPages });
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const imageDataUrl = canvas.toDataURL("image/png");

    pages.push({ pageNumber, text: "", needsOcr: true, imageDataUrl });
  }

  return { pageCount: pdf.numPages, pages };
}
