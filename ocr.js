// ocr.js
// Runs OCR on rasterized page images for PDFs that have no extractable text
// layer (scanned documents). Uses Tesseract.js entirely in the browser —
// no server round trip, no image data ever leaves the device.

import { createWorker } from "https://esm.sh/tesseract.js@5?bundle";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("spa"); // Spanish OCR model
  }
  return workerPromise;
}

/**
 * @param {string} imageDataUrl - PNG data URL of the rasterized page
 * @param {{ onProgress?: (progress: number) => void }} [opts]
 * @returns {Promise<string>} recognized text
 */
export async function ocrImage(imageDataUrl, opts = {}) {
  const { onProgress } = opts;
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl, {}, { text: true });
  onProgress?.(1);
  return (data?.text ?? "").trim();
}

/** Free OCR worker resources. Call when the app is done processing PDFs. */
export async function terminateOcr() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
