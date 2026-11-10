import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGlob, resolveSample, selectSamples, validateManifest } from "./corpus.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MANIFEST = {
  schema_version: 1,
  samples: [
    { id: "fixture", title: "Fixture", kind: "file", path: "frontend/fixture.docx" },
    { id: "showcase", title: "Showcase", kind: "generated", generator: "showcase" },
    { id: "optional", title: "Optional", kind: "glob", path: "Rendered*.docx", optional: true },
  ],
};

describe("office-quality manifest", () => {
  it("accepts the checked-in schema", () => {
    expect(validateManifest(MANIFEST).samples).toHaveLength(3);
  });

  it("rejects duplicate ids, bad kinds, and missing generators", () => {
    expect(() => validateManifest({ schema_version: 1, samples: [MANIFEST.samples[0], { ...MANIFEST.samples[0] }] })).toThrow(/Duplicate/);
    expect(() => validateManifest({ schema_version: 1, samples: [{ id: "x", title: "X", kind: "nope" }] })).toThrow(/unsupported kind/);
    expect(() => validateManifest({ schema_version: 1, samples: [{ id: "x", title: "X", kind: "generated" }] })).toThrow(/generator/);
    expect(() => validateManifest({ schema_version: 2, samples: MANIFEST.samples })).toThrow(/schema/);
  });

  it("selects samples by id and rejects unknown ids", () => {
    expect(selectSamples(MANIFEST, "fixture,showcase").map((sample: { id: string }) => sample.id)).toEqual(["fixture", "showcase"]);
    expect(() => selectSamples(MANIFEST, "missing")).toThrow(/Unknown/);
  });

  it("resolves an absolute ad-hoc source path", async () => {
    const root = await mkdtemp(join(tmpdir(), "cw-adhoc-"));
    directories.push(root);
    const file = join(root, "Exit Interview.docx");
    await writeFile(file, "docx");
    expect(await resolveSample({ id: "adhoc", title: "Ad-hoc", kind: "file", path: file })).toBe(file);
  });

  it("resolves a glob in a subdirectory of the corpus root", async () => {
    const root = await mkdtemp(join(tmpdir(), "cw-corpus-"));
    directories.push(root);
    await mkdir(join(root, "frontend"));
    await writeFile(join(root, "frontend", "RenderedReports-a.docx"), "a");
    await writeFile(join(root, "frontend", "RenderedReports-b.docx"), "b");
    await writeFile(join(root, "frontend", "notes.txt"), "c");
    expect(await resolveGlob("frontend/RenderedReports*.docx", root)).toEqual([
      join(root, "frontend", "RenderedReports-a.docx"),
      join(root, "frontend", "RenderedReports-b.docx"),
    ]);
    expect(await resolveGlob("*.docx", root)).toEqual([]);
  });
});
