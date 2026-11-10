// One-document regression gate — the private-ssim.mjs equivalent.
//
//   node private-ssim.mjs \
//     --source corpus/showcase/source.docx \
//     --reference-pdf private/word.pdf \
//     --out private/run \
//     --baseline private/baseline.json [--write-baseline]
//
// A baseline records one channel's penalized SSIM, page agreement, absolute page
// error, and per-page scores. A later run exits 1 when:
//   • the penalized SSIM drops by more than 0.001,
//   • page agreement drops at all,
//   • absolute page error gets worse, or
//   • any page's SSIM drops by more than 0.005 (the first such page is printed).
// This gate measures the working tree (no dirty guard) — it is meant to be run
// before committing a renderer change.
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { captureCanvas } from "./capture.mjs";
import {
  DPI,
  isEmptyDir,
  isFile,
  readJson,
  sha256File,
  writeJson,
} from "./lib/files.mjs";
import { compareDirectories, validateComparison } from "./lib/compare.mjs";
import { MAX_PAGE_DROP, MAX_SSIM_DROP, regressions } from "./lib/gate.mjs";
import { writeViewer } from "./lib/viewer.mjs";
import { importSource, renderPdfChannel } from "./pdf-channel.mjs";
import { PDFJS_VERSION, rasterizePdf } from "./rasterize.mjs";
import { startServer } from "./serve.mjs";

export const BASELINE_SCHEMA_VERSION = 1;
export { MAX_PAGE_DROP, MAX_SSIM_DROP, regressions };

const errorText = (error) => (error instanceof Error ? error.message : String(error));

