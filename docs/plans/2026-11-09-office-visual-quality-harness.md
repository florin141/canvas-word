# Implementation Plan: Office Visual Quality Harness (DOCX)

## Requirements Restatement

Build a local-first harness that measures how faithfully canvas-word renders real `.docx` files compared with Microsoft Office, modeled on `D:\DEV\betteroffice\scripts\office-quality`:

- **Two render channels**, both compared against Word:
  - **canvas**: What the editor paints (`openDocx` → page canvases).
  - **pdf**: The headless import → PDF export pipeline, rasterized.
- **SSIM at 150 DPI**: Page-penalized grayscale score, no resampling, white pad/crop allowed only at the right/bottom edge within 1 px. Missing/extra pages are penalized; failed comparisons have no score and are excluded from means but counted in coverage.
- **Corpus**: A corpus of samples (committed fixture + deterministically generated docs) plus support for ad-hoc local documents.
- **Regression Gate**: A one-document regression gate (`private-ssim.mjs` equivalent): source `.docx` + Word reference PDF + optional baseline → exit 1 on regression, with first diverging page and per-page drops.
- **Reporting**: Generated benchmark Markdown (and JSON) reporting SSIM, coverage, exact-page counts, and page error.
- **CI**: Optional manual CI using LibreOffice as the reference engine on Linux; Word remains the authoritative local oracle.
- **Constraints**: No production renderer changes — the harness drives existing dev hooks (`.source/` output, ignored). Scope is DOCX only. Public R2 corpus, sharding, and npm-published-vs-commit comparison are out of scope for v1.

## Key Design Decisions (with rationale)

1. **Harness Location**: Lives in `frontend/scripts/office-quality/`, not repo root. Reason: it consumes frontend devDependencies (playwright, esbuild, vitest) and its pure-logic tests are picked up by the existing vitest run in that workspace. Outputs go to repo-root `.source/office-quality/`.
2. **Node-only Toolchain**: No Python venv. `pdfjs-dist` + `@napi-rs/canvas` rasterize PDFs and decode/encode PNGs; SSIM is a small pure-JS module. Setup: `npm ci && npx playwright install chromium`.
3. **Capture Method**: Via canvas backing store, not OS screenshots. Set DPR 1 and zoom `150/96` → `canvas.toDataURL()` is exactly the 150-DPI raster. Pages scrolled into view sequentially due to virtualization.
4. **PDF Channel**: Runs headless in Node: `runImport(...)` → `runExport(doc, "pdf", images)` → rasterize. Exercises real isomorphic pipeline without moving multi-MB blobs through Playwright.
5. **References**: Word references locally via COM; LibreOffice optionally in CI. Verified: Word 16.0 COM works; LibreOffice absent locally; Node-only choice reinforced.
6. **Font Caveat**: First-class in docs. canvas-word uses bundled metric clones (Calibri→Carlito, etc.), while Word uses installed Office fonts. Metrics match, glyph shapes differ. A Times-New-Roman calibration sample anchors the scale.
7. **Revision-Pinned Reports**: Block runs when `frontend/` or `shared/` has tracked modifications. Output directory must be empty.

## Patterns to Mirror

| Category | Source | Pattern |
| :--- | :--- | :--- |
| Naming & script headers | `frontend/scripts/build-node.mjs:1` | kebab-case `.mjs`, JSDoc header stating purpose + usage |
| Logging | `frontend/scripts/build-node.mjs:82`, `scripts/dev-online.mjs:14` | `console.log("[office-quality] …")` phase-prefixed progress |
| CLI errors | `frontend/scripts/compare-pdfs.mjs:8`, `scripts/dev-online.mjs:16` | usage → exit(2); actionable message → exit(1) |
| Child process lifecycle | `scripts/dev-online.mjs:8-44` | spawn + SIGINT/SIGTERM cleanup; extend with process-group kill and startup deadline |
| Tests | `frontend/src/export/docx/showcaseArtifact.test.ts:9`, `frontend/src/export/e2e.test.ts:12` | colocated vitest; skip cleanly when a large local fixture is absent |
| Deterministic artifacts | `frontend/src/clearscript/entry.ts:82` | pin timestamps when byte reproducibility matters |
| Editor dev hooks | `frontend/src/main.ts:88`, `frontend/src/editorApp.ts:5725` | `window.__wc` wrapper API; `window.__cw.{doc,engine,editor}` layout access |
| Capture target | `frontend/src/paint/renderer.ts:656,755,584` | canvas per mounted page; scale = dpr × zoom; scroll to mount |
| PDF pipeline | `frontend/src/import/docx/pipeline.ts:31`, `frontend/src/export/pipeline.ts:46` | `runImport` with `collectMediaBytes`; `runExport` with resolved image bytes |
| CI job shape | `.github/workflows/ci.yml:34` | checkout → setup-node 22 → npm ci → job-specific steps → artifacts |
| Report/score rules | `D:\DEV\betteroffice\scripts\office-quality\compare.py` + `private_ssim.py` | page-penalized SSIM, ±1 px edge adjustment, coverage alongside means, baseline drop rules |

