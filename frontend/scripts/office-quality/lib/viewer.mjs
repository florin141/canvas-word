// Visual-fidelity comparer, generated from a benchmark report.
//
// The page is a faithful port of BetterOffice's apps/fidelity comparer: same
// sidebar/document list + filter, Swipe/Difference modes, Fit/100% zoom, numbered
// page strip, draggable split handle, hold-B blink and arrow-key paging. The DOM
// and CSS come from that app (the compiled stylesheet and Geist fonts are
// vendored under ./viewer/), so the result is visually identical.
//
// The data model is adapted for this harness: each document carries two
// channels (canvas and PDF) instead of published/commit, and images are read
// from the run's `<sample>/reference/` and `<sample>/compare-<channel>/`
// directories. The report is inlined into the page so it works over file://.
import { aggregateReport } from "./report.mjs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL_ORDER = ["canvas", "pdf"];
const VIEWER_ASSETS = fileURLToPath(new URL("../viewer/", import.meta.url));

function channelLabel(name) {
  return name === "canvas" ? "Canvas" : name === "pdf" ? "PDF" : name;
}

/** Build the object embedded as `window.__QUALITY_DATA__`. */
export function buildViewerData(report, { referenceBase = null, renderBase = null } = {}) {
  const aggregated = report.summary ? report : aggregateReport(report);
  const channels = aggregated.settings?.channels ?? CHANNEL_ORDER;
  const reference = aggregated.settings?.reference ?? "word";
  const documents = (aggregated.samples ?? []).map((sample) => {
    const byChannel = {};
    const sampleReference = referenceBase ? referenceBase(sample) : `${sample.id}/reference`;
    for (const comparison of sample.channels ?? []) {
      if (comparison.status !== "ok") {
        byChannel[comparison.channel] = {
          status: "failed",
          stage: comparison.stage ?? "unknown",
          error: comparison.error ?? "Unknown error",
        };
        continue;
      }
      byChannel[comparison.channel] = {
        status: "ok",
        score: comparison.penalized_ssim,
        common: comparison.common_page_ssim ?? 0,
        referencePages: comparison.reference_pages ?? 0,
        actualPages: comparison.actual_pages ?? 0,
        renderBase: renderBase
          ? renderBase(sample, comparison)
          : `${sample.id}/compare-${comparison.channel}`,
        pages: (comparison.page_ssim ?? []).map((row) => ({
          page: row.page,
          // A page that exists on only one side has no meaningful SSIM; the
          // fidelity app renders it as a dashed "no common page" strip entry.
          ssim: row.size_note === "missing or extra page" ? null : row.ssim,
          width: row.reference_size?.[0] ?? row.actual_size?.[0] ?? null,
          height: row.reference_size?.[1] ?? row.actual_size?.[1] ?? null,
        })),
      };
    }
    const firstOk =
      channels.map((name) => byChannel[name]).find((channel) => channel?.status === "ok") ??
      Object.values(byChannel).find((channel) => channel.status === "ok");
    return {
      id: sample.id,
      title: sample.title ?? sample.id,
      format: "docx",
      referencePages: firstOk?.referencePages ?? 0,
      referenceBase: sampleReference,
      channels: byChannel,
    };
  });
  return {
    commit: aggregated.commit ?? "",
    dirty: Boolean(aggregated.dirty),
    generatedAt: aggregated.generated_at ?? null,
    reference: {
      label:
        reference === "libreoffice"
          ? "LibreOffice"
          : reference === "word"
            ? "Microsoft Word"
            : reference,
      version: aggregated.reference_engines?.[reference] ?? null,
    },
    channels,
    documents,
  };
}

function dataScript(report, options) {
  return JSON.stringify(buildViewerData(report, options)).replace(/</g, "\\u003c");
}

