// LibreOffice reference generation — the optional CI oracle. Word remains the
// authoritative local oracle; LibreOffice only runs in the manual visual-quality
// workflow (Linux) so a reference can be produced without an Office license.
//
// Each conversion gets a throwaway UserInstallation profile: a shared profile is
// where concurrent headless soffice invocations deadlock or inherit one
// another's extension state.
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isFile } from "./lib/files.mjs";
import { runProcess } from "./lib/process.mjs";

const COMMON_PATHS = {
  win32: [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ],
  darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
  linux: [
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/opt/libreoffice/program/soffice",
  ],
};

function which(name) {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

/**
 * Locate the LibreOffice executable. Honours SOFFICE / LIBREOFFICE, then the
 * platform's usual install paths, then PATH. Returns null when absent.
 */
export async function findLibreOffice(env = process.env) {
  for (const key of ["SOFFICE", "LIBREOFFICE"]) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  for (const candidate of COMMON_PATHS[process.platform] ?? []) {
    if (await isFile(candidate)) return candidate;
  }
  for (const name of process.platform === "win32" ? ["soffice.exe", "soffice"] : ["soffice", "libreoffice"]) {
    const found = which(name);
    if (found) return found;
  }
  return null;
}

/** `LibreOffice 7.4.7.2 30(Build:2)` → `7.4.7.2`. */
export function parseVersion(stdout) {
  const match = /LibreOffice\s+([\d.]+)/i.exec(stdout);
  return match ? match[1] : stdout.split(/\r?\n/)[0].trim();
}

export async function libreOfficeVersion(binary, timeoutMs = 30_000) {
  const result = await runProcess(binary, ["--version"], { timeoutMs });
  if (result.timedOut || result.code !== 0) {
    throw new Error(`LibreOffice --version failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return parseVersion(result.stdout);
}

/**
 * Convert `source` to `output` (a PDF path) with headless LibreOffice.
 * Returns `{ version, binary }`; throws when LibreOffice is missing, the
 * conversion fails, or the process exceeds `timeoutMs`.
 */
export async function generateLibreOffice(source, output, { timeoutMs = 300_000, env = process.env } = {}) {
  const binary = await findLibreOffice(env);
  if (!binary) {
    throw new Error(
      "LibreOffice not found. Install it (or set SOFFICE) or run with --reference word on a machine with Microsoft Word.",
    );
  }
  const version = await libreOfficeVersion(binary);
  const profile = await mkdtemp(join(tmpdir(), "cw-lo-profile-"));
  const outDir = dirname(output);
  const expected = join(outDir, `${basename(source, extname(source))}.pdf`);
  try {
    const result = await runProcess(
      binary,
      [
        "--headless",
        "--invisible",
        "--nologo",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        source,
      ],
      { timeoutMs },
    );
    if (result.timedOut) throw new Error(`LibreOffice timed out after ${timeoutMs} ms`);
    if (result.code !== 0) {
      throw new Error(`LibreOffice exited ${result.code}: ${(result.stderr || result.stdout).trim()}`);
    }
    if (!(await isFile(expected))) {
      throw new Error(`LibreOffice produced no PDF for ${source}: ${(result.stderr || result.stdout).trim()}`);
    }
    if (expected !== output) {
      await rm(output, { force: true });
      await rename(expected, output);
    }
    const size = (await stat(output)).size;
    if (size === 0) throw new Error(`LibreOffice produced an empty PDF for ${source}`);
    return { version, binary };
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
