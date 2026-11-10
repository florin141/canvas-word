// Directory comparator: reference/actual page PNGs → score.json + HTML gallery.
//
// Rules (mirroring the reference office-quality harness):
//   • Grayscale SSIM at 150 DPI, no resampling.
//   • Missing or extra pages contribute 0 to the page-penalized mean.
//   • Page dimensions must match exactly, except a right/bottom edge difference
//     of at most one pixel, which is white-padded/cropped without moving content.
//   • Source hashes must agree when both renders record one.
//   • Text alignment is a secondary metric; it never rewrites the primary score.
import { join } from "node:path";
import {
  DPI,
  pageFiles,
  pathExists,
  readJson,
  writeJson,
} from "./files.mjs";
import { differencePng, grayscale, padWhite, readRgba, whiteRgba, writePng } from "./png.mjs";
import { ssim } from "./ssim.mjs";
import { alignPages } from "./text.mjs";

function sameSize(reference, actual) {
  return reference.width === actual.width && reference.height === actual.height;
}

function withinOnePixel(reference, actual) {
  return (
    Math.abs(reference.width - actual.width) <= 1 &&
    Math.abs(reference.height - actual.height) <= 1
  );
}

function padGray(gray, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) return gray;
  const out = new Uint8Array(targetWidth * targetHeight).fill(255);
  const copyWidth = Math.min(width, targetWidth);
  const copyHeight = Math.min(height, targetHeight);
  for (let y = 0; y < copyHeight; y += 1) {
    out.set(gray.subarray(y * width, y * width + copyWidth), y * targetWidth);
  }
  return out;
}

async function renderMetadata(dir) {
  const path = join(dir, "result.json");
  return (await pathExists(path)) ? readJson(path) : {};
}

/** Rows of extracted text for a render directory, or null when unavailable. */
async function pageText(dir) {
  const flat = join(dir, "pages_text.json");
  if (await pathExists(flat)) {
    const pages = await readJson(flat);
    if (Array.isArray(pages)) return pages.map((page) => page.map(String));
  }
  const rich = join(dir, "pages.json");
  if (await pathExists(rich)) {
    const pages = await readJson(rich);
    if (Array.isArray(pages)) return pages.map((page) => (page.lines ?? []).map(String));
  }
  return null;
}

function validateMetadata(reference, actual, dpi, referencePages, actualPages) {
  for (const [name, metadata, pages] of [
    ["reference", reference, referencePages],
    ["actual", actual, actualPages],
  ]) {
    if (metadata.status !== undefined && metadata.status !== "ok") {
      throw new Error(`${name} render did not complete successfully`);
    }
    if (metadata.dpi !== undefined && metadata.dpi !== dpi) {
      throw new Error(`${name} DPI ${metadata.dpi} does not match --dpi ${dpi}`);
    }
    if (metadata.pages !== undefined && metadata.pages !== pages) {
      throw new Error(`${name} page count ${metadata.pages} does not match ${pages} page files`);
    }
  }
  const left = reference.sha256;
  const right = actual.sha256;
  if (left && right && left !== right) {
    throw new Error("reference and actual come from different source documents");
  }
}

async function scorePair(referencePath, actualPath) {
  const [reference, actual] = await Promise.all([readRgba(referencePath), readRgba(actualPath)]);
  const referenceSize = [reference.width, reference.height];
  const actualSize = [actual.width, actual.height];
  if (!sameSize(reference, actual) && !withinOnePixel(reference, actual)) {
    return {
      ssim: 0,
      size_note: `size mismatch: ${referenceSize.join("x")} vs ${actualSize.join("x")}`,
      reference_size: referenceSize,
      actual_size: actualSize,
    };
  }
  const referenceGray = grayscale(reference.rgba, reference.width, reference.height);
  let actualGray = grayscale(actual.rgba, actual.width, actual.height);
  let sizeNote = null;
  if (!sameSize(reference, actual)) {
    actualGray = padGray(actualGray, actual.width, actual.height, reference.width, reference.height);
    sizeNote = "white pad/crop at right/bottom edge";
  }
  return {
    ssim: ssim(referenceGray, actualGray, reference.width, reference.height),
    size_note: sizeNote,
    reference_size: referenceSize,
    actual_size: actualSize,
  };
}

