// Benchmark aggregation and generated Markdown.
//
// Means cover successful comparisons only; coverage is reported alongside them,
// because a channel that silently skipped half the corpus would otherwise look
// better than it is. Failed comparisons have no score and never become a zero.
import { validateComparison } from "./compare.mjs";

export const CHANNELS = ["canvas", "pdf"];
export const CHANNEL_LABEL = { canvas: "Canvas", pdf: "PDF" };

function successful(comparison) {
  return comparison?.status === "ok" && Number.isFinite(comparison.penalized_ssim);
}

export function summarizeSample(sample, channels = CHANNELS) {
  return {
    id: sample.id,
    title: sample.title,
    source_sha256: sample.source_sha256,
    source_bytes: sample.source_bytes,
    channels: channels.map((channel) => {
      const comparison = sample.channels?.find((entry) => entry.channel === channel);
      return comparison ?? { channel, status: "missing", stage: "capture", error: "No comparison recorded" };
    }),
  };
}

export function aggregateReport(report) {
  const channels = report.settings?.channels ?? CHANNELS;
  const summary = {};
  for (const channel of channels) {
    const entries = report.samples.map((sample) => sample.channels.find((entry) => entry.channel === channel)).filter(Boolean);
    const scored = entries.filter(successful);
    const pageErrors = scored.map((entry) => Math.abs(entry.actual_pages - entry.reference_pages));
    const agreements = scored.filter((entry) => Number.isFinite(entry.page_agreement_fraction));
    summary[channel] = {
      samples: entries.length,
      scored: scored.length,
      total: entries.length,
      mean_penalized_ssim: scored.length > 0 ? scored.reduce((sum, entry) => sum + entry.penalized_ssim, 0) / scored.length : null,
      exact_pages: scored.filter((entry) => entry.actual_pages === entry.reference_pages).length,
      absolute_page_error: pageErrors.reduce((sum, value) => sum + value, 0),
      mean_page_agreement: agreements.length > 0 ? agreements.reduce((sum, entry) => sum + entry.page_agreement_fraction, 0) / agreements.length : null,
      page_agreement_samples: agreements.length,
    };
  }
  return { ...report, summary };
}

export function validateReport(report) {
  if (!Array.isArray(report?.samples) || report.samples.length === 0) {
    throw new Error("Report has no samples");
  }
  for (const sample of report.samples) {
    for (const comparison of sample.channels ?? []) {
      if (comparison.status === "ok") validateComparison({ ...comparison, reference: comparison.reference, actual: comparison.actual });
    }
  }
  return report;
}

function number(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function escapeCell(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Render the benchmark section. Deterministic: samples keep manifest order and
 * channels keep the configured order, so two runs of the same corpus diff cleanly.
 */
export function renderSection(report) {
  const channels = report.settings?.channels ?? CHANNELS;
  const lines = [];
  const reference = report.settings?.reference ?? "word";
  const provenance = report.commit
    ? `Commit ${report.commit.slice(0, 8)}${report.dirty ? " (dirty working tree)" : ""}. `
    : "";
  lines.push(`${provenance}Office references: ${reference === "libreoffice" ? "LibreOffice" : "Microsoft Word"} (${report.reference_engines?.[reference] ?? "version not recorded"}). 150 DPI, page-penalized grayscale SSIM, no resampling.`);
  lines.push("");
  const header = ["Sample", "Pages (reference)"].concat(channels.flatMap((channel) => [`${CHANNEL_LABEL[channel] ?? channel} SSIM`, `${CHANNEL_LABEL[channel] ?? channel} pages`]));
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const sample of report.samples) {
    const first = sample.channels.find((entry) => Number.isFinite(entry.reference_pages));
    const cells = [escapeCell(sample.title ?? sample.id), first ? String(first.reference_pages) : "—"];
    for (const channel of channels) {
      const comparison = sample.channels.find((entry) => entry.channel === channel);
      if (comparison?.status === "ok") {
        cells.push(number(comparison.penalized_ssim), `${comparison.actual_pages}/${comparison.reference_pages}`);
      } else {
        cells.push("failed", "—");
      }
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  const coverage = channels.map((channel) => `${CHANNEL_LABEL[channel] ?? channel} ${report.summary?.[channel]?.scored ?? 0}/${report.summary?.[channel]?.total ?? 0}`);
  lines.push(`Means cover successful comparisons only; coverage ${coverage.join(", ")}.`);
  const details = channels.map((channel) => {
    const summary = report.summary?.[channel];
    if (!summary) return null;
    return `${CHANNEL_LABEL[channel] ?? channel} exact page counts ${summary.exact_pages}/${summary.scored}, absolute page error ${summary.absolute_page_error}`;
  }).filter(Boolean);
  if (details.length > 0) lines.push(`${details.join(". ")}.`);
  lines.push("");
  lines.push("canvas-word renders bundled metric-compatible clones (Calibri→Carlito, Arial→Arimo, …); Office references use the installed Office fonts. Metrics match, glyph shapes differ, so absolute SSIM is not comparable to a byte-identical renderer.");
  return `${lines.join("\n").trimEnd()}\n`;
}