/** The comparer page (BetterOffice's compare.html, adapted to this harness). */
export function renderViewer(report, options = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Compare canvas-word renders against Microsoft Office page by page for any corpus document, with a swipe divider, a difference blend and a blink toggle."
    />
    <title>Visual fidelity · canvas-word</title>
    <link rel="stylesheet" href="./viewer/styles.css" />
  </head>
  <body class="flex h-dvh flex-col overflow-x-clip bg-bg font-sans text-[13px]/[1.5] text-fg antialiased md:flex-row">
    <aside class="flex w-full flex-none flex-col border-b border-line-soft bg-bg max-md:max-h-[33dvh] md:w-[300px] md:border-r md:border-b-0" hidden>
      <header class="border-b border-line-soft px-[18px] pt-[18px] pb-3">
        <a class="mb-2.5 inline-block font-mono text-xs text-ink no-underline transition-colors hover:text-fg" href="./dashboard.html">← benchmarks</a>
        <h1 class="text-[13px] font-semibold tracking-[0.01em]">Visual fidelity</h1>
        <p class="mt-1 mb-3 text-[12px] text-dim" id="revision"></p>
        <input class="w-full border border-line bg-bg px-2 py-1.5 focus:outline-1 focus:outline-fg" id="filter" type="search" placeholder="Filter documents" autocomplete="off" />
      </header>
      <ol class="min-h-0 flex-1 overflow-y-auto pt-1.5 pb-6" id="documents"></ol>
    </aside>

    <main class="flex min-h-0 min-w-0 flex-1 flex-col" hidden>
      <header class="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-line-soft px-5 py-3.5">
        <span class="font-semibold" id="title"></span>
        <div class="flex border border-line" id="modes">
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-mode="swipe" aria-pressed="true">Swipe</button>
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-mode="difference" aria-pressed="false">Difference</button>
        </div>
        <div class="flex border border-line" id="channels">
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-channel="canvas" aria-pressed="true">Canvas</button>
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-channel="pdf" aria-pressed="false">PDF</button>
        </div>
        <div class="flex border border-line" id="zooms">
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-zoom="fit" aria-pressed="true">Fit</button>
          <button class="cursor-pointer px-2.5 py-1 font-mono text-xs text-dim aria-pressed:bg-fg aria-pressed:text-bg" data-zoom="full" aria-pressed="false">100%</button>
        </div>
        <div class="flex flex-wrap gap-x-[18px] gap-y-1 text-dim md:ml-auto" id="scores"></div>
      </header>
      <p class="border-b border-line-soft px-5 py-2 text-ink" id="note" hidden></p>
      <nav class="flex gap-1 overflow-x-auto border-b border-line-soft px-5 py-2.5" id="pages"></nav>
      <div class="grid min-h-0 flex-1 place-items-center overflow-auto p-5" id="stage" data-mode="swipe">
        <div class="sheet" id="sheet">
          <img id="reference" alt="Microsoft Office reference page" />
          <div id="ours"><img id="render" alt="canvas-word rendered page" /></div>
          <div id="handle"></div>
        </div>
      </div>
      <footer class="border-t border-line-soft px-5 py-2 text-dim" id="hint">
        Drag the divider to swipe · hold <kbd class="border border-line px-1 py-px font-sans text-[11px] text-fg">B</kbd> to blink between the two ·
        <kbd class="border border-line px-1 py-px font-sans text-[11px] text-fg">←</kbd> <kbd class="border border-line px-1 py-px font-sans text-[11px] text-fg">→</kbd> to change page
      </footer>
    </main>

    <div class="m-auto max-w-[440px] p-6 text-center" id="loader">
      <h1 class="text-[13px] font-semibold tracking-[0.01em]">Visual fidelity</h1>
      <p class="my-[1em] text-dim" id="loader-message">Loading the measured run…</p>
      <label class="mt-2 inline-block cursor-pointer border border-line px-3.5 py-[7px] font-mono text-xs hover:border-fg">Open a report.json<input class="hidden" id="file" type="file" accept="application/json,.json" /></label>
    </div>

    <script>window.__QUALITY_DATA__ = ${dataScript(report, options)};</script>
    <script src="./viewer/compare.js"></script>
  </body>
</html>
`;
}

/** Minimal benchmarks index behind the comparer's “← benchmarks” link. */
export function renderDashboard(report, options = {}) {
  const data = buildViewerData(report, options);
  const rows = data.documents
    .map((document) => {
      const channels = data.channels
        .map((name) => {
          const channel = document.channels[name];
          return channel?.status === "ok"
            ? `<span class="font-mono text-xs text-dim">${channelLabel(name)} ${channel.score.toFixed(4)}</span>`
            : `<span class="font-mono text-xs text-faint">${channelLabel(name)} —</span>`;
        })
        .join(" ");
      return `<li class="border-b border-line-soft"><a class="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 py-3 no-underline hover:bg-surface" href="./index.html?doc=${encodeURIComponent(document.id)}"><span class="min-w-0 flex-1 truncate text-fg">${escapeHtml(document.title)}</span>${channels}</a></li>`;
    })
    .join("");
  const reference = data.reference.version
    ? `${escapeHtml(data.reference.label)} ${escapeHtml(data.reference.version)}`
    : escapeHtml(data.reference.label);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Benchmarks · canvas-word</title>
    <link rel="stylesheet" href="./viewer/styles.css" />
  </head>
  <body class="min-h-dvh overflow-x-clip bg-bg font-sans text-[15px]/[1.55] text-fg antialiased">
    <header class="sticky top-0 z-20 border-b border-line-soft bg-head backdrop-blur-xl">
      <div class="wrap flex h-16 items-center justify-between gap-6">
        <a class="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-[-0.015em] whitespace-nowrap no-underline" href="./index.html">canvas-word <span class="font-normal text-faint">/ benchmarks</span></a>
        <nav class="flex flex-wrap items-center gap-x-7 gap-y-2" aria-label="Sections">
          <a class="font-mono text-xs text-ink no-underline transition-colors hover:text-fg" href="./index.html">compare</a>
        </nav>
      </div>
    </header>
    <main>
      <section class="wrap pt-12 pb-[clamp(3.5rem,7vw,6rem)] md:pt-20">
        <h1 class="max-w-[820px] text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] font-semibold tracking-[-0.045em] text-balance">Benchmarks</h1>
        <p class="mt-6 max-w-[760px] text-ink">Page-level visual fidelity of canvas-word against ${reference}, measured at 150 DPI with page-penalized grayscale SSIM.</p>
        <p class="mt-3 font-mono text-[0.6875rem] text-dim">${escapeHtml(data.commit.slice(0, 8))}${data.dirty ? " (dirty)" : ""} · ${data.documents.length} documents · ${data.channels.map((name) => escapeHtml(channelLabel(name))).join(" · ")}</p>
        <ol class="mt-10 border-t border-line-soft">${rows}</ol>
      </section>
    </main>
  </body>
</html>
`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

/**
 * Write the comparer, its dashboard and the vendored viewer assets into
 * `outDir`. Safe to call more than once (assets are overwritten).
 */
export async function writeViewer(outDir, report, options = {}) {
  await mkdir(outDir, { recursive: true });
  await cp(VIEWER_ASSETS, join(outDir, "viewer"), { recursive: true });
  await writeFile(join(outDir, "index.html"), renderViewer(report, options));
  await writeFile(join(outDir, "dashboard.html"), renderDashboard(report, options));
}

export { VIEWER_ASSETS };