function scoreKey(referencePath, actualPath) {
  return `${referencePath}\u0000${actualPath}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function writeGallery(outDir, rows, referencePages, actualPages, viewerHref) {
  const gallery = [];
  for (const row of rows) {
    const prefix = `page_${String(row.page).padStart(4, "0")}`;
    const referencePath = referencePages[row.page - 1];
    const actualPath = actualPages[row.page - 1];
    const reference = referencePath ? await readRgba(referencePath) : null;
    const actual = actualPath ? await readRgba(actualPath) : null;
    const width = reference?.width ?? actual?.width;
    const height = reference?.height ?? actual?.height;
    const referenceRgba = reference ? padWhite(reference.rgba, reference.width, reference.height, width, height).rgba : whiteRgba(width, height);
    const actualRgba = actual ? padWhite(actual.rgba, actual.width, actual.height, width, height).rgba : whiteRgba(width, height);
    await writePng(join(outDir, `${prefix}.reference.png`), referenceRgba, width, height);
    await writePng(join(outDir, `${prefix}.actual.png`), actualRgba, width, height);
    await writePng(join(outDir, `${prefix}.diff.png`), differencePng(referenceRgba, actualRgba, width, height), width, height);
    const caption =
      row.ssim === null
        ? `Page ${row.page}: missing or extra`
        : `Page ${row.page}: SSIM ${row.ssim.toFixed(4)}${row.size_note ? ` (${row.size_note})` : ""}`;
    gallery.push({ caption, prefix });
  }
  const cards = gallery
    .map(
      ({ caption, prefix }) =>
        `<h2>${escapeHtml(caption)}</h2><section>` +
        `<figure><figcaption>Reference</figcaption><img loading="lazy" src="${prefix}.reference.png"></figure>` +
        `<figure><figcaption>Actual</figcaption><img loading="lazy" src="${prefix}.actual.png"></figure>` +
        `<figure><figcaption>Difference ×4</figcaption><img loading="lazy" src="${prefix}.diff.png"></figure>` +
        `</section>`,
    )
    .join("");
  const html =
    `<!doctype html><meta charset="utf-8"><title>Office comparison</title>` +
    `<style>body{font:16px system-ui;margin:24px}section{display:flex;gap:16px;flex-wrap:wrap}` +
    `figure{margin:0;width:30%;min-width:220px}img{width:100%;border:1px solid #ccc}figcaption{margin:8px 0}` +
    `h2{margin-top:32px;font-size:15px}</style><h1>Office comparison</h1>` +
    (viewerHref ? `<p><a href="${escapeHtml(viewerHref)}">Open interactive viewer</a></p>` : "") +
    `<p>${escapeHtml(`${rows.length} page${rows.length === 1 ? "" : "s"} compared.`)}</p>${cards}`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(outDir, "index.html"), html);
}

/**
 * Compare two render directories. Returns the score report and (when `gallery`)
 * writes page_*.{reference,actual,diff}.png plus index.html into `outDir`.
 */
