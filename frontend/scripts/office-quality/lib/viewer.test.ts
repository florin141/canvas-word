import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildViewerData, renderViewer, writeViewer } from "./viewer.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cw-viewer-"));
  directories.push(dir);
  return dir;
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    commit: "a".repeat(40),
    dirty: true,
    generated_at: "2026-11-10T00:00:00.000Z",
    settings: { dpi: 150, channels: ["canvas", "pdf"], reference: "word" },
    reference_engines: { word: "16.0" },
    samples: [
      {
        id: "times-baseline",
        title: "Times <calibration>",
        channels: [
          {
            channel: "canvas",
            status: "ok",
            penalized_ssim: 0.75,
            common_page_ssim: 0.8,
            reference_pages: 2,
            actual_pages: 2,
            page_agreement_fraction: 0.5,
            first_divergence_page: 2,
            page_ssim: [
              { page: 1, ssim: 0.8, aligned_page: 1, size_note: null, reference_size: [1275, 1650], actual_size: [1275, 1650] },
              { page: 2, ssim: 0.7, aligned_page: 1, size_note: "missing or extra page", reference_size: [1275, 1650], actual_size: [1275, 1650] },
            ],
          },
          { channel: "pdf", status: "failed", stage: "render", error: "boom" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("fidelity comparer viewer", () => {
  it("adapts a report to the fidelity data model", () => {
    const data = buildViewerData(report());
    expect(data.commit).toBe("a".repeat(40));
    expect(data.reference).toEqual({ label: "Microsoft Word", version: "16.0" });
    expect(data.channels).toEqual(["canvas", "pdf"]);
    const document = data.documents[0];
    expect(document.referenceBase).toBe("times-baseline/reference");
    expect(document.referencePages).toBe(2);
    expect(document.channels.canvas).toMatchObject({
      status: "ok",
      score: 0.75,
      referencePages: 2,
      actualPages: 2,
      renderBase: "times-baseline/compare-canvas",
    });
    // A page that exists on only one side maps to the app's "no common page".
    expect(document.channels.canvas.pages[1].ssim).toBeNull();
    expect(document.channels.canvas.pages[0].width).toBe(1275);
    expect(document.channels.pdf).toMatchObject({ status: "failed", stage: "render", error: "boom" });
  });

  it("honours the single-document gate's image bases", () => {
    const data = buildViewerData(report(), {
      referenceBase: () => "reference",
      renderBase: () => "compare",
    });
    expect(data.documents[0].referenceBase).toBe("reference");
    expect(data.documents[0].channels.canvas.renderBase).toBe("compare");
  });

  it("renders the fidelity page and escapes script-closing titles", () => {
    const html = renderViewer(
      report({
        samples: [
          {
            id: "x",
            title: "Bad </script><script>alert(1)</script>",
            channels: report().samples[0].channels,
          },
        ],
      }),
    );
    expect(html).toContain("window.__QUALITY_DATA__ = {");
    expect(html).toContain('src="./viewer/compare.js"');
    expect(html).toContain('href="./viewer/styles.css"');
    expect(html).toContain('data-mode="swipe"');
    expect(html).toContain('data-mode="difference"');
    expect(html).toContain('id="sheet"');
    expect(html).toContain("Bad \\u003c/script>");
    expect(html).not.toContain("Bad </script>");
  });

  it("writes the page, dashboard, and vendored assets", async () => {
    const dir = await tempDir();
    await writeViewer(dir, report());
    for (const path of [
      "index.html",
      "dashboard.html",
      "viewer/styles.css",
      "viewer/compare.js",
      "viewer/fonts/geist-latin-wght-normal.woff2",
      "viewer/fonts/geist-mono-latin-wght-normal.woff2",
    ]) {
      expect((await stat(join(dir, path))).size).toBeGreaterThan(0);
    }
  });
});
