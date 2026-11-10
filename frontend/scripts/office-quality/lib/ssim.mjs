// Structural similarity for grayscale byte buffers.
//
// This is the standard Wang et al. SSIM with a uniform (box) window and sample
// covariance — the same defaults skimage.metrics.structural_similarity uses
// (win_size=7, data_range=255, use_sample_covariance=True), which the reference
// BetterOffice harness relies on. It is implemented directly here so the harness
// stays Node-only; the integral-image box sums keep it O(pixels) per page.
//
//   SSIM(x, y) = ((2·μx·μy + C1)(2·σxy + C2))
//              / ((μx² + μy² + C1)(σx² + σy² + C2))
//
// C1 = (0.01·L)², C2 = (0.03·L)², averaged over every fully-covered window.

const L = 255;
const C1 = (0.01 * L) ** 2;
const C2 = (0.03 * L) ** 2;

/** Largest odd window no wider than `size`, capped at `requested`. */
export function windowSize(width, height, requested = 7) {
  if (!Number.isInteger(requested) || requested < 3 || requested % 2 === 0) {
    throw new Error("SSIM window size must be an odd integer of at least 3");
  }
  const smallest = Math.min(width, height);
  if (smallest < 3) throw new Error("SSIM needs images at least 3 pixels wide and high");
  const odd = smallest % 2 === 0 ? smallest - 1 : smallest;
  return Math.min(requested, odd);
}

function integral(values, width, height) {
  const stride = width + 1;
  const out = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      out[(y + 1) * stride + x + 1] = out[y * stride + x + 1] + row;
    }
  }
  return out;
}

function boxSum(sum, stride, x1, y1, x2, y2) {
  return sum[y2 * stride + x2] - sum[y1 * stride + x2] - sum[y2 * stride + x1] + sum[y1 * stride + x1];
}

/**
 * Mean SSIM of two equally sized grayscale buffers (`Uint8Array`/`Uint8ClampedArray`).
 */
export function ssim(a, b, width, height, requestedWindow = 7) {
  if (a.length !== width * height || b.length !== width * height) {
    throw new Error("SSIM inputs must match width × height");
  }
  const win = windowSize(width, height, requestedWindow);
  const radius = (win - 1) / 2;
  const stride = width + 1;

  const sumA = integral(a, width, height);
  const sumB = integral(b, width, height);
  const a2 = new Float64Array(a.length);
  const b2 = new Float64Array(b.length);
  const ab = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    a2[i] = a[i] * a[i];
    b2[i] = b[i] * b[i];
    ab[i] = a[i] * b[i];
  }
  const sumA2 = integral(a2, width, height);
  const sumB2 = integral(b2, width, height);
  const sumAB = integral(ab, width, height);

  const count = win * win;
  const denominator = count - 1;
  let total = 0;
  let windows = 0;

  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const x1 = x - radius;
      const y1 = y - radius;
      const x2 = x + radius + 1;
      const y2 = y + radius + 1;
      const mA = boxSum(sumA, stride, x1, y1, x2, y2) / count;
      const mB = boxSum(sumB, stride, x1, y1, x2, y2) / count;
      const vA =
        (boxSum(sumA2, stride, x1, y1, x2, y2) - count * mA * mA) / denominator;
      const vB =
        (boxSum(sumB2, stride, x1, y1, x2, y2) - count * mB * mB) / denominator;
      const covariance =
        (boxSum(sumAB, stride, x1, y1, x2, y2) - count * mA * mB) / denominator;

      const numerator = (2 * mA * mB + C1) * (2 * covariance + C2);
      const divisor = (mA * mA + mB * mB + C1) * (vA + vB + C2);
      total += numerator / divisor;
      windows += 1;
    }
  }

  if (windows === 0) throw new Error("SSIM window does not fit inside the image");
  return total / windows;
}