export async function compareDirectories({
  referenceDir,
  actualDir,
  outDir,
  dpi = DPI,
  gallery = true,
  viewerHref = null,
}) {
  const referencePages = await pageFiles(referenceDir);
  const actualPages = await pageFiles(actualDir);
  if (referencePages.length === 0) throw new Error("reference has no pages");

  const [reference, actual] = await Promise.all([
    renderMetadata(referenceDir),
    renderMetadata(actualDir),
  ]);
  validateMetadata(reference, actual, dpi, referencePages.length, actualPages.length);

  const [referenceText, actualText] = await Promise.all([pageText(referenceDir), pageText(actualDir)]);
  const matches =
    referenceText &&
    actualText &&
    referenceText.length === referencePages.length &&
    actualText.length === actualPages.length
      ? alignPages(referenceText, actualText)
      : [];

  const common = Math.min(referencePages.length, actualPages.length);
  const pairs = [];
  for (let index = 0; index < common; index += 1) {
    pairs.push([referencePages[index], actualPages[index]]);
  }
  for (const [index, match] of matches.entries()) {
    if (match.page && index < referencePages.length && match.page <= actualPages.length) {
      pairs.push([referencePages[index], actualPages[match.page - 1]]);
    }
  }

  const scores = new Map();
  for (const [referencePath, actualPath] of pairs) {
    const key = scoreKey(referencePath, actualPath);
    if (scores.has(key)) continue;
    scores.set(key, await scorePair(referencePath, actualPath));
  }

  const rows = [];
  let total = 0;
  let commonTotal = 0;
  for (let index = 0; index < Math.max(referencePages.length, actualPages.length); index += 1) {
    const expected = index < referencePages.length;
    const rendered = index < actualPages.length;
    let score;
    if (expected && rendered) {
      score = scores.get(scoreKey(referencePages[index], actualPages[index]));
      commonTotal += score.ssim;
    } else {
      score = { ssim: 0, size_note: "missing or extra page", reference_size: null, actual_size: null };
    }
    total += score.ssim;
    const match = index < matches.length ? matches[index] : undefined;
    const alignedPage = match?.page ?? null;
    const aligned = alignedPage ? scores.get(scoreKey(referencePages[index], actualPages[alignedPage - 1])) : null;
    rows.push({
      page: index + 1,
      ssim: score.ssim,
      size_note: score.size_note,
      reference_size: score.reference_size,
      actual_size: score.actual_size,
      aligned_page: alignedPage,
      break_agrees: match?.startsAtBreak ?? false,
      aligned_ssim: aligned ? aligned.ssim : null,
    });
  }

  const alignedScores = rows.map((row) => row.aligned_ssim).filter((value) => value !== null);
  const agreement = rows
    .slice(0, referencePages.length)
    .filter((row) => row.aligned_page === row.page && row.break_agrees).length;
  const firstDivergence = rows
    .slice(0, referencePages.length)
    .find(
      (row) =>
        row.page > actualPages.length ||
        (row.aligned_page !== null &&
          (row.aligned_page !== row.page || !row.break_agrees)),
    );

  const report = {
    reference_pages: referencePages.length,
    actual_pages: actualPages.length,
    common_page_ssim: common > 0 ? commonTotal / common : 0,
    penalized_ssim: total / Math.max(referencePages.length, actualPages.length),
    aligned_mean_ssim: alignedScores.length > 0 ? alignedScores.reduce((sum, value) => sum + value, 0) / alignedScores.length : 0,
    aligned_pages: alignedScores.length,
    first_divergence_page: firstDivergence ? firstDivergence.page : null,
    page_agreement: agreement,
    page_agreement_fraction: referencePages.length > 0 ? agreement / referencePages.length : 0,
    break_agreement: rows.slice(0, referencePages.length).filter((row) => row.break_agrees).length,
    source_verified: Boolean(reference.sha256 && actual.sha256 && reference.sha256 === actual.sha256),
    resized: false,
    reference,
    actual,
    pages: rows,
  };

  await writeJson(join(outDir, "score.json"), report);
  if (gallery) await writeGallery(outDir, rows, referencePages, actualPages, viewerHref);
  return report;
}

/** Reject a comparison that must not be published. */
export function validateComparison(report) {
  if (
    report.source_verified !== true ||
    report.reference?.status !== "ok" ||
    report.actual?.status !== "ok" ||
    typeof report.reference.sha256 !== "string" ||
    !report.reference.sha256 ||
    report.reference.sha256 !== report.actual.sha256 ||
    !Number.isFinite(report.penalized_ssim) ||
    Math.abs(report.penalized_ssim) > 1 ||
    report.resized === true
  ) {
    throw new Error("Cannot publish an incomplete or mismatched comparison");
  }
  return report;
}
