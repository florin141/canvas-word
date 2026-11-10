// Corpus manifest loading and validation.
//
// Sources stay out of the repository (generated docs are built under
// .source/office-quality/); the checked-in manifest names them, so a report can
// always say which documents produced a score. Paths are repo-root-relative.
import { basename, dirname, join, resolve } from "node:path";
import { HARNESS_ROOT, REPO_ROOT, isFile, listDir, readJson } from "./files.mjs";

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_PATH = join(HARNESS_ROOT, "corpus.json");

const ID = /^[a-z0-9-]+$/;

export function validateManifest(manifest) {
  if (manifest?.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error("Invalid office-quality manifest schema");
  }
  if (!Array.isArray(manifest.samples) || manifest.samples.length === 0) {
    throw new Error("Office-quality manifest requires at least one sample");
  }
  const ids = new Set();
  for (const sample of manifest.samples) {
    if (!sample || typeof sample.id !== "string" || !ID.test(sample.id)) {
      throw new Error("Invalid office-quality sample id");
    }
    if (ids.has(sample.id)) throw new Error(`Duplicate office-quality sample: ${sample.id}`);
    ids.add(sample.id);
    if (typeof sample.title !== "string" || sample.title.length === 0) {
      throw new Error(`Sample ${sample.id} needs a title`);
    }
    if (!["file", "glob", "generated"].includes(sample.kind)) {
      throw new Error(`Sample ${sample.id} has an unsupported kind`);
    }
    if (sample.kind === "generated" && (typeof sample.generator !== "string" || !ID.test(sample.generator))) {
      throw new Error(`Generated sample ${sample.id} needs a generator id`);
    }
    if (sample.kind !== "generated" && (typeof sample.path !== "string" || sample.path.length === 0)) {
      throw new Error(`Sample ${sample.id} needs a path`);
    }
  }
  return manifest;
}

export async function loadManifest(path = MANIFEST_PATH) {
  return validateManifest(await readJson(path));
}

export function selectSamples(manifest, requested = null) {
  const normalized = validateManifest(manifest);
  if (requested === null) return normalized.samples;
  const wanted = Array.isArray(requested) ? requested : String(requested).split(",").map((id) => id.trim()).filter(Boolean);
  const byId = new Map(normalized.samples.map((sample) => [sample.id, sample]));
  const selected = [];
  for (const id of wanted) {
    const sample = byId.get(id);
    if (!sample) throw new Error(`Unknown office-quality sample: ${id}`);
    selected.push(sample);
  }
  return selected;
}

function globRoot() {
  return REPO_ROOT;
}

/** Resolve an optional `*.ext` pattern (optionally with a directory prefix)
 *  against a root directory. Only the basename may contain `*`. */
export async function resolveGlob(pattern, directory = globRoot()) {
  const relativeDir = dirname(pattern);
  const root = relativeDir === "." ? directory : join(directory, relativeDir);
  const escaped = basename(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const expression = new RegExp(`^${escaped}$`);
  const matches = (await listDir(root)).filter((name) => expression.test(name)).sort();
  return matches.map((name) => join(root, name));
}

/**
 * Resolve a sample to a source path. Returns `null` for an absent optional
 * sample (never an error) and throws for a required sample that is missing.
 */
export async function resolveSample(sample, options = {}) {
  const glob = options.glob ?? resolveGlob;
  if (sample.kind === "generated") {
    return join(options.corpusDir ?? join(REPO_ROOT, ".source", "office-quality", "corpus"), sample.id, "source.docx");
  }
  if (sample.kind === "glob") {
    const matches = await glob(sample.path);
    if (matches.length === 0) {
      if (sample.optional) return null;
      throw new Error(`Sample ${sample.id} matched no files for ${sample.path}`);
    }
    if (matches.length > 1) throw new Error(`Sample ${sample.id} matched multiple files for ${sample.path}`);
    return matches[0];
  }
  const source = resolve(REPO_ROOT, sample.path);
  if (!(await isFile(source))) {
    if (sample.optional) return null;
    throw new Error(`Sample ${sample.id} source is missing: ${sample.path}`);
  }
  return source;
}
