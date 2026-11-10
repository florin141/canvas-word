// PNG/image primitives for the visual comparator. Uses @napi-rs/canvas (a
// prebuilt native canvas, devDependency only) instead of pulling Python into a
// Node repository: load → composite over white → RGBA pixels, and the inverse
// for galleries. Every comparison input is flattened onto white so transparent
// page backgrounds (Visio-style) score against the paper Word prints on.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Load an image and composite it over white. Returns RGBA pixels. */
export async function readRgba(path) {
  const image = await loadImage(path);
  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, rgba: new Uint8ClampedArray(data) };
}

/** Composite arbitrary RGBA pixels over white, returning a fresh buffer. */
export function overWhite(rgba, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * alpha + 255 * (1 - alpha));
    out[i + 1] = Math.round(rgba[i + 1] * alpha + 255 * (1 - alpha));
    out[i + 2] = Math.round(rgba[i + 2] * alpha + 255 * (1 - alpha));
    out[i + 3] = 255;
  }
  return out;
}

/**
 * ITU-R 601-2 luma, the same conversion Pillow's `Image.convert("L")` applies —
 * the reference harness scores grayscale pages through that path.
 */
export function grayscale(rgba, width, height) {
  const gray = new Uint8Array(width * height);
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) {
    gray[pixel] = Math.round(
      rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
    );
  }
  return gray;
}

/**
 * White pad/crop at the right/bottom edge — no resampling, no content shift.
 * Used for the at-most-one-pixel canvas/PDF rounding difference.
 */
export function padWhite(rgba, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) {
    return { rgba, width, height };
  }
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4).fill(255);
  const copyWidth = Math.min(width, targetWidth);
  const copyHeight = Math.min(height, targetHeight);
  for (let y = 0; y < copyHeight; y += 1) {
    const from = y * width * 4;
    const to = y * targetWidth * 4;
    out.set(rgba.subarray(from, from + copyWidth * 4), to);
  }
  return { rgba: out, width: targetWidth, height: targetHeight };
}

export async function writePng(path, rgba, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  await mkdir(dirname(path), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, canvas.toBuffer("image/png")),
  );
}

/** |reference − actual| × 4, the gallery's difference band. */
export function differencePng(reference, actual, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, Math.abs(reference[i] - actual[i]) * 4);
    out[i + 1] = Math.min(255, Math.abs(reference[i + 1] - actual[i + 1]) * 4);
    out[i + 2] = Math.min(255, Math.abs(reference[i + 2] - actual[i + 2]) * 4);
    out[i + 3] = 255;
  }
  return out;
}

export function whiteRgba(width, height) {
  return new Uint8ClampedArray(width * height * 4).fill(255);
}
