// Vite dev-server lifecycle for the canvas capture channel.
//
// The server runs IN-PROCESS (vite.createServer) rather than as a spawned child:
// it starts faster, its logs stay in the harness, and there is no orphaned
// Node/Vite process to clean up on Windows if the harness crashes. A free port is
// chosen up front and the server is started with strictPort so a race with
// another process fails loudly instead of silently binding somewhere else.
import { createServer } from "node:net";
import { join } from "node:path";
import { FRONTEND_ROOT } from "./lib/files.mjs";

/** Ask the OS for a free TCP port on `host`. */
export function freePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(100);
  }
  throw new Error(`Vite dev server did not become ready at ${url} within ${timeoutMs} ms`);
}

/**
 * Start the frontend dev server and wait until it serves HTTP. Resolves to
 * `{ url, port, close() }`; always call `close()` in a finally block.
 */
export async function startServer({ port = null, timeoutMs = 180_000 } = {}) {
  const vite = await import("vite");
  const chosen = port ?? (await freePort());
  const server = await vite.createServer({
    root: FRONTEND_ROOT,
    configFile: join(FRONTEND_ROOT, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: chosen, strictPort: true },
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close().catch(() => {});
    throw new Error(`Could not start the Vite dev server on port ${chosen}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${chosen}/`;
  try {
    await waitForHttp(url, timeoutMs);
  } catch (error) {
    await server.close().catch(() => {});
    throw error;
  }
  return {
    url,
    port: chosen,
    async close() {
      await server.close();
    },
  };
}
