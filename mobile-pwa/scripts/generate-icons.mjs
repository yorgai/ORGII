// Generate PNG icons for the PWA manifest from inline SVG sources.
//
// We produce three files:
//   icon-192.png         — 192x192, wordmark roughly fills the canvas
//   icon-512.png         — 512x512, same composition at higher res
//   icon-512-maskable.png — 512x512 with the wordmark inside the
//                            inner 80% safe zone, full-bleed background.
//                            Android adaptive-icons + iOS both clip the
//                            outer 10% on each side; centering inside
//                            the safe zone guarantees the wordmark
//                            survives every mask shape.
//
// Run from `mobile-pwa/`:
//
//   node scripts/generate-icons.mjs
//
// Idempotent — overwrites the PNGs each invocation.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "public", "icons");

const BG = "#0a0a0a";
const FG = "#ffffff";

function buildSvg({ size, fontSize, mask }) {
  const cy = mask ? size / 2 + fontSize * 0.34 : size / 2 + fontSize * 0.34;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="${size / 2}" y="${cy}" font-size="${fontSize}" fill="${FG}" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700">ORGII</text>
</svg>`;
}

async function renderPng({ size, fontSize, outName, mask }) {
  const svg = buildSvg({ size, fontSize, mask });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const outPath = path.join(outDir, outName);
  await writeFile(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await renderPng({
    size: 192,
    fontSize: 56,
    outName: "icon-192.png",
    mask: false,
  });
  await renderPng({
    size: 512,
    fontSize: 148,
    outName: "icon-512.png",
    mask: false,
  });
  // Maskable: keep the wordmark inside ~80% of the canvas. A 512px icon
  // with a 110px font keeps the wordmark within roughly the middle 60%
  // by width, well inside the standard 80% safe zone.
  await renderPng({
    size: 512,
    fontSize: 110,
    outName: "icon-512-maskable.png",
    mask: true,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
