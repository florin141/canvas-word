import { describe, expect, it } from "vitest";
import { MAX_PAGE_DROP, MAX_SSIM_DROP, regressions } from "./gate.mjs";

function run(overrides: Record<string, unknown> = {}) {
  return {
    channel: "canvas",
    penalized_ssim: 0.9,
    page_agreement_fraction: 1,
    absolute_page_error: 0,
    pages: [
      { page: 1, ssim: 0.9 },
      { page: 2, ssim: 0.9 },
    ],
    ...overrides,
  };
}

describe("gate regressions", () => {
  it("passes an identical run", () => {
    expect(regressions(run(), run())).toEqual([]);
  });

  it("flags a penalized SSIM drop above the threshold, not at it", () => {
    expect(regressions(run(), run({ penalized_ssim: 0.9 - MAX_SSIM_DROP }))).toEqual([]);
    const reasons = regressions(run(), run({ penalized_ssim: 0.9 - MAX_SSIM_DROP - 0.0001 }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/penalized SSIM dropped/);
  });

  it("flags page-agreement and page-error regressions", () => {
    expect(regressions(run(), run({ page_agreement_fraction: 0.99 }))[0]).toMatch(/page agreement dropped/);
    expect(regressions(run(), run({ absolute_page_error: 1 }))[0]).toMatch(/absolute page error worsened/);
  });

  it("reports the first page that drops beyond the per-page limit", () => {
    const current = run({
      pages: [
        { page: 1, ssim: 0.9 - MAX_PAGE_DROP - 0.001 },
        { page: 2, ssim: 0.8 },
      ],
    });
    const reasons = regressions(run(), current);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/page 1 SSIM dropped/);
    expect(reasons[0]).not.toMatch(/page 2/);
  });

  it("rejects a baseline recorded for a different channel", () => {
    expect(regressions(run({ channel: "pdf" }), run())).toEqual([
      "baseline channel pdf does not match canvas",
    ]);
  });
});
