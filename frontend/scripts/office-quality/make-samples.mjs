// Build the deterministic DOCX corpus used by the visual-quality harness.
//
// `samples/generate.ts` is TypeScript and imports the production pipeline through
// `@cw/shared`, so it is bundled with esbuild (the same approach as
// scripts/build-node.mjs) into `.source/office-quality/build/samples.mjs` and
// imported from there. Output is `.source/office-quality/corpus/<id>/source.docx`.
//
//   npm run quality:samples                  # all generated samples
//   npm run quality:samples -- --samples times-baseline,tables
//   npm run quality:samples -- --force       # rewrite even when the hash matches
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  REPO_ROOT,
  SOURCE_ROOT,
  sha256Bytes,
  pathExists,
} from "./lib/files.mjs";

const ENTRY = fileURLToPath(new URL("./samples/generate.ts", import.meta.url));
const BUILD_DIR = join(SOURCE_ROOT, "build");
const BUNDLE = join(BUILD_DIR, "samples.mjs");
const DEFAULT_OUT = join(SOURCE_ROOT, "corpus");
const SHARED = join(REPO_ROOT, "shared", "src", "index.ts");

let generatorPromise = null;

/** Bundle-once loader for samples/generate.ts. */
function loadGenerators() {
  generatorPromise ??= (async () => {
    await mkdir(BUILD_DIR, { recursive: true });
    await build({
      entryPoints: [ENTRY],
      outfile: BUNDLE,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      // The private workspace package is raw TS; resolve it to source so the
      // bundle is self-contained (mirrors scripts/build-node.mjs).
      alias: { "@cw/shared": SHARED },
      // Native prebuild — resolved at runtime from the repo's node_modules.
      external: ["@napi-rs/canvas"],
      logLevel: "silent",
    });
    return import(`${pathToFileURL(BUNDLE).href}?v=${Date.now()}`);
  })();
  return generatorPromise;
}

/**
 * Generate the requested samples into `<outDir>/<id>/source.docx`. Existing
 * files with the same SHA are left untouched unless `force`. Returns one
 * `{ id, path, sha256, bytes, wrote }` record per sample.
 */
export async function ensureSamples({ ids = null, outDir = DEFAULT_OUT, force = false } = {}) {
  const { generateSample, SAMPLE_IDS } = await loadGenerators();
  const selected = ids ?? SAMPLE_IDS;
  for (const id of selected) {
    if (!SAMPLE_IDS.includes(id)) {
      throw new Error(`Unknown sample "${id}" (expected one of ${SAMPLE_IDS.join(", ")})`);
    }
  }
  const results = [];
  for (const id of selected) {
    const bytes = generateSample(id);
    const digest = sha256Bytes(bytes);
    const directory = join(outDir, id);
    const path = join(directory, "source.docx");
    await mkdir(directory, { recursive: true });
    let wrote = false;
    if (force || !(await pathExists(path)) || (await sha256Of(path)) !== digest) {
      await writeFile(path, bytes);
      wrote = true;
    }
    console.log(
      `[office-quality] ${wrote ? "wrote" : "reused"} sample ${id} → ${path} (${bytes.length} bytes, sha256 ${digest.slice(0, 12)}…)`,
    );
    results.push({ id, path, sha256: digest, bytes: bytes.length, wrote });
  }
  return results;
}

async function sha256Of(path) {
  try {
    return sha256Bytes(await readFile(path));
  } catch {
    return null;
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        out: { type: "string" },
        samples: { type: "string" },
        force: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`usage: make-samples.mjs [--out <dir>] [--samples id,id] [--force]\n${error.message}`);
    process.exit(2);
    return;
  }
  const ids = values.samples
    ? values.samples.split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  try {
    await ensureSamples({
      ids,
      outDir: values.out ? resolve(values.out) : DEFAULT_OUT,
      force: Boolean(values.force),
    });
  } catch (error) {
    console.error(`[office-quality] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
