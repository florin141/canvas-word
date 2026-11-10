import { describe, expect, it } from "vitest";
import { ssim, windowSize } from "./ssim.mjs";

function image(width: number, height: number, fill: (x: number, y: number) => number) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[y * width + x] = fill(x, y);
  }
  return pixels;
}

describe("ssim", () => {
  it("scores identical images as 1", () => {
    const page = image(64, 48, (x, y) => (x * 3 + y * 5) % 256);
    expect(ssim(page, page, 64, 48)).toBeCloseTo(1, 10);
  });

  it("scores constant black against constant white near zero", () => {
    const black = image(32, 32, () => 0);
    const white = image(32, 32, () => 255);
    const score = ssim(black, white, 32, 32);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.001);
  });

  it("penalizes a one-pixel content shift", () => {
    const left = image(48, 48, (x) => (x < 24 ? 20 : 230));
    const right = image(48, 48, (x) => (x < 25 ? 20 : 230));
    expect(ssim(left, right, 48, 48)).toBeLessThan(1);
  });

  it("uses the largest odd window that fits", () => {
    expect(windowSize(64, 64)).toBe(7);
    expect(windowSize(6, 10)).toBe(5);
    expect(windowSize(4, 10)).toBe(3);
    expect(windowSize(3, 10)).toBe(3);
  });

  it("rejects mismatched buffers, tiny images, and invalid windows", () => {
    expect(() => ssim(new Uint8Array(4), new Uint8Array(4), 3, 3)).toThrow();
    expect(() => ssim(new Uint8Array(4), new Uint8Array(4), 2, 2)).toThrow();
    expect(() => windowSize(64, 64, 2)).toThrow(/odd/);
    expect(() => windowSize(64, 64, 8)).toThrow(/odd/);
    expect(windowSize(4, 10, 9)).toBe(3);
  });
});
