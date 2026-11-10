import { describe, expect, it } from "vitest";
import { aggregateReport, renderSection, validateReport } from "./report.mjs";

const okay = (channel: string, overrides: Record<string, unknown> = {}) => ({
  channel,
  status: "ok",
  source_verified: true,
  reference: { status: "ok", sha256: "a".repeat(64) },
  actual: { status: "ok", sha256: "a".repeat(64) },
  reference_pages: 4,
  actual_pages: 4,
  common_page_ssim: 0.9,
  penalized_ssim: 0.9,
  resized: false,
  ...overrides,
});

function report(samples: unknown[]) {
  return {
    source_sha: "c".repeat(40),
    commit: "c".repeat(40),
    settings: { dpi: 150, channels: ["canvas", "pdf"], reference: "word" },
    reference_engines: { word: "16.0" },
    samples,
  };
}

describe("benchmark report", () => {
  it("averages successful comparisons only and keeps coverage", () => {
    const input = report([
      { id: "a", title: "A", channels: [okay("canvas"), { channel: "pdf", status: "failed", stage: "capture", error: "boom" }] },
      { id: "b", title: "B", channels: [okay("canvas", { penalized_ssim: 0.8 }), okay("pdf", { penalized_ssim: 0.7, actual_pages: 5 })] },
    ]);
    const aggregated = aggregateReport(input);
    expect(aggregated.summary.canvas.mean_penalized_ssim).toBeCloseTo(0.85, 10);
    expect(aggregated.summary.canvas.scored).toBe(2);
    expect(aggregated.summary.pdf.scored).toBe(1);
    expect(aggregated.summary.pdf.total).toBe(2);
    expect(aggregated.summary.pdf.exact_pages).toBe(0);
    expect(aggregated.summary.pdf.absolute_page_error).toBe(1);
  });

  it("renders a deterministic Markdown section with failed channels marked", () => {
    const input = aggregateReport(report([
      { id: "a", title: "A", channels: [okay("canvas"), { channel: "pdf", status: "failed", stage: "capture", error: "boom" }] },
    ]));
    const markdown = renderSection(input);
    expect(markdown).toContain("| A | 4 | 0.9000 | 4/4 | failed | — |");
    expect(markdown).toContain("coverage Canvas 1/1, PDF 0/1");
    expect(markdown).toContain("metric-compatible clones");
  });

  it("refuses to publish an invalid successful comparison", () => {
    const input = report([
      { id: "a", title: "A", channels: [okay("canvas", { source_verified: false })] },
    ]);
    expect(() => validateReport(input)).toThrow(/incomplete or mismatched/);
  });
});
