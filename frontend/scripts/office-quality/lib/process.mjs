// Child-process helper for the harness: capture stdout/stderr, enforce a
// deadline, and kill the whole process tree. Word's COM automation and the Vite
// dev server both spawn grandchildren, so a plain `child.kill()` on Windows can
// orphan them (and a stuck WINWORD.EXE blocks the next run).
import { spawn, spawnSync } from "node:child_process";

/** Kill a child and everything it spawned. Best-effort, never throws. */
export function killTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Run a command to completion. Resolves with `{ code, signal, stdout, stderr,
 * timedOut }` even for a non-zero exit; rejects only when the process cannot be
 * spawned. Output is always captured (the harness logs it on failure).
 */
export function runProcess(command, args, { cwd, env, timeoutMs = 0, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group on POSIX so killTree can reach grandchildren; Windows
      // uses taskkill /T instead and detached would open a console window.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, timeoutMs)
        : null;
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (spawnError) {
        reject(spawnError);
        return;
      }
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {
      /* the child may exit before consuming stdin */
    });
    child.stdin.end(input ?? undefined);
  });
}
