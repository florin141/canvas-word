// PDF → 150-DPI page PNGs + extracted text lines, all in Node.
//
// pdfjs-dist renders through @napi-rs/canvas (its own optional Node canvas
// backend), so no browser and no Python are involved. The scale is exactly
// `dpi / 72` — a PDF point is 1/72 inch — and the pixel size is `Math.ceil`ed,
// matching how the reference harness sizes its page rasters (and the same
// convention the editor's canvas uses for fractional CSS pixels).
//
// Output (one directory per render, scorable by lib/compare.mjs):
//   page_0001.png …      RGBA pages (the comparator flattens them onto white)
//   pages.json           [{ index, number, width, height, lines }]
//   result.json          { status, dpi, pages, sha256, engine, pdf }
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { DPI, pageName, sha256File, writeResult } from "./lib/files.mjs";

const require = createRequire(import.meta.url);
const PDFJS_ROOT = dirname(require.resolve("pdfjs-dist/package.json"));
const PDFJS_MODULE = join(PDFJS_ROOT, "legacy", "build", "pdf.mjs");

/** Standard-font data directory, with the forward-slash trailing separator pdf.js
 *  requires (it validates the URL string, so a Windows backslash is rejected). */
export const STANDARD_FONTS = `${join(PDFJS_ROOT, "standard_fonts").replaceAll("\\", "/")}/`;

export const PDFJS_VERSION = require("pdfjs-dist/package.json").version;

/**
 * Group pdf.js text items into reading-order lines. `hasEOL` marks a line's end
 * (the same signal the text layer uses), which is more faithful than clustering
 * by y for multi-column pages.
 */
export function textLines(items) {
  const lines = [];
  let current = "";
  for (const item of items) {
    if (typeof item?.str !== "string") continue;
    current += item.str;
    if (item.hasEOL) {
      const line = current.trim();
      if (line) lines.push(line);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail) lines.push(tail);
  return lines;
}

async function loadPdfjs() {
  // The legacy build is the Node-compatible one (the default build assumes a
  // browser's DOMMatrix/Path2D); it still auto-loads @napi-rs/canvas in Node.
  const pdfjs = await import(pathToFileURL(PDFJS_MODULE).href);
  if (!globalThis.DOMMatrix) {
    const canvas = await import("@napi-rs/canvas");
    globalThis.DOMMatrix = canvas.DOMMatrix;
    globalThis.DOMPoint = canvas.DOMPoint ?? globalThis.DOMPoint;
    globalThis.DOMRect = canvas.DOMRect ?? globalThis.DOMRect;
  }
  return pdfjs;
}

/**
 * Rasterize `pdfPath` into `outDir` at `dpi`, writing page PNGs plus the text
 * metadata. Returns `{ pages, result }`; `result` is also written to result.json.
 */
export async function rasterizePdf({
  pdfPath,
  outDir,
  dpi = DPI,
  sha256 = null,
  engine = `pdfjs-dist ${PDFJS_VERSION}`,
}) {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error(`Invalid raster DPI: ${dpi}`);
  await mkdir(outDir, { recursive: true });
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await readFile(pdfPath));
  const loading = pdfjs.getDocument({
    data,
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
  });
  const document = await loading.promise;
  const scale = dpi / 72;
  const pages = [];
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = createCanvas(width, height);
      await page.render({ canvas, viewport }).promise;
      await writeFile(join(outDir, pageName(number - 1)), canvas.toBuffer("image/png"));
      const text = await page.getTextContent();
      pages.push({
        index: number - 1,
        number,
        width,
        height,
        lines: textLines(text.items),
      });
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  const result = {
    status: "ok",
    dpi,
    pages: pages.length,
    sha256: sha256 ?? (await sha256File(pdfPath)),
    engine,
    pdf: pdfPath,
  };
  await writeFile(join(outDir, "pages.json"), `${JSON.stringify(pages, null, 2)}\n`);
  await writeResult(outDir, result);
  return { pages, result };
}
