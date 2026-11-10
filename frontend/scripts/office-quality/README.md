# Office visual quality harness (DOCX)

Local-first measurement of how faithfully canvas-word renders real `.docx` files
compared with Microsoft Office. The harness drives the existing editor and
export pipelines through their dev hooks — it does **not** change the renderer.

Two render channels are compared against the same office reference:

| Channel | What it exercises |
| :--- | :--- |
| `canvas` | The editor's real paint path: import → layout → mounted page canvases. |
| `pdf` | The headless Node pipeline: `runImport` → `runExport(doc, "pdf")` → raster. |

The reference is a PDF exported by Microsoft Word (authoritative, local) or
LibreOffice (optional, CI). Both channels and the reference are rasterized to
150 DPI and scored with grayscale SSIM.

## Scoring rules

- **150 DPI, no resampling.** A PDF point is 1/72 inch, so the raster scale is
  exactly `150/72`; page pixel dimensions are `ceil(pt × scale)`.
- **Grayscale SSIM**, 7×7 uniform window, sample covariance,
  C1 = (0.01·255)², C2 = (0.03·255)² — the same defaults as
  `skimage.metrics.structural_similarity`. Pages are composited over white
  first, so transparent page backgrounds compare like paper.
- **Page-penalized mean.** A missing or extra page contributes `0` and stays in
  the denominator, so dropping a page cannot improve the score. `score.json`
  also records the common-page mean.
- **Page dimensions** must match exactly. A right/bottom edge difference of at
  most 1 px is white-padded/cropped without shifting content (the canvas and PDF
  rounders disagree by one pixel on some sizes). A larger mismatch scores `0`
  with a note.
- **Source hashes** must agree when both renders record one (both channels do:
  they record the source `.docx` SHA-256).
- **Text alignment** (word-stream diff) is reported as a secondary metric:
  `aligned_mean_ssim`, `page_agreement`, `first_divergence_page`. It never
  rewrites the primary score.
- **Failed comparisons have no score.** They are excluded from means but counted
  in coverage, so a channel that skipped half the corpus cannot look better than
  it is.

## Setup

From the repository root:

```bash
npm ci
npx playwright install chromium
```

Microsoft Word (Windows) is required for `--reference word`. LibreOffice is
required only for `--reference libreoffice`; the manual CI workflow installs it.

## Commands

Run from the repository root:

```bash
# Generate the deterministic corpus (auto-runs during `quality` when needed)
npm run quality:samples

# Full local benchmark against Word (dirty tree must be opted into)
npm run quality -- --reference word --allow-dirty

# Ad-hoc check of any .docx (auto Word reference, both channels, own viewer)
npm run quality -- --source "C:\path\to\document.docx" --reference word

# Subset + one channel
npm run quality -- --samples times-baseline,showcase --channel canvas --allow-dirty

# One-document regression gate
npm run quality:gate -- \
  --source .source/office-quality/corpus/showcase/source.docx \
  --reference-pdf .source/office-quality/private/word.pdf \
  --out .source/office-quality/private/run \
  --baseline .source/office-quality/private/baseline.json

# Record/refresh a baseline
npm run quality:gate -- ... --write-baseline

# Print the Markdown table (or update docs between markers)
npm run quality:readme -- .source/office-quality/run/report.json
npm run quality:readme -- .source/office-quality/run/report.json --write docs/QUALITY.md
```

Environment variables mirror the flags: `QUALITY_SAMPLES`, `QUALITY_CHANNEL`,
`QUALITY_REFERENCE`.

A benchmark run refuses to start when `frontend/` or `shared/` has tracked
modifications (reports are revision-pinned); pass `--allow-dirty` to record a
dirty-tree result. The output directory must be empty.

### Ad-hoc documents

`--source <file.docx>` replaces `--samples` with one local document (the path
may be absolute or repo-relative). It generates the Word/LibreOffice reference
on demand, runs the selected channels, and writes a full report + viewer under
`.source/office-quality/checks/<slug>-<timestamp>/`:

```bash
npm run quality -- --source "C:\Users\me\Downloads\report.docx" --reference word
npm run quality -- --source ./docs/sample.docx --channel pdf   # PDF channel only
```

Ad-hoc checks run against the working tree (dirty changes are allowed and the
report is marked dirty). Pass `--out <dir>` to choose the output location; the
directory must be empty.

## Corpus

`frontend/scripts/office-quality/corpus.json` is the checked-in manifest.
Sources themselves live under the git-ignored `.source/office-quality/corpus/`:

| Sample | Kind | Purpose |
| :--- | :--- | :--- |
| `real-word-basic` | committed fixture | A real Word-authored document. |
| `times-baseline` | generated | Every run in Times New Roman — font calibration anchor. |
| `text-showcase` | generated | Named styles, character formatting, alignment, lists. |
| `tables` | generated | Merged cells, shading, nested table, repeated header, page break. |
| `media` | generated | Image alignment, rotation, crop. |
| `showcase` | generated | `sampleDoc()` — the editor's flagship feature document. |
| `long-flow` | generated | `stressDoc(15)` — pagination at scale. |
| `local-report` | optional glob | `frontend/RenderedReports*.docx`, when present locally. |

