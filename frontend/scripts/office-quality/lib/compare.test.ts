import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareDirectories, validateComparison } from "./compare.mjs";
import { writeJson } from "./files.mjs";
import { writePng } from "./png.mjs";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cw-quality-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function page(width: number, height: number, offset = 0) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 8; y < Math.min(height - 8, 40); y += 1) {
    for (let x = 8 + offset; x < Math.min(width - 8, 40); x += 1) {
      const at = (y * width + x) * 4;
      rgba[at] = 20;
      rgba[at + 1] = 40;
      rgba[at + 2] = 60;
    }
  }
  return rgba;
}

async function render(
  dir: string,
  pages: { width: number; height: number; offset?: number }[],
  metadata: Record<string, unknown>,
) {
  await writeJson(join(dir, "result.json"), {
    status: "ok",
    dpi: 150,
    pages: pages.length,
    sha256: "a".repeat(64),
    ...metadata,
  });
  for (const [index, pageInfo] of pages.entries()) {
    await writePng(join(dir, `page_${String(index + 1).padStart(4, "0")}.png`), page(pageInfo.width, pageInfo.height, pageInfo.offset), pageInfo.width, pageInfo.height);
  }
}

async function compare(reference: string, actual: string, out: string, options: Record<string, unknown> = {}) {
  return compareDirectories({ referenceDir: reference, actualDir: actual, outDir: out, gallery: false, ...options });
}

describe("compareDirectories", () => {
  it("scores identical renders as 1 with verified source hashes", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }], {});
    await render(actual, [{ width: 120, height: 90 }], {});
    const report = await compare(reference, actual, out);
    expect(report.penalized_ssim).toBeCloseTo(1, 6);
    expect(report.source_verified).toBe(true);
    expect(() => validateComparison(report)).not.toThrow();
  });

  it("penalizes a missing page", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }, { width: 120, height: 90 }], {});
    await render(actual, [{ width: 120, height: 90 }], {});
    const report = await compare(reference, actual, out);
    expect(report.penalized_ssim).toBeCloseTo(0.5, 6);
    expect(report.actual_pages).toBe(1);
    expect(report.pages[1].size_note).toBe("missing or extra page");
  });

  it("penalizes an extra page", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }], {});
    await render(actual, [{ width: 120, height: 90 }, { width: 120, height: 90 }], {});
    const report = await compare(reference, actual, out);
    expect(report.penalized_ssim).toBeCloseTo(0.5, 6);
    expect(report.reference_pages).toBe(1);
  });

  it("accepts a one-pixel edge difference without resampling", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }], {});
    await render(actual, [{ width: 119, height: 89 }], {});
    const report = await compare(reference, actual, out);
    expect(report.pages[0].size_note).toBe("white pad/crop at right/bottom edge");
    expect(report.penalized_ssim).toBeGreaterThan(0.99);
  });

  it("scores a larger size mismatch as zero with a note", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }], {});
    await render(actual, [{ width: 118, height: 90 }], {});
    const report = await compare(reference, actual, out);
    expect(report.penalized_ssim).toBe(0);
    expect(report.pages[0].size_note).toContain("size mismatch");
  });

  it("refuses mismatched source hashes or DPI", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }], { sha256: "a".repeat(64) });
    await render(actual, [{ width: 120, height: 90 }], { sha256: "b".repeat(64) });
    await expect(compare(reference, actual, out)).rejects.toThrow(/different source/);

    const actual2 = await tempDir();
    await render(actual2, [{ width: 120, height: 90 }], { dpi: 96 });
    await expect(compare(reference, actual2, out)).rejects.toThrow(/DPI/);
  });

  it("scores aligned pages when a page break shifts", async () => {
    const reference = await tempDir();
    const actual = await tempDir();
    const out = await tempDir();
    await render(reference, [{ width: 120, height: 90 }, { width: 120, height: 90 }], {});
    await render(actual, [{ width: 120, height: 90 }], {});
    await writeJson(join(reference, "pages_text.json"), [
      ["alpha beta gamma delta epsilon", "zeta eta theta"],
      ["iota kappa lambda mu nu"],
    ]);
    await writeJson(join(actual, "pages_text.json"), [
      ["alpha beta gamma delta epsilon", "zeta eta theta", "iota kappa lambda mu nu"],
    ]);
    const report = await compare(reference, actual, out);
    expect(report.page_agreement).toBe(1);
    expect(report.pages[1].aligned_page).toBe(1);
    expect(report.pages[1].break_agrees).toBe(false);
  });
});
