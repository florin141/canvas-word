import { describe, expect, it } from "vitest";
import { alignPages, bodyStream, words } from "./text.mjs";

const REFERENCE = [
  ["alpha beta gamma delta epsilon", "zeta eta theta"],
  ["iota kappa lambda mu nu", "xi omicron pi"],
  ["rho sigma tau upsilon phi"],
];

// The same words, but the first line of reference page 2 moved onto page 1.
const ACTUAL = [
  ["alpha beta gamma delta epsilon", "zeta eta theta", "iota kappa lambda mu nu"],
  ["xi omicron pi", "rho sigma tau upsilon phi"],
];

describe("page text alignment", () => {
  it("normalizes words and digits", () => {
    expect(words("Report 2024, DRAFT — v2")).toEqual(["report", "0", "draft", "v0"]);
  });

  it("drops lines repeated on most pages", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
    const pages = Array.from({ length: 12 }, (_, index) => ["Company header", `body ${words[index]} text`]);
    const stream = bodyStream(pages);
    expect(stream.stream).not.toContain("company");
    expect(stream.stream).toContain("body");
  });

  it("maps a shifted page break to the actual page and line", () => {
    const matches = alignPages(REFERENCE, ACTUAL);
    expect(matches).toHaveLength(3);
    expect(matches[0]).toEqual({ page: 1, startsAtBreak: true });
    expect(matches[1]).toEqual({ page: 1, startsAtBreak: false });
    expect(matches[2]).toEqual({ page: 2, startsAtBreak: false });
  });

  it("returns no matches for unrelated documents", () => {
    const unrelated = [["completely different words here now", "and more unrelated prose"]];
    expect(alignPages(REFERENCE, unrelated)).toEqual([]);
  });
});
