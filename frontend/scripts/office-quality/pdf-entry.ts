// Harness entry for the headless import → PDF export pipeline. Bundled by
// pdf-channel.mjs with esbuild (platform: node, @cw/shared aliased to source)
// because the pipeline is TypeScript and this harness runs under plain Node.
//
// Keeping the bundle here (rather than importing dist-node) means the PDF
// channel always measures the working tree, including uncommitted renderer
// changes — which is exactly what the local harness is for.
import type { Block, Document } from "@cw/shared";
import { runImport } from "../../src/import/docx/pipeline";
import { runExport } from "../../src/export/pipeline";

export interface ImportedDocument {
  doc: Document;
  images: Record<string, Uint8Array>;
  warnings: { code: string; message?: string }[];
  blockCount: number;
}

/** Recursive block count, matching the editor's Node-side import accounting. */
export function countBlocks(blocks: Block[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) count += countBlocks(cell.blocks);
      }
    }
  }
  return count;
}

/** Import a .docx, collecting embedded image bytes for the later export. */
export function importDocx(bytes: Uint8Array): ImportedDocument {
  const result = runImport(bytes, undefined, { collectMediaBytes: true });
  const images: Record<string, Uint8Array> = {};
  for (const media of result.media) images[media.src] = media.bytes;
  return {
    doc: result.doc,
    images,
    warnings: result.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
    blockCount: countBlocks(result.doc.blocks),
  };
}

/** Export the imported document as PDF bytes. */
export async function exportPdf(doc: Document, images: Record<string, Uint8Array>): Promise<Uint8Array> {
  const result = await runExport(doc, "pdf", images);
  return result.bytes;
}
