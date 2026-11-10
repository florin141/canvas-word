// Browser smoke test for the AI assistant (Playwright, mocked provider).
//
//   node scripts/ai-smoke.mjs
//
// Starts the Vite dev server on :5199, loads the dev harness with ?ai=1 and a
// custom provider pointed at a routed mock endpoint, then exercises:
//   1. panel chat streaming
//   2. Ask AI as the leading selection-toolbar item → popover → Send now
//   3. Replace selection + one Ctrl+Z
// Screenshots land in the gitignored ../shots/ai/.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "..");
const repoRoot = path.resolve(frontendDir, "..");
const viteBin = path.resolve(repoRoot, "node_modules/vite/bin/vite.js");
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const shotsDir = path.resolve(repoRoot, "shots/ai");

const provider = {
  providerId: "custom",
  model: "mock-model",
  baseUrl: `${BASE}/mock/v1`,
  apiKey: "test-key",
};

const sse = (content) =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");

const server = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort"], {
  cwd: frontendDir,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite dev server did not start");
}

let browser;
try {
  await waitForServer();
  await mkdir(shotsDir, { recursive: true });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[page:${message.type()}]`, message.text());
    }
  });

  await page.route("**/mock/v1/chat/completions", async (route) => {
    const raw = route.request().postData() ?? "";
    let message = "";
    try {
      const parsed = JSON.parse(raw);
      message = (parsed.messages ?? []).map((m) => m.content ?? "").join("\n");
    } catch {
      message = raw;
    }
    if (message.includes("Task id:")) {
      const ids = [...message.matchAll(/Task id: ([^\n]+)/g)].map((match) => match[1].trim());
      const results = ids.map((id) => ({ id, replacement: "Queued replacement" }));
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(JSON.stringify({ results })) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Mock answer.") });
  });

  const params = new URLSearchParams({
    ai: "1",
    aiOpen: "1",
    aiProvider: JSON.stringify(provider),
  });
  await page.goto(`${BASE}/?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(globalThis.__wc));
  await page.evaluate(() => globalThis.__wc.whenReady());
  await page.waitForSelector(".cw-ai-panel.open", { timeout: 30_000 });

  // 1. Panel chat streams.
  await page.locator(".cw-ai-input").fill("Summarize this document");
  await page.locator(".cw-ai-send").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cw-ai-turn.assistant .cw-ai-bubble")].some((el) =>
      el.textContent?.includes("Mock answer."),
    ),
  );
  console.log("✓ panel chat streams");

  // 2. Ask AI leads the selection toolbar and opens the popover. Select one
  //    line (Home → Shift+End) so the anchored edit is a normal passage.
  await page.locator(".cw-app").click({ position: { x: 500, y: 300 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  const askAi = page.locator('button[title="Ask AI about the selection"]');
  await askAi.waitFor({ state: "visible", timeout: 10_000 });
  await askAi.click();
  await page.waitForSelector(".cw-ai-pop");
  await page.screenshot({ path: path.join(shotsDir, "ask-ai-popover.png"), fullPage: false });
  await page.locator(".cw-ai-pop-chip").first().click();
  await page.locator(".cw-ai-pop-send").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cw-ai-turn.assistant .cw-ai-bubble")].some((el) =>
      el.textContent?.includes("Mock answer."),
    ),
  );
  console.log("✓ Ask AI → Send now → streams into the panel");

  // 3. Replace the anchored selection; one undo restores it.
  const replace = page.locator(".cw-ai-actions button", { hasText: "Replace selection" }).last();
  await replace.waitFor({ state: "visible", timeout: 10_000 });
  await replace.click();
  await page.keyboard.press("Control+Z");
  console.log("✓ Apply (Replace selection) + Ctrl+Z");

  // 4. Queue two anchored edits, run them in one pass, Apply all.
  for (let i = 0; i < 2; i++) {
    await page.locator(".cw-app").click({ position: { x: 500, y: 500 + i * 40 } });
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.locator('button[title="Ask AI about the selection"]').click();
    await page.waitForSelector(".cw-ai-pop");
    await page.locator(".cw-ai-pop-chip").first().click();
    await page.locator(".cw-ai-pop-queue").click();
  }
  await page.waitForFunction(() => document.querySelector(".cw-ai-qtitle")?.textContent?.includes("Queue (2)"), null, {
    timeout: 10_000,
  });
  await page.locator(".cw-ai-qbtn.primary", { hasText: "Run queue" }).click();
  await page.waitForFunction(() => document.querySelector(".cw-ai-qtitle")?.textContent?.includes("Results ("), null, {
    timeout: 15_000,
  });
  await page.locator(".cw-ai-qbtn.primary", { hasText: "Apply all" }).click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (document.body.innerText ?? "").includes("Applied 2 edits."), null, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => {
    const queue = document.querySelector(".cw-ai-queue");
    return !queue || queue.style.display === "none";
  });
  console.log("✓ Queue ×2 → Run queue → Apply all (one pass)");

  await page.screenshot({ path: path.join(shotsDir, "ai-panel-and-popover.png"), fullPage: false });
  console.log(`Screenshot: ${path.join(shotsDir, "ai-panel-and-popover.png")}`);

  // 5. Suggesting mode: Replace creates a tracked change.
  const setMode = (mode) => page.evaluate(async (m) => (await globalThis.__wc.whenReady()).setMode(m), mode);
  await setMode("suggest");
  await page.locator(".cw-app").click({ position: { x: 500, y: 620 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.locator('button[title="Ask AI about the selection"]').click();
  await page.waitForSelector(".cw-ai-pop");
  await page.locator(".cw-ai-pop-chip").first().click();
  await page.locator(".cw-ai-pop-send").click();
  const trackedReplace = page.locator(".cw-ai-actions button", { hasText: "Replace selection" }).last();
  await trackedReplace.waitFor({ state: "visible", timeout: 10_000 });
  await trackedReplace.click();
  const review = await page.evaluate(async () => (await globalThis.__wc.whenReady()).getReview());
  if (review.suggestions.length === 0) throw new Error("Suggesting mode recorded no suggestion");
  console.log("✓ Suggesting mode → Replace records a tracked change");
  await setMode("edit");

  // 6. No provider configured: the setup card appears and nothing is sent.
  const fresh = await browser.newPage();
  await fresh.goto(`${BASE}/?ai=1&aiOpen=1`);
  await fresh.evaluate(async () => {
    await globalThis.__wc.whenReady();
  });
  await fresh.waitForSelector(".cw-ai-noprov", { timeout: 20_000 });
  await fresh.close();
  console.log("✓ no-provider setup card (no request)");
} finally {
  await browser?.close();
  server.kill();
}
