// PDF channel: headless import → PDF export → 150-DPI raster.
//
// The production pipeline is TypeScript, so it is bundled into
// `.source/office-quality/build/pdf-entry.mjs` with esbuild (the same bundle
// strategy as scripts/build-node.mjs) and imported from there. The bundled
// metric-clone fonts are copied next to the bundle because measureHost resolves
// `new URL("./fonts/<file>", import.meta.url)` through node:fs.
//
// Output directory (scorable by lib/compare.mjs):
//   page_0001.png …   rasterized PDF pages
//   pages.json        extracted text lines
//   result.json       status/dpi/pages/source sha + model and timing metadata
//   export.pdf        the intermediate PDF (kept for inspection)
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import {
  DPI,
  FRONTEND_ROOT,
  REPO_ROOT,
  SOURCE_ROOT,
  isEmptyDir,
  readJson,
  sha256File,
  writeResult,
} from "./lib/files.mjs";
import { PDFJS_VERSION, rasterizePdf } from "./rasterize.mjs";

const ENTRY = fileURLToPath(new URL("./pdf-entry.ts", import.meta.url));
const BUILD_DIR = join(SOURCE_ROOT, "build");
const BUNDLE = join(BUILD_DIR, "pdf-entry.mjs");
const FONTS_SOURCE = join(FRONTEND_ROOT, "src", "export", "shared", "fonts");
const FONTS_TARGET = join(BUILD_DIR, "fonts");
const SHARED = join(REPO_ROOT, "shared", "src", "index.ts");

let pipelinePromise = null;
let versionPromise = null;

function frontendVersion() {
  versionPromise ??= readJson(join(FRONTEND_ROOT, "package.json")).then((pkg) => pkg.version);
  return versionPromise;
}

/** Bundle (once) and import the Node pipeline entry. */
export function loadPipeline() {
  pipelinePromise ??= (async () => {
    await mkdir(BUILD_DIR, { recursive: true });
    await build({
      entryPoints: [ENTRY],
      outfile: BUNDLE,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      splitting: false,
      sourcemap: false,
      alias: { "@cw/shared": SHARED },
      // pdfkit/fontkit/fflate are bundled so the output is self-contained; node
      // builtins stay external under platform "node". pdfkit is CJS and requires
      // stream/zlib, so synthesize a require shim (mirrors build-node.mjs).
      banner: {
        js: [
          'import { createRequire as __createRequire } from "node:module";',
          "const require = __createRequire(import.meta.url);",
        ].join("\n"),
      },
      logLevel: "silent",
    });
    // measureHost reads ./fonts/<file> relative to the bundle via node:fs.
    await cp(FONTS_SOURCE, FONTS_TARGET, { recursive: true });
    return import(`${pathToFileURL(BUNDLE).href}?v=${Date.now()}`);
  })();
  return pipelinePromise;
}

/** Import a source .docx in Node; shared by the PDF channel and capture's block check. */
export async function importSource(source) {
  const pipeline = await loadPipeline();
  const bytes = new Uint8Array(await readFile(source));
  const started = performance.now();
  const imported = pipeline.importDocx(bytes);
  return { ...imported, importMs: performance.now() - started };
}

/**
 * Render the PDF channel for `source` into `outDir` and rasterize it. Pass a
 * pre-imported document to avoid importing the same file twice in one run.
 */
export async function renderPdfChannel({ source, outDir, dpi = DPI, imported = null } = {}) {
  const pipeline = await loadPipeline();
  const model = imported ?? (await importSource(source));
  const exportStarted = performance.now();
  const pdfBytes = await pipeline.exportPdf(model.doc, model.images);
  const exportMs = performance.now() - exportStarted;
  await mkdir(outDir, { recursive: true });
  const pdfPath = join(outDir, "export.pdf");
  await writeFile(pdfPath, pdfBytes);
  const rasterStarted = performance.now();
  const { result } = await rasterizePdf({
    pdfPath,
    outDir,
    dpi,
    sha256: await sha256File(source),
    engine: `canvas-word ${await frontendVersion()} (pdfjs-dist ${PDFJS_VERSION})`,
  });
  result.model_blocks = model.blockCount;
  result.warnings = model.warnings.length;
  result.pdf_bytes = pdfBytes.length;
  result.timings = {
    import_ms: Math.round(model.importMs ?? 0),
    export_ms: Math.round(exportMs),
    raster_ms: Math.round(performance.now() - rasterStarted),
  };
  await writeResult(outDir, result);
  return { dir: outDir, pdfPath, result, model };
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        source: { type: "string" },
        out: { type: "string" },
        dpi: { type: "string" },
        force: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`usage: pdf-channel.mjs --source <docx> --out <dir> [--dpi 150] [--force]\n${error.message}`);
    process.exit(2);
    return;
  }
  if (!values.source || !values.out) {
    console.error("usage: pdf-channel.mjs --source <docx> --out <dir> [--dpi 150] [--force]");
    process.exit(2);
    return;
  }
  const dpi = values.dpi ? Number(values.dpi) : DPI;
  try {
    if (!values.force && !(await isEmptyDir(values.out))) {
      throw new Error(`Output directory must be empty: ${values.out}`);
    }
    const result = await renderPdfChannel({ source: values.source, outDir: values.out, dpi });
    console.log(
      `[office-quality] pdf ${result.result.pages} pages, ${result.result.pdf_bytes} PDF bytes, ${result.result.timings.export_ms} ms export → ${values.out}`,
    );
  } catch (error) {
    console.error(`[office-quality] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
