// Page-text extraction and alignment.
//
// A page break that lands one line early destroys raw page-N-vs-page-N SSIM even
// though the document is intact. Like the reference harness, we build a word
// stream from the non-repeated lines of every page, find the longest matching
// runs, and map each reference page's start to the actual page that contains the
// equivalent words. The comparator then reports an aligned SSIM and break
// agreement alongside the penalized score.
import { diffArrays } from "diff";

/** Words with digits collapsed, matching the reference harness's normalization. */
export function words(line) {
  return line
    .toLowerCase()
    .replace(/\d+/g, "0")
    .match(/[^\W_]+/gu) ?? [];
}

/** Flatten page lines to a word stream, tracking each word's (page, line). */
export function bodyStream(pages) {
  const normalized = pages.map((page) =>
    page.map((line) => words(line)).filter((line) => line.length > 0),
  );
  const counts = new Map();
  for (const page of normalized) {
    for (const line of page) {
      const key = line.join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(4, pages.length / 8);
  const stream = [];
  const positions = [];
  const pageWords = [];
  for (const [pageIndex, page] of normalized.entries()) {
    let flattened = [];
    for (const [lineIndex, line] of page.entries()) {
      if ((counts.get(line.join(" ")) ?? 0) > threshold) continue; // repeated header/footer
      stream.push(...line);
      positions.push([pageIndex + 1, lineIndex], ...line.slice(1).map(() => [pageIndex + 1, lineIndex]));
      flattened.push(...line);
    }
    pageWords.push(flattened);
  }
  return { stream, positions, pageWords };
}

function bisectRight(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/**
 * Map each reference page to an actual page.
 *
 * Returns `[{ page: actualPageNumber | null, startsAtBreak: boolean }]` — one
 * entry per reference page. `startsAtBreak` is true when the match lands on the
 * first line of the actual page, i.e. the page break itself agrees.
 */
export function alignPages(referencePages, actualPages) {
  const reference = bodyStream(referencePages);
  const actual = bodyStream(actualPages);
  if (reference.stream.length === 0 || actual.stream.length === 0) return [];

  const matching = [];
  let aOffset = 0;
  let bOffset = 0;
  for (const part of diffArrays(reference.stream, actual.stream, { comparator: (a, b) => a === b })) {
    const size = part.count ?? part.value.length;
    if (!part.added && !part.removed && size >= 5) {
      matching.push({ a: aOffset, b: bOffset, size });
    }
    if (!part.added) aOffset += size;
    if (!part.removed) bOffset += size;
  }
  if (matching.length === 0) return [];

  const heads = matching.map((block) => block.a);
  let start = 0;
  const matches = [];
  for (const page of reference.pageWords) {
    let match = null;
    const limit = start + Math.min(41, page.length);
    for (let index = start; index < limit; index += 1) {
      const blockIndex = bisectRight(heads, index);
      if (blockIndex < 0) continue;
      const block = matching[blockIndex];
      if (index >= block.a + block.size) continue;
      const mapped = actual.positions[block.b + index - block.a];
      if (mapped) match = mapped;
      if (match) break;
    }
    matches.push(match ? { page: match[0], startsAtBreak: match[1] === 0 } : { page: null, startsAtBreak: false });
    start += page.length;
  }
  return matches;
}