Generated samples freeze `Date` and pin builder id seeds, so the same generator
produces byte-identical `.docx` files across runs.

## References

A reference is cached under `.source/office-quality/references/<engine>/` keyed
by the source's SHA-256. Editing the document invalidates its reference; re-runs
reuse it.

- **Word**: `reference-word.ps1` automates Word over COM (read-only open, no
  alerts, PDF `ExportAsFixedFormat`, guaranteed document close / app quit). The
  Word version is recorded in the report.
- **LibreOffice**: `reference-libreoffice.mjs` runs headless with a throwaway
  `UserInstallation` profile, so concurrent conversions cannot share state. The
  binary is found via `SOFFICE` / `LIBREOFFICE`, common install paths, or `PATH`.

## Regression gate

`quality:gate` renders one document, compares it with a supplied reference PDF,
and exits `1` against a baseline when:

- penalized SSIM drops by more than `0.001`,
- page agreement drops at all,
- absolute page error gets worse, or
- any page's SSIM drops by more than `0.005` (the first such page is printed).

`--write-baseline` records the current run; without a baseline the gate simply
prints the score.

## Viewer

Every `quality` run writes an interactive visual-fidelity comparer to
`<out>/index.html`, matching the BetterOffice benchmarks comparer: a document
sidebar with filter and scores, page strip, Swipe/Difference modes, Fit/100%
zoom, a draggable split divider, and hold-`B` blinking. `<out>/dashboard.html`
is the small benchmarks index behind the “← benchmarks” link.

Open the file directly — it works over `file://` (the stylesheet, script and
Geist fonts are local; fonts are inlined as data URIs):

```bash
# Windows
start "" .source\office-quality\run\index.html
# macOS
open .source/office-quality/run/index.html
# Linux
xdg-open .source/office-quality/run/index.html
```

Controls:

- **Sidebar** — filter documents; entries are ranked by the selected channel’s
  score (failures first), showing format, id and score.
- **Canvas / PDF** — choose the render channel being compared.
- **Swipe** — drag the divider to reveal the actual render over the reference.
- **Difference** — difference-blend the two pages.
- **Fit / 100%** — fit the page to the stage or show it at native 150-DPI size.
- **Page strip** — numbered page buttons; a dashed page has no common page.
- `←` / `→` change page; hold `B` to blink between reference and render.

State is kept in the URL:
`?doc=<sample>&channel=<canvas|pdf>&page=<n>`. The same run also writes the
static per-channel galleries (`<sample>/compare-<channel>/index.html`) with the
reference/actual/diff images stacked.

## Output layout

```
.source/office-quality/
  build/                         esbuild bundles (samples + PDF pipeline)
  corpus/<sample>/source.docx    deterministic corpus
  references/<engine>/<sha>.pdf  cached office references + metadata
  run/
    report.json                  benchmark report (means, coverage, page errors)
    section.md                   generated Markdown
    index.html                   fidelity comparer (sidebar, swipe/difference, zoom)
    dashboard.html               benchmarks index behind “← benchmarks”
    viewer/                      styles.css, compare.js, Geist fonts (vendored)
    <sample>/
      reference/ page_*.png + pages.json + result.json
      canvas/    page_*.png + pages_text.json + result.json
      pdf/       page_*.png + pages.json + result.json + export.pdf
      compare-<channel>/ score.json + index.html + page_*.{reference,actual,diff}.png
```

`.source/` is git-ignored; nothing in this harness is published.

## CI

`.github/workflows/visual-quality.yml` is a **manual** workflow
(`workflow_dispatch`). It runs on Ubuntu with LibreOffice as the reference
engine and uploads the run directory as an artifact. Word remains the
authoritative local oracle; CI LibreOffice numbers are a secondary signal and
are not committed to the repository.

## Known limitations

- **Font substitution.** canvas-word renders bundled metric-compatible clones
  (Calibri→Carlito, Arial→Arimo, Cambria→Caladea, …). Word uses the installed
  Office fonts. Metrics match, glyph shapes differ, so absolute SSIM is not
  comparable to a byte-identical renderer. Times New Roman is bundled as the
  genuine face, so `times-baseline` is the calibration anchor.
- **DOCX only.** PPTX/XLSX, public R2 corpora, sharding, and npm-published-vs-commit
  comparison are out of scope for v1.
- **Canvas capture is sequential.** Pages are mounted on demand, so each page is
  scrolled into view and must produce two identical frames. Image-heavy pages
  take a little longer; this is deliberate (a blank early frame never scores).
- **Word COM is Windows-only.** Use LibreOffice in CI or on other platforms.
- **Layout, not content, is measured.** The two channels can disagree on page
  count while producing nearly identical pixels; page counts, agreement, and
  absolute page error are reported next to SSIM rather than folded into it.
