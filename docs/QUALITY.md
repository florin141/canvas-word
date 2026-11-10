# Visual quality against Microsoft Office

canvas-word renders `.docx` through two independent paths — the editor's canvas
and the headless PDF exporter. This page records how closely each matches
Microsoft Word's own rendering of the same documents, measured with page-level
grayscale SSIM at 150 DPI.

The numbers are **relative fidelity indicators**, not a claim of byte-identical
output. canvas-word lays out bundled metric-compatible font clones (Calibri →
Carlito, Arial → Arimo, Cambria → Caladea, …), while Word uses the installed
Office fonts. For those families line breaking and pagination agree but glyph
outlines differ. Times New Roman is bundled as the genuine Microsoft face, so
the `times-baseline` sample is the calibration anchor: the same outlines should
land in the same places.

<!-- BEGIN GENERATED VISUAL QUALITY -->

Commit 69dac796 (dirty working tree). Office references: Microsoft Word (16.0). 150 DPI, page-penalized grayscale SSIM, no resampling.

| Sample | Pages (reference) | Canvas SSIM | Canvas pages | PDF SSIM | PDF pages |
| --- | --- | --- | --- | --- | --- |
| Real Word document (basic) | 1 | 0.9757 | 1/1 | 0.9758 | 1/1 |
| Times New Roman calibration | 2 | 0.7773 | 2/2 | 0.7779 | 2/2 |
| Text formatting showcase | 2 | 0.8211 | 2/2 | 0.8220 | 2/2 |
| Tables and merged cells | 2 | 0.8747 | 2/2 | 0.8753 | 2/2 |
| Images: alignment, rotation, crop | 2 | 0.9873 | 2/2 | 0.9872 | 2/2 |
| Feature showcase | 22 | 0.7368 | 23/22 | 0.7370 | 23/22 |
| Long flowing document (15 pages) | 19 | 0.5397 | 17/19 | 0.5416 | 17/19 |

Means cover successful comparisons only; coverage Canvas 7/7, PDF 7/7.
Canvas exact page counts 5/7, absolute page error 3. PDF exact page counts 5/7, absolute page error 3.

canvas-word renders bundled metric-compatible clones (Calibri→Carlito, Arial→Arimo, …); Office references use the installed Office fonts. Metrics match, glyph shapes differ, so absolute SSIM is not comparable to a byte-identical renderer.

<!-- END GENERATED VISUAL QUALITY -->

## How to reproduce

Requirements: Node 22, Windows with Microsoft Word for the authoritative
reference (or LibreOffice for the optional CI path).

```bash
npm ci
npx playwright install chromium

# Generate the deterministic corpus (also happens automatically)
npm run quality:samples

# Full local benchmark against Word, both channels
npm run quality -- --reference word --allow-dirty

# Ad-hoc check of one document (Word reference generated automatically)
npm run quality -- --source "C:\path\to\document.docx" --reference word

# Regenerate the table above from the report
npm run quality:readme -- .source/office-quality/run/report.json --write docs/QUALITY.md
```

The harness refuses to run against a dirty `frontend/` or `shared/` tree unless
`--allow-dirty` is passed, because a report is only reproducible from a known
revision.

## Viewing results

Open `index.html` in the run directory (for example
`.source/office-quality/run/index.html`) in a browser. It is the same
visual-fidelity comparer used by the BetterOffice benchmarks site: a document
sidebar with filter and scores, a page strip, **Swipe** / **Difference** modes, a
**Fit** / **100%** zoom, a draggable split divider, and hold-`B` blinking. It
works directly over `file://` — the stylesheet, script and Geist fonts are
local.

State is kept in the URL: `?doc=<sample>&channel=<canvas|pdf>&page=<n>`. The
“← benchmarks” link opens the run’s small index page, and each per-channel
static gallery keeps the stacked reference/actual/diff images.

## Reading the table

- **SSIM** is the page-penalized mean: every reference page counts, a missing or
  extra page scores zero, and failed comparisons are excluded from the mean but
  shown in the coverage line.
- **Pages** is `rendered/reference`. A mismatch is a real pagination difference
  (font metrics, spacing, table row heights) and is also summarised as exact
  page counts and absolute page error.
- **Canvas vs PDF** should track closely: both use the same layout engine. A
  large gap points at paint/export divergence rather than layout.
- **Coverage** matters: a channel that failed to capture a sample is not
  rewarded. Failed samples appear as `failed` in the table.

## Regression gate

For one-document work, `npm run quality:gate` compares a source + Word PDF
against a recorded baseline and exits non-zero on a score, page-agreement, page
error, or per-page regression. See the
[harness README](../frontend/scripts/office-quality/README.md) for scoring rules,
the corpus layout, reference caching, and the manual CI workflow.
