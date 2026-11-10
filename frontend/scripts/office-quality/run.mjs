// Visual-quality orchestrator: corpus → Word/LibreOffice reference → canvas + PDF
// channels → SSIM comparison → report.
//
// Every comparison is isolated: one document that fails to import, reference, or
// capture is recorded as a failed channel (with its stage) and the run continues.
// Failed comparisons have no score and are excluded from means; coverage is
// reported alongside the means so a partially-skipped channel cannot look better
// than it is.
//
// Reports are revision-pinned: a run refuses to proceed when frontend/ or shared/
// has tracked modifications, unless --allow-dirty is passed (the report is then
// marked dirty). The output directory must be empty.
import { spawnSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { captureCanvas } from "./capture.mjs";
import { loadManifest, resolveSample, selectSamples } from "./lib/corpus.mjs";
import {
  DPI,
  REPO_ROOT,
  SOURCE_ROOT,
  isEmptyDir,
  isFile,
  sha256File,
  writeJson,
} from "./lib/files.mjs";
import { aggregateReport, renderSection, validateReport } from "./lib/report.mjs";
import { ensureSamples } from "./make-samples.mjs";
import { importSource, renderPdfChannel } from "./pdf-channel.mjs";
import { PDFJS_VERSION, rasterizePdf } from "./rasterize.mjs";
import { resolveReference } from "./reference.mjs";
import { compareDirectories, validateComparison } from "./lib/compare.mjs";
import { writeViewer } from "./lib/viewer.mjs";
import { startServer } from "./serve.mjs";

const DEFAULT_OUT = join(SOURCE_ROOT, "run");
const DEFAULT_TIMEOUT_MS = 900_000;
const CHANNELS = ["canvas", "pdf"];

const posix = (path) => relative(REPO_ROOT, path).split(sep).join("/");
const errorText = (error) => (error instanceof Error ? error.message : String(error));

function gitState() {
  const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no", "--", "frontend", "shared"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return {
    commit: rev.status === 0 ? rev.stdout.trim() : null,
    dirty: status.status === 0 && status.stdout.trim().length > 0,
  };
}

function failed(channel, stage, error) {
  return { channel, status: "failed", stage, error: errorText(error) };
}

const PICKED = [
  "reference_pages",
  "actual_pages",
  "common_page_ssim",
  "penalized_ssim",
  "aligned_mean_ssim",
  "aligned_pages",
  "page_agreement",
  "page_agreement_fraction",
  "break_agreement",
  "first_divergence_page",
  "source_verified",
  "resized",
  "reference",
  "actual",
];

function channelRecord(channel, comparison, compareDir) {
  const record = { channel, status: "ok", compare_dir: posix(compareDir) };
  for (const key of PICKED) record[key] = comparison[key];
  record.page_ssim = comparison.pages.map((page) => ({
    page: page.page,
    ssim: page.ssim,
    aligned_page: page.aligned_page,
    size_note: page.size_note,
    reference_size: page.reference_size,
    actual_size: page.actual_size,
  }));
  return record;
}