function usage(message) {
  console.error(
    `usage: private-ssim.mjs --source <docx> --reference-pdf <pdf> --out <dir>\n` +
      `         [--channel canvas|pdf] [--baseline <json>] [--write-baseline]\n` +
      `         [--dpi 150] [--timeout-seconds N]\n${message ?? ""}`.trimEnd(),
  );
  process.exit(2);
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        source: { type: "string" },
        "reference-pdf": { type: "string" },
        out: { type: "string" },
        channel: { type: "string" },
        baseline: { type: "string" },
        "write-baseline": { type: "boolean" },
        dpi: { type: "string" },
        "timeout-seconds": { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    usage(error.message);
    return;
  }
  if (!values.source || !values["reference-pdf"] || !values.out) {
    usage("--source, --reference-pdf and --out are required");
    return;
  }
  if (values["write-baseline"] && !values.baseline) {
    usage("--write-baseline requires --baseline <json>");
    return;
  }
  const channel = values.channel ?? "canvas";
  if (!["canvas", "pdf"].includes(channel)) {
    usage(`unknown channel "${channel}" (expected canvas or pdf)`);
    return;
  }
  const source = resolve(values.source);
  const referencePdf = resolve(values["reference-pdf"]);
  const outDir = resolve(values.out);
  const baselinePath = values.baseline ? resolve(values.baseline) : null;
  const dpi = values.dpi ? Number(values.dpi) : DPI;
  const timeoutMs = values["timeout-seconds"] ? Number(values["timeout-seconds"]) * 1000 : 900_000;

  for (const [label, path] of [["source", source], ["reference PDF", referencePdf]]) {
    if (!(await isFile(path))) {
      console.error(`[office-quality] ${label} not found: ${path}`);
      process.exit(1);
      return;
    }
  }
  if (!(await isEmptyDir(outDir))) {
    console.error(`[office-quality] output directory must be empty: ${outDir}`);
    process.exit(1);
    return;
  }
  await mkdir(outDir, { recursive: true });

  const sourceSha = await sha256File(source);
  const referencePdfSha = await sha256File(referencePdf);
  let server = null;
  let summary;
  try {
    await rasterizePdf({
      pdfPath: referencePdf,
      outDir: join(outDir, "reference"),
      dpi,
      // The caller asserts this PDF is the source's reference; stamp the source
      // hash so the comparator can verify both renders came from one document.
      sha256: sourceSha,
      engine: `reference PDF (pdfjs-dist ${PDFJS_VERSION})`,
    });
    const imported = await importSource(source);
    let actualDir;
    if (channel === "canvas") {
      server = await startServer({ timeoutMs: Math.min(timeoutMs, 180_000) });
      actualDir = join(outDir, "canvas");
      await captureCanvas({
        source,
        outDir: actualDir,
        url: server.url,
        expectedBlocks: imported.blockCount,
        timeoutMs,
      });
    } else {
      actualDir = join(outDir, "pdf");
      await renderPdfChannel({ source, outDir: actualDir, dpi, imported });
    }
    const comparison = await compareDirectories({
      referenceDir: join(outDir, "reference"),
      actualDir,
      outDir: join(outDir, "compare"),
      dpi,
      gallery: true,
      viewerHref: `../index.html?doc=document&channel=${encodeURIComponent(channel)}`,
    });
    validateComparison(comparison);
    summary = {
      schema_version: BASELINE_SCHEMA_VERSION,
      channel,
      source,
      source_sha256: sourceSha,
      reference_pdf: referencePdf,
      reference_pdf_sha256: referencePdfSha,
      created_at: new Date().toISOString(),
      penalized_ssim: comparison.penalized_ssim,
      common_page_ssim: comparison.common_page_ssim,
      aligned_mean_ssim: comparison.aligned_mean_ssim,
      reference_pages: comparison.reference_pages,
      actual_pages: comparison.actual_pages,
      absolute_page_error: Math.abs(comparison.actual_pages - comparison.reference_pages),
      page_agreement_fraction: comparison.page_agreement_fraction,
      first_divergence_page: comparison.first_divergence_page,
      pages: comparison.pages.map((page) => ({ page: page.page, ssim: page.ssim })),
    };
    await writeViewer(
      outDir,
      {
        commit: sourceSha,
        dirty: false,
        generated_at: summary.created_at,
        settings: { dpi, channels: [channel], reference: "reference PDF" },
        reference_engines: {},
        samples: [
          {
            id: "document",
            title: basename(source),
            channels: [
              {
                channel,
                status: "ok",
                penalized_ssim: comparison.penalized_ssim,
                common_page_ssim: comparison.common_page_ssim,
                aligned_mean_ssim: comparison.aligned_mean_ssim,
                reference_pages: comparison.reference_pages,
                actual_pages: comparison.actual_pages,
                page_agreement_fraction: comparison.page_agreement_fraction,
                first_divergence_page: comparison.first_divergence_page,
                page_ssim: comparison.pages.map((page) => ({
                  page: page.page,
                  ssim: page.ssim,
                  aligned_page: page.aligned_page,
                  size_note: page.size_note,
                  reference_size: page.reference_size,
                  actual_size: page.actual_size,
                })),
              },
            ],
          },
        ],
      },
      { referenceBase: () => "reference", renderBase: () => "compare" },
    );
  } catch (error) {
    console.error(`[office-quality] gate failed: ${errorText(error)}`);
    process.exit(1);
    return;
  } finally {
    if (server) await server.close().catch(() => {});
  }

  console.log(
    `[office-quality] ${channel}: penalized SSIM ${summary.penalized_ssim.toFixed(4)}, ` +
      `${summary.actual_pages}/${summary.reference_pages} pages, ` +
      `page agreement ${(summary.page_agreement_fraction * 100).toFixed(1)}%`,
  );
  for (const page of summary.pages) {
    if (!Number.isFinite(page.ssim)) console.log(`  page ${page.page}: missing`);
  }

  if (values["write-baseline"]) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeJson(baselinePath, summary);
    console.log(`[office-quality] baseline written → ${baselinePath}`);
    return;
  }
  if (!baselinePath) return;

  let baseline;
  try {
    baseline = await readJson(baselinePath);
  } catch {
    console.error(
      `[office-quality] baseline not found: ${baselinePath} (run once with --write-baseline to create it)`,
    );
    process.exit(1);
    return;
  }
  const reasons = regressions(baseline, summary);
  if (reasons.length > 0) {
    console.error("[office-quality] REGRESSION:");
    for (const reason of reasons) console.error(`  • ${reason}`);
    process.exit(1);
    return;
  }
  console.log("[office-quality] no regression against the baseline");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
