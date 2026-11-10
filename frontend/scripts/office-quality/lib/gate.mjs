// Regression rules for the one-document gate (private-ssim.mjs). Pure so the
// thresholds and comparison logic can be tested without Word, Playwright, or a
// rendered document.

export const MAX_SSIM_DROP = 0.001;
export const MAX_PAGE_DROP = 0.005;
/** Absorb binary-floating-point noise at the threshold (0.9-0.899 ≠ 0.001 exactly). */
const EPSILON = 1e-9;

/**
 * Compare a current run against a recorded baseline. Returns human-readable
 * regression reasons (empty = no regression). The first page whose SSIM drops
 * by more than MAX_PAGE_DROP is reported; later page drops are secondary noise
 * once the run has already failed.
 */
export function regressions(baseline, current) {
  const reasons = [];
  if (baseline.channel !== current.channel) {
    return [`baseline channel ${baseline.channel} does not match ${current.channel}`];
  }
  if (baseline.penalized_ssim - current.penalized_ssim > MAX_SSIM_DROP + EPSILON) {
    reasons.push(
      `penalized SSIM dropped ${(baseline.penalized_ssim - current.penalized_ssim).toFixed(4)} ` +
        `(${baseline.penalized_ssim.toFixed(4)} → ${current.penalized_ssim.toFixed(4)}, limit ${MAX_SSIM_DROP})`,
    );
  }
  if (
    Number.isFinite(baseline.page_agreement_fraction) &&
    current.page_agreement_fraction < baseline.page_agreement_fraction
  ) {
    reasons.push(
      `page agreement dropped (${baseline.page_agreement_fraction.toFixed(3)} → ${current.page_agreement_fraction.toFixed(3)})`,
    );
  }
  if (current.absolute_page_error > baseline.absolute_page_error) {
    reasons.push(
      `absolute page error worsened (${baseline.absolute_page_error} → ${current.absolute_page_error})`,
    );
  }
  const currentPages = new Map(current.pages.map((page) => [page.page, page.ssim]));
  for (const page of baseline.pages ?? []) {
    const score = currentPages.get(page.page);
    if (Number.isFinite(score) && page.ssim - score > MAX_PAGE_DROP + EPSILON) {
      reasons.push(
        `page ${page.page} SSIM dropped ${(page.ssim - score).toFixed(4)} ` +
          `(${page.ssim.toFixed(4)} → ${score.toFixed(4)}, limit ${MAX_PAGE_DROP})`,
      );
      break;
    }
  }
  return reasons;
}
