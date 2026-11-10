// Local-monorepo nicety, run by `npm start` (prestart).
//
// npm workspaces hoist @forevka/wordcanvas to the repo-root node_modules, but
// this example is served from its own folder (`serve .`), so the import map's
// `/node_modules/@forevka/wordcanvas/...` path would 404. Link the workspace
// package into this example's node_modules so the same import map works both
// locally and on StackBlitz (where `npm install` puts the *published* package
// here and this script finds it already in place and does nothing).

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const linkPath = path.join(exampleDir, "node_modules", "@forevka", "wordcanvas");
const workspacePackage = path.resolve(exampleDir, "..", "..", "frontend");
const builtEntry = path.join(workspacePackage, "dist-lib", "wordcanvas.js");

const say = (message) => console.log(`[ai example] ${message}`);

if (existsSync(linkPath)) {
  // Already resolvable: a standalone `npm install` or a previous `npm start`.
} else if (existsSync(builtEntry)) {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    symlinkSync(workspacePackage, linkPath, process.platform === "win32" ? "junction" : "dir");
    say("linked @forevka/wordcanvas -> ../../frontend (workspace build)");
  } catch (error) {
    if (error.code === "EEXIST") {
      // A concurrent run won the race; fine either way.
    } else {
      console.error(`[ai example] could not link the workspace package: ${error.message}`);
      console.error("[ai example] serve the repo root instead: npx serve . (open /examples/ai/)");
      process.exitCode = 1;
    }
  }
} else {
  console.error(
    "[ai example] @forevka/wordcanvas is not resolvable and no local build was found.\n" +
      "  Local monorepo: run `npm run build:lib` from the repo root, then `npm start` again.\n" +
      "  Standalone / StackBlitz: run `npm install` in this folder first.",
  );
  process.exitCode = 1;
}