*Note: No prior Word-COM or Playwright-capture code exists in this repo — those are new patterns.*

## Files to Create / Change

| File | Action | Why |
| :--- | :--- | :--- |
| `.gitignore` | UPDATE | add `.source/` (corpus, references, runs, galleries) |
| `package.json` | UPDATE | root quality, quality:gate, quality:readme delegating scripts |
| `frontend/package.json` | UPDATE | add pinned devDeps `@napi-rs/canvas`, `pdfjs-dist`, `diff`; add `quality*` scripts |
| `frontend/scripts/office-quality/README.md` | CREATE | adapted from BetterOffice: scoring, gate, benchmark setup, corpus, references, limits |
| `.../corpus.json` | CREATE | checked-in manifest: fixture + generated + optional local samples |
| `.../run.mjs` | CREATE | orchestrator (selection, dirty/output guards, failure isolation, report) |
| `.../private-ssim.mjs` | CREATE | one-doc gate with baseline regression exit code |
| `.../capture.mjs` | CREATE | Playwright canvas capture + `pages_text.json` + `result.json` |
| `.../pdf-channel.mjs` | CREATE | Node import → PDF export → rasterize |
| `.../serve.mjs` | CREATE | free port, Vite dev server lifecycle, readiness wait |
| `.../reference.mjs`, `reference-word.ps1`, `reference-libreoffice.mjs` | CREATE | reference PDF generation + caching by source SHA |
| `.../rasterize.mjs` | CREATE | PDF → `page_NNNN.png` at 150 DPI + `pages.json` (bounds, text lines) |
| `.../make-samples.mjs`, `.../samples/generate.ts` | CREATE | esbuild-bundled deterministic DOCX generation |
| `.../readme.mjs` | CREATE | `report.json` → Markdown; optional marker-based doc update |
| `.../lib/{hash,corpus,png,ssim,compare,report,files,process,text}.mjs` | CREATE | pure, testable logic |
| `.../lib/*.test.ts` | CREATE | SSIM, compare penalties, manifest, report, rasterization, text alignment |
| `.github/workflows/visual-quality.yml` | CREATE | manual-only LibreOffice CI + artifact upload |
| `docs/QUALITY.md` | CREATE | benchmark results + how to reproduce (linked from README/EXPORT) |
| `CHANGELOG.md` | UPDATE | `### Added` under `## [Unreleased]` |

## Implementation Phases

### Phase 0 — Scaffolding (0.5 day)
- Add `.source/` to `.gitignore`; add npm scripts; add pinned devDependencies (`@napi-rs/canvas@1.1.0`, `pdfjs-dist@6.5.438`, `diff@9.0.0`).
- Create the directory + README skeleton documenting intended commands and the font caveat.
- **Validate**: `npm install` clean; `npm test` and `npm run typecheck` unchanged/green.

### Phase 1 — Score engine, pure and testable (1–1.5 days)
- `lib/png.mjs`: load PNG, composite over white, grayscale using ITU-R 601-2 luma, pixel access, PNG encode.
- `lib/ssim.mjs`: 7×7 uniform-window SSIM, sample covariance, C1=(0.01·255)², C2=(0.03·255)², mean over valid pixels; integral-image implementation for O(N).
- `lib/compare.mjs`: validate status/DPI/source SHA equality; exact size required unless |Δ|≤1 on each axis → white pad/crop; score 0 + note otherwise; page-penalized mean; common-page mean; per-page rows; `score.json`; HTML gallery.
- `lib/corpus.mjs` + `corpus.json`: schema/id/hash validation, optional samples, selection.
- `lib/report.mjs`: per-channel means over successful comparisons only, scored/total coverage, exact-page count, absolute page error; Markdown section.
- **Tests**: identical images = 1.0; missing page penalty; extra page penalty; ±1 px accepted; 2 px mismatch = 0; SHA/DPI mismatch rejected; aggregation excludes failures; manifest rejects duplicates/bad ids.
- **Validate**: `npx vitest run scripts/office-quality` from `frontend/`.

