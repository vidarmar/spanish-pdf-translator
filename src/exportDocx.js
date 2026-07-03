// exportDocx.js
// Builds a .docx file from a translated document and triggers a download.
// DOCX was chosen as the recommended export format because it preserves
// paragraph structure, is universally editable, and renders a clean
// original/translation layout without needing a server round trip — the
// whole file is generated client-side.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "https://esm.sh/docx@9?bundle";

/**
 * @param {{ name: string, pages: Array<{ pageNumber: number, original: string, translation: string }> }} doc
 * @param {{ mode?: "side-by-side" | "translation-only" }} [opts]
 */
export async function exportDocumentAsDocx(doc, opts = {}) {
  const { mode = "side-by-side" } = opts;

  const children = [
    new Paragraph({
      text: doc.name,
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      text: "Translated from Spanish to English",
      heading: HeadingLevel.HEADING_3,
    }),
  ];

  for (const page of doc.pages) {
    children.push(
      new Paragraph({
        text: `Page ${page.pageNumber}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300 },
      })
    );

    if (mode === "translation-only") {
      children.push(
        new Paragraph({
          children: [new TextRun(page.translation || "(no text)")],
        })
      );
      continue;
    }

    // Side-by-side layout via a two-column, borderless table.
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ text: "Original (Spanish)", heading: HeadingLevel.HEADING_4 }),
                  new Paragraph({ children: [new TextRun(page.original || "(no text)")] }),
                ],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ text: "Translation (English)", heading: HeadingLevel.HEADING_4 }),
                  new Paragraph({ children: [new TextRun(page.translation || "(no text)")] }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  }

  const docxDocument = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(docxDocument);
  downloadBlob(blob, `${sanitizeFilename(doc.name)}-translated.docx`);
}

function sanitizeFilename(name) {
  return name.replace(/\.pdf$/i, "").replace(/[^a-z0-9-_]+/gi, "_");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
