// Canvas channel: drive the real editor in Chromium and capture each page's
// backing store at exactly 150 DPI.
//
// Capture method: DPR 1 + zoom 150/96 makes the page canvas's backing store the
// 150-DPI raster (the renderer sizes it `pagePx × zoom × dpr`), so
// `canvas.toDataURL()` is the comparison image — no OS screenshots, no resampling.
// Pages are mounted on demand by an IntersectionObserver, so they are scrolled
// into view one at a time; each canvas must reach its expected size and then
// produce two identical frames before it is accepted.
//
// The source .docx is served through page.route() at `/__quality__/source.docx`
// and imported in-page, so multi-megabyte bytes never cross the Playwright
// protocol. The imported model's block count is checked against the Node-side
// import: a browser import that silently dropped content must never score well.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import {
  DPI,
  FRONTEND_ROOT,
  pageName,
  isEmptyDir,
  readJson,
  sha256File,
  writeResult,
} from "./lib/files.mjs";
import { startServer } from "./serve.mjs";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DEFAULT_TIMEOUT_MS = 900_000;

async function frontendVersion() {
  const pkg = await readJson(join(FRONTEND_ROOT, "package.json"));
  return pkg.version;
}

/**
 * Capture `source` with the editor into `outDir`. `expectedBlocks` is the
 * Node-side import's block count; without it the in-page count is only recorded.
 * `url` reuses an existing dev server (its caller owns closing it).
 */
