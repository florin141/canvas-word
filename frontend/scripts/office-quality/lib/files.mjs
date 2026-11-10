// Filesystem, hashing and JSON helpers shared by the office-quality harness.
// Kept dependency-free (Node builtins only) so the pure scoring modules can run
// in vitest without Word, Playwright, or any generated corpus.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `frontend/scripts/office-quality/` */
export const HARNESS_ROOT = fileURLToPath(new URL("../", import.meta.url));
/** `frontend/` */
export const FRONTEND_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** repository root (the workspace root) */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** Ignored output root: `.source/office-quality/` */
export const SOURCE_ROOT = join(REPO_ROOT, ".source", "office-quality");

export const DPI = 150;

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value, options = {}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** True when `dir` is missing or contains no entries. */
export async function isEmptyDir(dir) {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return true;
  }
}

export async function listDir(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

/** `page_0001.png` for zero-based `index`. */
export function pageName(index) {
  return `page_${String(index + 1).padStart(4, "0")}.png`;
}

/**
 * Contiguous `page_NNNN.png` files in `dir`, sorted. Throws when the numbering
 * skips or starts anywhere other than page_0001.png, so a partial capture can
 * never be scored as a shorter document.
 */
export async function pageFiles(dir) {
  const names = (await listDir(dir))
    .filter((name) => /^page_\d{4}\.png$/.test(name))
    .sort();
  for (const [index, name] of names.entries()) {
    if (name !== pageName(index)) {
      throw new Error(`${dir}: page files must be contiguous starting at page_0001.png`);
    }
  }
  return names.map((name) => join(dir, name));
}

/** Write the standard render metadata (`result.json`) for a channel directory. */
export async function writeResult(dir, value) {
  await writeJson(join(dir, "result.json"), value);
}
