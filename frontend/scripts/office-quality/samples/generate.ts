// Deterministic DOCX generators for the visual-quality corpus.
//
// Each generator authors a plain Document through the public builder (or the
// editor's own sample generators) and writes it with the production DOCX writer.
// Two sources of nondeterminism are pinned:
//   • Date — fflate stamps every zip entry with Date.now() and the showcase
//     document embeds DATE fields. `withFrozenTime` fixes both for the duration
//     of one generation.
//   • Ids — every builder gets an explicit idSeed; sampleDoc()/stressDoc() mint
//     ids deterministically from module counters and each runs once per process.
// The result is byte-identical across runs, so reference caching keyed by the
// source SHA survives a corpus rebuild.
import { createCanvas } from "@napi-rs/canvas";
import type { Document } from "@cw/shared";
import { DocumentBuilder } from "../../../src/builder/documentBuilder";
import { writeDocx } from "../../../src/export/docx/writeDocx";
import { sampleDoc } from "../../../src/model/sampleDoc";
import { stressDoc } from "../../../src/model/stressDoc";

export const FIXED_NOW = Date.parse("2026-01-01T00:00:00.000Z");
export const SAMPLE_IDS = [
  "times-baseline",
  "text-showcase",
  "tables",
  "media",
  "showcase",
  "long-flow",
] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

