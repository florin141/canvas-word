// Reference PDF generation and caching.
//
// A reference is the same source .docx exported to PDF by an external office
// engine. Generation is expensive (Word COM launches a full Office process), so
// results are cached under `.source/office-quality/references/<engine>/` keyed by
// the source SHA-256: editing the document invalidates its reference, while
// re-runs of the harness reuse it.
//
// Word is the authoritative local oracle (Windows only). LibreOffice is the
// optional CI oracle. The generators are injectable so the cache logic is
// testable without either application installed.
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { HARNESS_ROOT, REPO_ROOT, SOURCE_ROOT, isFile, readJson, sha256File } from "./lib/files.mjs";
import { runProcess } from "./lib/process.mjs";
import { generateLibreOffice } from "./reference-libreoffice.mjs";

export const ENGINES = ["word", "libreoffice"];
export const DEFAULT_CACHE_DIR = join(SOURCE_ROOT, "references");
export const DEFAULT_TIMEOUT_MS = 300_000;

function assertEngine(engine) {
  if (!ENGINES.includes(engine)) {
    throw new Error(`Unknown reference engine "${engine}" (expected ${ENGINES.join(" or ")})`);
  }
}

/** Export with Microsoft Word via COM. Windows only; the marker line carries the version. */
export async function generateWithWord(source, output, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Microsoft Word references require Windows (Word COM). Use --reference libreoffice on this platform.");
  }
  const powershell = process.env.POWERSHELL?.trim() || "powershell.exe";
  const script = join(HARNESS_ROOT, "reference-word.ps1");
  const result = await runProcess(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Source",
      source,
      "-Output",
      output,
    ],
    { timeoutMs },
  );
  if (result.timedOut) throw new Error(`Word export timed out after ${timeoutMs} ms`);
  if (result.code !== 0) {
    throw new Error(`Word export failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`);
  }
  if (!(await isFile(output))) throw new Error("Word export reported success but wrote no PDF");
  const marker = /WORD_VERSION=(.+)/.exec(result.stdout);
  if (!marker) throw new Error("Word export produced no version marker");
  return { version: marker[1].trim() };
}

const GENERATORS = {
  word: generateWithWord,
  libreoffice: (source, output, options) => generateLibreOffice(source, output, options),
};

/**
 * Return a reference PDF for `source`, generating (and caching) it when absent,
 * stale, or `force`d. `cacheDir` is the parent directory; files land in
 * `<cacheDir>/<engine>/<sha256>.{pdf,json}`.
 *
 * Resolves to `{ pdfPath, metadata, cached }`.
 */
export async function resolveReference({
  source,
  engine = "word",
  cacheDir = DEFAULT_CACHE_DIR,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  force = false,
  generators = GENERATORS,
} = {}) {
  assertEngine(engine);
  if (typeof source !== "string" || !(await isFile(source))) {
    throw new Error(`Reference source is missing: ${source}`);
  }
  if (extname(source).toLowerCase() !== ".docx") {
    throw new Error(`Reference source must be a .docx: ${source}`);
  }
  const generate = generators[engine];
  if (typeof generate !== "function") throw new Error(`No generator for reference engine "${engine}"`);

  const digest = await sha256File(source);
  const dir = join(cacheDir, engine);
  const pdfPath = join(dir, `${digest}.pdf`);
  const metadataPath = join(dir, `${digest}.json`);

  if (!force && (await isFile(pdfPath)) && (await isFile(metadataPath))) {
    try {
      const metadata = await readJson(metadataPath);
      if (
        metadata?.status === "ok" &&
        metadata.engine === engine &&
        metadata.source_sha256 === digest &&
        (await stat(pdfPath)).size > 0
      ) {
        return { pdfPath, metadata, cached: true };
      }
    } catch {
      // Corrupt metadata — regenerate below.
    }
  }

  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `${digest}.tmp-${process.pid}.pdf`);
  await rm(temporary, { force: true });
  try {
    const { version } = await generate(source, temporary, { timeoutMs, env: process.env });
    if (!(await isFile(temporary))) throw new Error("Reference generation wrote no PDF");
    if ((await stat(temporary)).size === 0) throw new Error("Reference generation wrote an empty PDF");
    await rename(temporary, pdfPath);
    const metadata = {
      status: "ok",
      engine,
      engine_version: version ?? null,
      source: relative(REPO_ROOT, source).replaceAll("\\", "/"),
      source_sha256: digest,
      pdf: relative(REPO_ROOT, pdfPath).replaceAll("\\", "/"),
      created_at: new Date().toISOString(),
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    return { pdfPath, metadata, cached: false };
  } finally {
    await rm(temporary, { force: true });
  }
}
