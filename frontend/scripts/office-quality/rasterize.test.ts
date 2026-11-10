import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it } from "vitest";
import { rasterizePdf, textLines } from "./rasterize.mjs";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cw-raster-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Build a Letter-size PDF (612×792 pt) with the given page texts. */
async function letterPdf(path: string, texts: string[]): Promise<void> {
  const document = new PDFDocument({ size: "LETTER", margin: 72 });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    document.on("end", resolve);
    document.on("error", reject);
  });
  for (const [index, text] of texts.entries()) {
    if (index > 0) document.addPage();
    document.fontSize(24).text(text);
  }
  document.end();
  await ended;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, Buffer.concat(chunks));
}

describe("rasterizePdf", () => {
  it("writes 150-DPI page rasters and extractable text lines", async () => {
    const dir = await tempDir();
    const pdf = join(dir, "reference.pdf");
    await letterPdf(pdf, ["Hello quality harness", "Second page text"]);
    const out = join(dir, "raster");
    const { pages, result } = await rasterizePdf({ pdfPath: pdf, outDir: out });

    expect(result.status).toBe("ok");
    expect(result.dpi).toBe(150);
    expect(result.pages).toBe(2);
    expect(pages).toHaveLength(2);
    // Letter is 612×792 pt. At 150 DPI the width is exactly 1275 px; the height is
    // 1650.0000000000002 under the `dpi / 72` scale, so `Math.ceil` (the documented
    // raster convention, shared with the reference harness) yields 1651. The
    // comparator's ±1 px edge rule absorbs that against the editor's 1650 px canvas.
    expect(pages[0].width).toBe(1275);
    expect(pages[0].height).toBe(Math.ceil(792 * (150 / 72)));
    expect(pages[0].lines.join(" ")).toContain("Hello quality harness");
    expect(pages[1].lines.join(" ")).toContain("Second page text");

    for (const [index, page] of pages.entries()) {
      const file = await readFile(join(out, `page_${String(index + 1).padStart(4, "0")}.png`));
      expect(file.subarray(1, 4).toString("latin1")).toBe("PNG");
    }
    const metadata = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);

  it("groups text items on hasEOL", () => {
    expect(
      textLines([
        { str: "Hello", hasEOL: false },
        { str: " world", hasEOL: true },
        { str: "next line", hasEOL: true },
        { str: "tail", hasEOL: false },
      ]),
    ).toEqual(["Hello world", "next line", "tail"]);
  });
});
