# Spanish → English PDF Translator

Translate Spanish PDFs to English in the browser, search across everything you've translated, and export the result to a `.docx` file. Runs as a static web app with a single small serverless function.

## How it works

- **Input:** drag & drop PDFs, pick individual files, or (in Chrome/Edge) browse a folder on your PC directly via the File System Access API.
- **Text extraction:** [pdf.js](https://mozilla.github.io/pdf.js/) reads each page's text layer in the browser. Pages with no usable text (scanned/photocopied pages) are rasterized and run through [Tesseract.js](https://tesseract.projectnaught.com/) OCR — also entirely client-side.
- **Translation:** extracted text is sent to `/api/translate`, a tiny serverless function that forwards the request to the Claude API and returns the English translation. This is the *only* server-side piece — it exists so your Anthropic API key never has to sit in browser code.
- **Search:** every translated page is indexed in memory so you can full-text search across all documents processed in the current session.
- **Export:** translations are packaged into a `.docx` file (original/English side-by-side per page) client-side using the `docx` library — no server round trip.

No build step, no bundler, no framework — plain ES modules loaded via `<script type="module">`, with `pdfjs-dist`, `tesseract.js`, and `docx` pulled from CDN (jsDelivr / esm.sh) at runtime in the user's own browser.

## Project layout

```
index.html              Page shell / layout
styles.css               Styles
src/main.js               UI wiring + processing pipeline orchestration
src/pdfProcessor.js       PDF text extraction via pdf.js, detects scanned pages
src/ocr.js                Tesseract.js OCR for scanned pages
src/translateClient.js    Calls /api/translate, handles retries/concurrency
src/searchIndex.js        In-memory full-text search over translated pages
src/exportDocx.js         Builds and downloads the .docx export
api/translate.js          Serverless proxy to the Claude API (holds the API key)
vercel.json               Deployment config
```

## Running it locally

This needs a real HTTP server (not `file://`) because ES module imports and the File System Access API both require it, and the translate endpoint needs a serverless runtime.

The easiest path is the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npm i -g vercel
vercel dev
```

Set your Anthropic API key first:

```bash
vercel env add ANTHROPIC_API_KEY development
```

(Or create a `.env.local` file with `ANTHROPIC_API_KEY=sk-ant-...` — `vercel dev` picks it up automatically.)

Then open the local URL it prints.

## Deploying

1. Push this folder to a GitHub repo.
2. Import it in [Vercel](https://vercel.com/new) (or any host that supports static sites + serverless/edge functions — Netlify Functions and Cloudflare Pages Functions work the same way with minor path/config differences).
3. In the project's environment variables, add `ANTHROPIC_API_KEY` with your Claude API key.
4. Deploy. The static frontend and `/api/translate` function ship together.

## Why no bundler / build step

This scaffold was written in this cloud session, which has restricted outbound network access (it can't reach `registry.npmjs.org`, `unpkg.com`, etc.), so `npm install` for a bundler like Vite wasn't possible here. Rather than block on that, the app was built as plain ES modules loading `pdfjs-dist`, `tesseract.js`, and `docx` from CDN at runtime — which needs no local install and will work fine once opened in a real browser with normal internet access (your machine's network isn't restricted the way this session's is). If you'd rather have a bundled TypeScript/React version with local dependencies pinned in `node_modules`, that's a reasonable follow-up once you're working from an environment that can reach npm.

## Notes and known limitations (good next steps)

- **Browser support for folder browsing:** the File System Access API (`showDirectoryPicker`) is Chromium-only (Chrome, Edge). Safari/Firefox users still get drag-and-drop and the file picker, just not folder browsing.
- **Session-only storage:** documents, translations, and the search index currently live only in memory for the current browser tab — refreshing the page clears them. Adding `IndexedDB` persistence would let translated documents survive reloads and be searchable across visits.
- **Very large pages:** `/api/translate` caps requests at 12,000 characters per call as a cost guard. Extremely text-dense pages would need to be chunked before translation — not yet implemented.
- **Cost/rate limiting:** there's currently no per-user rate limiting on `/api/translate`. Before sharing this publicly, add basic abuse protection (e.g. Vercel's rate limiting, or a simple token-bucket check).
- **PDF export:** DOCX is the recommended/only export format right now. A PDF export option (e.g. via `pdf-lib`) would be a natural addition if users want to keep the output as a PDF.
