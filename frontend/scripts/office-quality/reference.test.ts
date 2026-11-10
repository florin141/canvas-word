import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveReference } from "./reference.mjs";
import { sha256File } from "./lib/files.mjs";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cw-reference-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A .docx is required by the API; the fake generator never reads its contents. */
async function sourceDocx(dir: string): Promise<string> {
  const path = join(dir, "source.docx");
  await writeFile(path, "fake-docx");
  return path;
}

function fakeGenerator(calls: string[], version = "16.0") {
  return async (_source: string, output: string) => {
    calls.push(output);
    await writeFile(output, "%PDF-1.4\nfake reference\n");
    return { version };
  };
}

describe("resolveReference", () => {
  it("generates once, then reuses the cache, and regenerates on --force", async () => {
    const dir = await tempDir();
    const source = await sourceDocx(dir);
    const calls: string[] = [];
    const generators = { word: fakeGenerator(calls) };

    const first = await resolveReference({ source, cacheDir: join(dir, "cache"), generators });
    expect(first.cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(first.metadata).toMatchObject({
      status: "ok",
      engine: "word",
      engine_version: "16.0",
      source_sha256: await sha256File(source),
    });
    expect(first.metadata.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await readFile(first.pdfPath, "utf8")).startsWith("%PDF")).toBe(true);

    const second = await resolveReference({ source, cacheDir: join(dir, "cache"), generators });
    expect(second.cached).toBe(true);
    expect(second.pdfPath).toBe(first.pdfPath);
    expect(calls).toHaveLength(1);

    const forced = await resolveReference({ source, cacheDir: join(dir, "cache"), generators, force: true });
    expect(forced.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("regenerates when the cached metadata is unreadable", async () => {
    const dir = await tempDir();
    const source = await sourceDocx(dir);
    const calls: string[] = [];
    const generators = { word: fakeGenerator(calls) };
    const cacheDir = join(dir, "cache");
    const first = await resolveReference({ source, cacheDir, generators });
    const metadataPath = first.pdfPath.replace(/\.pdf$/, ".json");
    await writeFile(metadataPath, "{ not json");
    const second = await resolveReference({ source, cacheDir, generators });
    expect(second.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("removes a partial PDF when generation fails", async () => {
    const dir = await tempDir();
    const source = await sourceDocx(dir);
    const cacheDir = join(dir, "cache");
    const generators = {
      word: async (_source: string, output: string) => {
        await writeFile(output, "%PDF-partial");
        throw new Error("word crashed");
      },
    };
    await expect(resolveReference({ source, cacheDir, generators })).rejects.toThrow(/word crashed/);
    const engineDir = join(cacheDir, "word");
    expect(await readdir(engineDir)).toEqual([]);
  });

  it("rejects unknown engines and missing sources", async () => {
    const dir = await tempDir();
    const source = await sourceDocx(dir);
    await expect(resolveReference({ source, engine: "notepad", cacheDir: dir })).rejects.toThrow(/Unknown reference engine/);
    await expect(resolveReference({ source: join(dir, "missing.docx"), cacheDir: dir })).rejects.toThrow(/missing/);
  });
});