/** Run `fn` with a Date whose now()/no-arg construction is pinned. */
function withFrozenTime<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  const frozen = function (...args: unknown[]): Date {
    if (args.length === 0) return new RealDate(FIXED_NOW);
    const construct = RealDate as unknown as new (...values: unknown[]) => Date;
    return new construct(...args);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(frozen, RealDate);
  (frozen as unknown as { now: () => number }).now = () => FIXED_NOW;
  globalThis.Date = frozen;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const TNR = "Times New Roman";
const BODY_PX = 16; // 12 pt @ 96 dpi
const LOREM =
  "The quick brown fox jumps over the lazy dog while the printer hums in the corner. " +
  "Accuracy depends on metrics, so this paragraph repeats enough words to wrap across " +
  "several lines and exercise justification, hyphenation and line spacing. ";

function paragraphText(seed: string, repeats: number): string {
  return `${seed} ${LOREM.repeat(repeats)}`.trim();
}

// ---------------------------------------------------------------------------
// times-baseline: every run is Times New Roman 12 pt — the calibration anchor.
// Word uses its installed Times New Roman; canvas-word bundles the genuine
// Microsoft face, so outlines and metrics should land identically. Any page-break
// drift here is a layout bug, not a font-substitution artifact.
// ---------------------------------------------------------------------------
function timesBaseline(): Document {
  const b = DocumentBuilder.create({ idSeed: "times-baseline" });
  b.pageSetup({ pageSize: "Letter", margins: { top: 96, right: 96, bottom: 96, left: 96 } });
  b.footer((s) => {
    s.paragraph("Times New Roman calibration").font(TNR).fontSize(12).align("center");
  });
  const title = b.paragraph("Times New Roman Calibration").font(TNR).fontSize(32).bold().align("center");
  title.spacing({ after: 24 });
  b.paragraph(paragraphText("One", 2)).font(TNR).fontSize(BODY_PX).align("justify").spacing({ lineHeight: 1.15, after: 10 });
  b.paragraph("Section One").font(TNR).fontSize(22).bold().spacing({ before: 18, after: 8 });
  b.paragraph(paragraphText("Two", 2)).font(TNR).fontSize(BODY_PX).align("justify").spacing({ lineHeight: 1.15, after: 10 });
  b.list(
    [
      { text: "First bullet in Times New Roman", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
      { text: "Second bullet with the same metrics", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
      { text: "Third bullet closes the list", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
    ],
    { kind: "bullet" },
  );
  b.paragraph("").fontSize(8);
  b.table(
    [
      [
        { text: "Item", style: { fontFamily: TNR, fontSizePx: BODY_PX, bold: true } },
        { text: "Quantity", style: { fontFamily: TNR, fontSizePx: BODY_PX, bold: true } },
        { text: "Notes", style: { fontFamily: TNR, fontSizePx: BODY_PX, bold: true } },
      ],
      [
        { text: "Alpha", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
        { text: "12", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
        { text: "Measured against the installed face", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
      ],
      [
        { text: "Beta", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
        { text: "7", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
        { text: "Same nominal size and leading", style: { fontFamily: TNR, fontSizePx: BODY_PX } },
      ],
    ],
    { headerRow: true, colFractions: [0.22, 0.18, 0.6] },
  );
  b.pageBreak();
  b.paragraph("Page Two").font(TNR).fontSize(22).bold().spacing({ after: 8 });
  b.paragraph(paragraphText("Three", 3)).font(TNR).fontSize(BODY_PX).align("justify").spacing({ lineHeight: 1.15, after: 10 });
  b.paragraph(paragraphText("Four", 3)).font(TNR).fontSize(BODY_PX).align("justify").spacing({ lineHeight: 1.15, after: 10 });
  b.paragraph(paragraphText("Five", 2)).font(TNR).fontSize(BODY_PX).align("justify").spacing({ lineHeight: 1.15 });
  return b.build();
}

// ---------------------------------------------------------------------------
// text-showcase: named heading styles, character formatting, alignment, lists.
// ---------------------------------------------------------------------------
function textShowcase(): Document {
  const b = DocumentBuilder.create({ idSeed: "text-showcase" });
  b.pageSetup({ pageSize: "Letter", margins: { top: 96, right: 96, bottom: 96, left: 96 } });
  b.header((s) => {
    s.paragraph("Text formatting showcase").fontSize(12).color("#666666").align("right");
  });
  b.paragraph("Text Formatting Showcase").withStyle("Heading1").spacing({ after: 16 });
  b.paragraph("This paragraph mixes ").text("bold", { bold: true }).text(", ").text("italic", { italic: true })
    .text(", ").text("underline", { underline: true }).text(", ").text("strike", { strikethrough: true })
    .text(", ").text("color", { color: "#c0392b" }).text(", and ").text("highlight", { highlightColor: "#fff176" })
    .text(". It also demonstrates H").text("2", { verticalAlign: "sub" }).text("O and E=mc").text("2", { verticalAlign: "super" })
    .text(".");
  b.paragraph("Centered paragraph").align("center").spacing({ before: 12, after: 6 });
  b.paragraph("Right-aligned paragraph").align("right").spacing({ after: 6 });
  b.paragraph(paragraphText("Justified:", 1)).align("justify").spacing({ lineHeight: 1.4 });
  b.paragraph("Indented first line").indent({ firstLine: 48 }).spacing({ before: 10 });
  b.paragraph("Section Two").withStyle("Heading2").spacing({ before: 18, after: 8 });
  b.bulletList(["Bullet one", "Bullet two with some additional words to wrap", "Bullet three"]);
  b.numberedList(["Numbered one", "Numbered two", "Numbered three"]);
  b.paragraph("Section Three").withStyle("Heading3").spacing({ before: 18, after: 8 });
  b.paragraph("A quote with a left indent:").indent({ left: 36, right: 36 }).italic().spacing({ after: 6 });
  b.paragraph(paragraphText("Quoted body text", 1)).indent({ left: 36, right: 36 }).spacing({ lineHeight: 1.2 });
  b.pageBreak();
  b.paragraph("Second Page").withStyle("Heading1").spacing({ after: 12 });
  b.paragraph(paragraphText("Continuation", 3)).spacing({ lineHeight: 1.3, after: 8 });
  b.paragraph(paragraphText("Final", 3)).spacing({ lineHeight: 1.3 });
  return b.build();
}

// ---------------------------------------------------------------------------
// tables: header repetition, spans, shading, a nested table, and a long table
// that must break across pages.
// ---------------------------------------------------------------------------
function tables(): Document {
  const b = DocumentBuilder.create({ idSeed: "tables" });
  b.pageSetup({ pageSize: "Letter", margins: { top: 96, right: 96, bottom: 96, left: 96 } });
  b.paragraph("Tables").withStyle("Heading1").spacing({ after: 12 });
  b.paragraph("A merged-cell table with shading:").spacing({ after: 6 });
  b.table((t) => {
    t.row([
      { text: "Region", shading: "#dce6f1", style: { bold: true } },
      { text: "Q1", shading: "#dce6f1", style: { bold: true } },
      { text: "Q2", shading: "#dce6f1", style: { bold: true } },
      { text: "Q3", shading: "#dce6f1", style: { bold: true } },
    ]);
    t.row([
      { text: "North", rowSpan: 2, vAlign: "center", shading: "#f2f2f2" },
      "120",
      "135",
      "150",
    ]);
    t.row(["", "128", "142", "161"]);
    t.row([{ text: "Total", style: { bold: true } }, { text: "248", colSpan: 2, align: "right" }, "311"]);
  }, { colFractions: [0.34, 0.22, 0.22, 0.22] });

  b.paragraph("A nested table inside a cell:").spacing({ before: 16, after: 6 });
  b.table((t) => {
    t.row([
      (s) => {
        s.paragraph("Outer cell");
        s.table([
          ["Inner A", "Inner B"],
          ["Inner C", "Inner D"],
        ], { headerRow: true });
        // Word rejects a cell whose block content ends with a nested table;
        // a trailing paragraph is part of the valid OOXML cell shape.
        s.paragraph("");
      },
      "Neighbour",
    ]);
  });

  b.paragraph("A long table with a repeated header row:").spacing({ before: 16, after: 6 });
  b.table((t) => {
    t.row(["#", "Metric", "Value", "Delta"], { header: true });
    for (let index = 1; index <= 24; index += 1) {
      t.row([String(index), `Metric ${index}`, String(100 + index * 3), `${index % 2 === 0 ? "+" : "−"}${index % 7}`]);
    }
  }, { headerRow: true, colFractions: [0.1, 0.4, 0.25, 0.25] });
  return b.build();
}

// ---------------------------------------------------------------------------
// media: images at several alignments/sizes, plus a rotation and a crop.
// A generated gradient tile keeps the fixture self-contained (PNG is the one
// raster format the PDF exporter decodes).
// ---------------------------------------------------------------------------
function tilePng(): Uint8Array {
  const width = 320;
  const height = 180;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1a73e8");
  gradient.addColorStop(1, "#9c27b0");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("canvas-word", 24, height / 2 + 10);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function media(): Document {
  const image = { data: tilePng(), mime: "image/png" };
  const b = DocumentBuilder.create({ idSeed: "media" });
  b.pageSetup({ pageSize: "Letter", margins: { top: 96, right: 96, bottom: 96, left: 96 } });
  b.paragraph("Images").withStyle("Heading1").spacing({ after: 12 });
  b.paragraph("Left-aligned 288×162:").spacing({ after: 6 });
  b.image(image, { widthPx: 288, heightPx: 162, align: "left" });
  b.paragraph("Centered 240×135:").spacing({ before: 16, after: 6 });
  b.image(image, { widthPx: 240, heightPx: 135, align: "center" });
  b.paragraph("Right-aligned 192×108:").spacing({ before: 16, after: 6 });
  b.image(image, { widthPx: 192, heightPx: 108, align: "right" });
  b.pageBreak();
  b.paragraph("Rotated and cropped").withStyle("Heading2").spacing({ after: 12 });
  b.paragraph("Rotated 8°:").spacing({ after: 6 });
  b.image(image, { widthPx: 240, heightPx: 135, align: "center", rotation: 8 });
  b.paragraph("Cropped to the inner window:").spacing({ before: 16, after: 6 });
  b.image(image, {
    widthPx: 240,
    heightPx: 135,
    align: "center",
    crop: { left: 0.15, top: 0.15, right: 0.15, bottom: 0.15 },
  });
  return b.build();
}

const GENERATORS: Record<SampleId, () => Document> = {
  "times-baseline": timesBaseline,
  "text-showcase": textShowcase,
  tables,
  media,
  showcase: sampleDoc,
  "long-flow": () => stressDoc(15),
};

/** Generate one corpus DOCX. Deterministic for a given id and process. */
export function generateSample(id: SampleId): Uint8Array {
  const factory = GENERATORS[id];
  if (!factory) throw new Error(`Unknown sample id: ${id}`);
  return withFrozenTime(() => writeDocx(factory()).bytes);
}