async function runSample(sample, { outDir, channels, reference, dpi, timeoutMs, serverUrl, engines }) {
  const record = {
    id: sample.id,
    title: sample.title,
    source: null,
    source_sha256: null,
    source_bytes: null,
    channels: [],
  };
  let source;
  try {
    source = await resolveSample(sample);
  } catch (error) {
    record.channels = channels.map((channel) => failed(channel, "resolve", error));
    return record;
  }
  if (source === null) {
    console.log(`[office-quality] skip ${sample.id}: optional source is absent`);
    return null;
  }
  record.source = posix(source);
  record.source_sha256 = await sha256File(source);
  record.source_bytes = (await stat(source)).size;

  let imported;
  try {
    imported = await importSource(source);
  } catch (error) {
    record.channels = channels.map((channel) => failed(channel, "import", error));
    return record;
  }

  const sampleDir = join(outDir, sample.id);
  let referenceDir;
  try {
    const generated = await resolveReference({ source, engine: reference });
    const version = generated.metadata.engine_version ?? "unknown";
    engines.set(reference, version);
    console.log(
      `[office-quality] ${sample.id}: reference ${generated.cached ? "cached" : "generated"} (${reference} ${version})`,
    );
    referenceDir = join(sampleDir, "reference");
    await rasterizePdf({
      pdfPath: generated.pdfPath,
      outDir: referenceDir,
      dpi,
      sha256: record.source_sha256,
      engine: `${reference} ${version} (pdfjs-dist ${PDFJS_VERSION})`,
    });
  } catch (error) {
    record.channels = channels.map((channel) => failed(channel, "reference", error));
    return record;
  }

  for (const channel of channels) {
    const channelDir = join(sampleDir, channel);
    const stage = channel === "canvas" ? "capture" : "render";
    try {
      if (channel === "canvas") {
        await captureCanvas({
          source,
          outDir: channelDir,
          url: serverUrl,
          expectedBlocks: imported.blockCount,
          timeoutMs,
        });
      } else {
        await renderPdfChannel({ source, outDir: channelDir, dpi, imported });
      }
    } catch (error) {
      record.channels.push(failed(channel, stage, error));
      console.error(`[office-quality] ${sample.id}/${channel}: ${stage} failed — ${errorText(error)}`);
      continue;
    }
    try {
      const compareDir = join(sampleDir, `compare-${channel}`);
      const comparison = await compareDirectories({
        referenceDir,
        actualDir: channelDir,
        outDir: compareDir,
        dpi,
        gallery: true,
        viewerHref: `../../index.html?doc=${encodeURIComponent(sample.id)}&channel=${encodeURIComponent(channel)}`,
      });
      validateComparison(comparison);
      record.channels.push(channelRecord(channel, comparison, compareDir));
      console.log(
        `[office-quality] ${sample.id}/${channel}: SSIM ${comparison.penalized_ssim.toFixed(4)} ` +
          `(${comparison.actual_pages}/${comparison.reference_pages} pages)`,
      );
    } catch (error) {
      record.channels.push(failed(channel, "compare", error));
      console.error(`[office-quality] ${sample.id}/${channel}: compare failed — ${errorText(error)}`);
    }
  }
  return record;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        source: { type: "string" },
        samples: { type: "string" },
        channel: { type: "string" },
        reference: { type: "string" },
        out: { type: "string" },
        dpi: { type: "string" },
        "timeout-seconds": { type: "string" },
        "allow-dirty": { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`usage: run.mjs [--source <docx> | --samples id,id] [--channel canvas|pdf|both]\n` +
      `               [--reference word|libreoffice] [--out <dir>] [--allow-dirty]\n` +
      `               [--timeout-seconds N]\n${error.message}`);
    process.exit(2);
    return;
  }

  const sampleArg = values.samples ?? process.env.QUALITY_SAMPLES ?? "";
  const requestedSamples = sampleArg.trim() ? sampleArg : null;
  const channelArg = values.channel || process.env.QUALITY_CHANNEL || "both";
  const reference = values.reference || process.env.QUALITY_REFERENCE || "word";
  const channels = channelArg === "both" ? CHANNELS : [channelArg];
  const dpi = values.dpi ? Number(values.dpi) : DPI;
  const timeoutMs = values["timeout-seconds"] ? Number(values["timeout-seconds"]) * 1000 : DEFAULT_TIMEOUT_MS;

  let adhoc = null;
  if (values.source) {
    const sourcePath = resolve(values.source);
    if (!(await isFile(sourcePath))) {
      console.error(`[office-quality] source not found: ${sourcePath}`);
      process.exit(1);
      return;
    }
    if (extname(sourcePath).toLowerCase() !== ".docx") {
      console.error(`[office-quality] --source must be a .docx file: ${sourcePath}`);
      process.exit(2);
      return;
    }
    const stem = basename(sourcePath, extname(sourcePath));
    const id =
      stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
      "document";
    adhoc = { id, title: stem, kind: "file", path: sourcePath };
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const outDir = values.out
    ? resolve(values.out)
    : adhoc
      ? join(SOURCE_ROOT, "checks", `${adhoc.id}-${stamp}`)
      : DEFAULT_OUT;

  if (!channels.every((channel) => CHANNELS.includes(channel))) {
    console.error(`[office-quality] unknown channel "${channelArg}" (expected canvas, pdf, or both)`);
    process.exit(2);
    return;
  }
  if (!["word", "libreoffice"].includes(reference)) {
    console.error(`[office-quality] unknown reference "${reference}" (expected word or libreoffice)`);
    process.exit(2);
    return;
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    console.error(`[office-quality] invalid --dpi ${values.dpi}`);
    process.exit(2);
    return;
  }

  const { commit, dirty } = gitState();
  if (!commit) {
    console.error("[office-quality] cannot determine the git revision; run from the repository");
    process.exit(1);
    return;
  }
  if (dirty && !values["allow-dirty"] && !adhoc) {
    console.error(
      "[office-quality] frontend/ or shared/ has tracked modifications; commit them first, " +
        "or pass --allow-dirty to publish a dirty-tree report.",
    );
    process.exit(1);
    return;
  }
  if (adhoc) {
    console.log(
      `[office-quality] ad-hoc document ${adhoc.path}` +
        (dirty ? " (working tree — dirty changes allowed)" : ""),
    );
  }
  if (!(await isEmptyDir(outDir))) {
    console.error(`[office-quality] output directory must be empty: ${outDir}`);
    process.exit(1);
    return;
  }
  await mkdir(outDir, { recursive: true });

  let samples;
  if (adhoc) {
    samples = [adhoc];
    if (requestedSamples) console.log("[office-quality] --source ignores --samples");
  } else {
    try {
      const manifest = await loadManifest();
      samples = selectSamples(manifest, requestedSamples);
      const generators = [...new Set(samples.filter((sample) => sample.kind === "generated").map((sample) => sample.generator))];
      if (generators.length > 0) await ensureSamples({ ids: generators });
    } catch (error) {
      console.error(`[office-quality] ${errorText(error)}`);
      process.exit(1);
      return;
    }
  }

  const engines = new Map();
  let server = null;
  const report = {
    schema_version: 1,
    commit,
    dirty,
    generated_at: new Date().toISOString(),
    settings: { dpi, channels, reference },
    reference_engines: {},
    samples: [],
  };
  try {
    if (channels.includes("canvas")) {
      server = await startServer({ timeoutMs: Math.min(timeoutMs, 180_000) });
      console.log(`[office-quality] dev server ${server.url}`);
    }
    for (const sample of samples) {
      const record = await runSample(sample, {
        outDir,
        channels,
        reference,
        dpi,
        timeoutMs,
        serverUrl: server?.url ?? null,
        engines,
      });
      if (record) report.samples.push(record);
    }
  } finally {
    if (server) await server.close().catch(() => {});
  }

  report.reference_engines = Object.fromEntries(engines);
  if (report.samples.length === 0) {
    console.error("[office-quality] no samples were compared (all optional sources absent?)");
    process.exit(1);
    return;
  }
  const aggregated = aggregateReport(report);
  validateReport(aggregated);
  await writeJson(join(outDir, "report.json"), aggregated);
  const section = renderSection(aggregated);
  await writeFile(join(outDir, "section.md"), section);
  await writeViewer(outDir, aggregated);

  const failures = aggregated.samples.flatMap((sample) =>
    sample.channels.filter((comparison) => comparison.status !== "ok"),
  );
  console.log(`[office-quality] report → ${join(outDir, "report.json")}`);
  console.log(section.trim());
  if (failures.length > 0) {
    console.error(`[office-quality] ${failures.length} comparison(s) failed; see report.json`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