export async function captureCanvas({
  source,
  outDir,
  url = null,
  expectedBlocks = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const bytes = await readFile(source);
  const sourceSha = await sha256File(source);
  const ownServer = url ? null : await startServer({ timeoutMs: Math.min(timeoutMs, 180_000) });
  const baseUrl = url ?? ownServer.url;
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const startedAt = Date.now();
  try {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
    });

    await page.route("**/__quality__/source.docx", (route) =>
      route.fulfill({ status: 200, contentType: DOCX_MIME, body: bytes }),
    );

    const target = new URL(baseUrl);
    target.searchParams.set("chrome", "minimal");
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 180_000) });
    await page.waitForFunction(
      () =>
        Boolean(window.__wc) &&
        Boolean(window.__cw) &&
        document.querySelector(".cw-app [data-page]") !== null,
      undefined,
      { timeout: timeoutMs },
    );

    await page.evaluate(async () => {
      const response = await fetch("/__quality__/source.docx");
      const data = await response.arrayBuffer();
      await window.__wc.openDocx(data);
    });

    // Recursive block count, matching pdf-entry.ts's countBlocks.
    const blockCount = await page.evaluate(() => {
      const count = (blocks) =>
        blocks.reduce(
          (total, block) =>
            total +
            1 +
            (block.kind === "table"
              ? block.rows.reduce(
                  (rows, row) => rows + row.cells.reduce((cells, cell) => cells + count(cell.blocks), 0),
                  0,
                )
              : 0),
          0,
        );
      return count(window.__cw.doc.blocks);
    });
    if (expectedBlocks !== null && blockCount !== expectedBlocks) {
      throw new Error(
        `Browser import produced ${blockCount} blocks; the Node import produced ${expectedBlocks}. ` +
          "The editor dropped or added content before capture.",
      );
    }

    const zoom = DPI / 96;
    await page.evaluate((value) => window.__cw.editor.setZoom(value), zoom);
    const actualZoom = await page.evaluate(() => window.__cw.editor.getZoom());
    if (Math.abs(actualZoom - zoom) > 1e-9) {
      throw new Error(`Editor zoom is ${actualZoom}; expected ${zoom}`);
    }

    const layout = await page.evaluate(() => {
      const tree = window.__cw.engine.layout(window.__cw.doc);
      const linesOf = (blocks) =>
        blocks.flatMap((block) => block.lines.map((line) => line.fragments.map((fragment) => fragment.text).join("")));
      return {
        pages: tree.pages.length,
        sizes: tree.pages.map((page) => ({ width: page.widthPx, height: page.heightPx })),
        text: tree.pages.map((page) =>
          [...linesOf(page.blocks), ...linesOf(page.header ?? []), ...linesOf(page.footer ?? [])]
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      };
    });
    if (layout.pages === 0) throw new Error("Editor laid out zero pages");

    await mkdir(outDir, { recursive: true });
    for (let index = 0; index < layout.pages; index += 1) {
      const expectedWidth = Math.round(layout.sizes[index].width * zoom);
      const expectedHeight = Math.round(layout.sizes[index].height * zoom);
      const dataUrl = await page.evaluate(
        async ({ index, expectedWidth, expectedHeight }) => {
          // Scope to the canvas viewport: the shell also renders small page
          // thumbnails with [data-page] elsewhere, and those are not the page canvas.
          const placeholder = document.querySelector(`.cw-app [data-page="${index}"]`);
          if (!placeholder) throw new Error(`page ${index + 1} placeholder is missing`);
          placeholder.scrollIntoView({ block: "start", inline: "nearest" });
          const deadline = performance.now() + 30_000;
          let canvas = null;
          let seen = "none";
          while (performance.now() < deadline) {
            const candidate = placeholder.querySelector("canvas");
            if (candidate) seen = `${candidate.width}×${candidate.height}`;
            if (candidate && candidate.width === expectedWidth && candidate.height === expectedHeight) {
              canvas = candidate;
              break;
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          if (!canvas) {
            throw new Error(
              `page ${index + 1} canvas did not reach ${expectedWidth}×${expectedHeight} (last seen ${seen})`,
            );
          }
          // Let async image decodes / font swaps repaint, then require two
          // identical frames (the capture stability contract).
          let previous = null;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 120));
            const current = canvas.toDataURL("image/png");
            if (previous !== null && current === previous) return current;
            previous = current;
          }
          throw new Error(`page ${index + 1} canvas did not stabilize`);
        },
        { index, expectedWidth, expectedHeight },
      );
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await writeFile(join(outDir, pageName(index)), Buffer.from(base64, "base64"));
    }

    await writeFile(join(outDir, "pages_text.json"), `${JSON.stringify(layout.text, null, 2)}\n`);
    const result = {
      status: "ok",
      dpi: DPI,
      pages: layout.pages,
      sha256: sourceSha,
      engine: `canvas-word ${await frontendVersion()} (editor canvas)`,
      model_blocks: blockCount,
      expected_blocks: expectedBlocks,
      zoom,
      device_scale_factor: 1,
      timings: { capture_ms: Date.now() - startedAt },
    };
    await writeResult(outDir, result);
    if (consoleErrors.length > 0) {
      console.warn(`[office-quality] capture console errors:\n  ${consoleErrors.slice(0, 5).join("\n  ")}`);
    }
    return { dir: outDir, result, pagesText: layout.text, blockCount };
  } catch (error) {
    if (consoleErrors.length > 0) {
      console.error(`[office-quality] last console errors:\n  ${consoleErrors.slice(-5).join("\n  ")}`);
    }
    throw error;
  } finally {
    await browser.close().catch(() => {});
    if (ownServer) await ownServer.close().catch(() => {});
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        source: { type: "string" },
        out: { type: "string" },
        url: { type: "string" },
        "expected-blocks": { type: "string" },
        "timeout-seconds": { type: "string" },
        force: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(
      `usage: capture.mjs --source <docx> --out <dir> [--expected-blocks N] [--url <dev-url>] [--force]\n${error.message}`,
    );
    process.exit(2);
    return;
  }
  if (!values.source || !values.out) {
    console.error("usage: capture.mjs --source <docx> --out <dir> [--expected-blocks N] [--url <dev-url>] [--force]");
    process.exit(2);
    return;
  }
  try {
    if (!values.force && !(await isEmptyDir(values.out))) {
      throw new Error(`Output directory must be empty: ${values.out}`);
    }
    const { result } = await captureCanvas({
      source: resolve(values.source),
      outDir: resolve(values.out),
      url: values.url ?? null,
      expectedBlocks: values["expected-blocks"] ? Number(values["expected-blocks"]) : null,
      timeoutMs: values["timeout-seconds"] ? Number(values["timeout-seconds"]) * 1000 : DEFAULT_TIMEOUT_MS,
    });
    console.log(`[office-quality] canvas ${result.pages} pages → ${values.out}`);
  } catch (error) {
    console.error(`[office-quality] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