### Phase 2 — Reference generation and rasterization (1 day)
- `rasterize.mjs`: `pdfjs-dist` in Node with `@napi-rs/canvas`; scale 150/72; `Math.ceil` dimensions; write `result.json` and `pages.json`.
- `reference-word.ps1`: Word COM ExportAsFixedFormat(pdf, 17, OpenAfterExport=$false); Visible=$false, DisplayAlerts=0, read-only open, timeout, COM release, version recorded. Invoked through `reference.mjs`.
- `reference-libreoffice.mjs`: SOFFICE/soffice/libreoffice discovery, isolated UserInstallation profile, headless PDF export.
- Reference caching keyed by source SHA; regenerate on mismatch; record engine identity.
- **Tests**: generate a PDF with existing pdfkit, rasterize, assert page count/DPI; verify text lines extracted.
- **Validate**: reference a generated DOCX with Word locally; page PNG dimensions match ceil(pt·150/72).

### Phase 3 — Capture channels (1.5–2 days)
- `serve.mjs`: resolve Vite via createRequire, start on a free port with `--strictPort`, wait for HTTP readiness, kill on exit (process group on Windows).
- `capture.mjs`:
  - Launch Chromium (deviceScaleFactor: 1), navigate to the dev harness.
  - `page.route` serves the DOCX at `/__quality__/source.docx`; `window.__wc.openDocx(bytes)`.
  - Fail capture if resulting model block count differs from Node-side `runImport`.
  - `editor.setZoom(150/96)`, verify `getZoom()`.
  - For each page: `scrollIntoView` → wait for `[data-page="i"]` canvas → two stable `toDataURL()` reads → save `page_0001.png`.
  - Record `result.json` and `pages_text.json` from `engine.layout(doc)`.
- `pdf-channel.mjs`: Node import → resolve image bytes → `runExport(...,"pdf")` → rasterize.
- `make-samples.mjs` + `samples/generate.ts`: esbuild-bundle generator, freeze Date, pin zip mtimes. Write:
  - `real-word-basic` (committed fixture),
  - `times-baseline` (all Times New Roman — calibration),
  - `text-showcase`, `tables`, `media`,
  - `showcase` (`sampleDoc()`), `long-flow` (`stressDoc(15)`),
  - optional `local-report` if present.
- **Validate**: smoke run on `times-baseline` + `showcase`; inspect PNGs and page counts before scoring.

### Phase 4 — Orchestrator, gate, docs (1–1.5 days)
- `run.mjs`: env/flag selection (`QUALITY_SAMPLES`, `QUALITY_CHANNEL`, `QUALITY_REFERENCE`), dirty-source guard, empty-output guard, per-sample/per-channel try/catch with failure reason, `report.json` + `section.md` + `index.html`.
- `private-ssim.mjs`: `--source`, `--reference-pdf`, `--out`, `--channel`, `--baseline`, `--write-baseline`; prints summary; exits 1 when penalized SSIM drops > 0.001, page agreement drops, absolute page error worsens, or a page drops > 0.005.
- `readme.mjs`: prints Markdown; `--write docs/QUALITY.md` updates only between markers.
- Harness README: scoring rules, setup, benchmark commands, reference generation, local gate, corpus layout, CI, known limitations.
- **Validate**: intentional regression produces lower score and gate exit 1; revert.

### Phase 5 — Manual CI and documentation (0.5–1 day)
- `.github/workflows/visual-quality.yml`: workflow_dispatch inputs, ubuntu-latest, Node 22, npm ci, npx playwright install chromium, install LibreOffice + fonts, generate samples, LO references, run harness, upload artifacts. No README commits.
- `docs/QUALITY.md` with a first local Word run's table; link from README and `docs/EXPORT.md`; CHANGELOG entry.

### Phase 6 (Optional) — Writer round-trip channel
- `roundtrip` channel: source.docx → canvas-word DOCX export → Word PDF → compare against editor's render. Isolates writer regressions. Add word-level text-aligned SSIM and break agreement.

## Validation Commands

```bash
# from repo root
npm ci
npx playwright install chromium

# unit/type gates (existing)
npm run typecheck
npm test

# harness unit tests only (fast, no Word/Playwright)
npm test --workspace @forevka/wordcanvas -- scripts/office-quality

# full local benchmark (Word installed; sources must be committed)
npm run quality -- --reference word --channel both

# one-document regression gate against a Word PDF
npm run quality:gate -- --source .source/office-quality/corpus/showcase/source.docx \
  --reference-pdf .source/office-quality/private/word.pdf \
  --out .source/office-quality/private/run \
  --baseline .source/office-quality/private/baseline.json

# regenerate the Markdown table
npm run quality:readme -- .source/office-quality/run/report.json
