// Render a benchmark report.json as Markdown, optionally updating a docs file
// between generated-content markers.
//
//   node readme.mjs .source/office-quality/run/report.json
//   node readme.mjs .source/office-quality/run/report.json --write docs/QUALITY.md
//
// `--write` replaces ONLY the text between the BEGIN/END markers; everything
// else in the target file is preserved. Missing markers are an error — the tool
// never guesses where a generated section belongs.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { aggregateReport, renderSection } from "./lib/report.mjs";
import { readJson } from "./lib/files.mjs";

export const BEGIN = "<!-- BEGIN GENERATED VISUAL QUALITY -->";
export const END = "<!-- END GENERATED VISUAL QUALITY -->";

const errorText = (error) => (error instanceof Error ? error.message : String(error));

/** Replace the generated block in `text`; throws when either marker is absent. */
export function updateMarkedSection(text, section) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`target file must contain ${BEGIN} … ${END} markers`);
  }
  return `${text.slice(0, start + BEGIN.length)}\n\n${section.trim()}\n\n${text.slice(end)}`;
}

async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      options: {
        write: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    console.error(`usage: readme.mjs <report.json> [--write <markdown-file>]\n${error.message}`);
    process.exit(2);
    return;
  }
  const input = positionals[0];
  if (!input) {
    console.error("usage: readme.mjs <report.json> [--write <markdown-file>]");
    process.exit(2);
    return;
  }
  let report;
  try {
    report = await readJson(resolve(input));
  } catch (error) {
    console.error(`[office-quality] could not read ${input}: ${errorText(error)}`);
    process.exit(1);
    return;
  }
  const section = renderSection(report.summary ? report : aggregateReport(report));
  if (!values.write) {
    process.stdout.write(section);
    return;
  }
  const target = resolve(values.write);
  try {
    const text = await readFile(target, "utf8");
    await writeFile(target, updateMarkedSection(text, section));
  } catch (error) {
    console.error(`[office-quality] ${errorText(error)}`);
    process.exit(1);
    return;
  }
  console.log(`[office-quality] updated ${target}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
