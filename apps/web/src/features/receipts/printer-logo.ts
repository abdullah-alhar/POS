import type { PrinterLogo } from '@shoppos/shared';
import { builtInLogoSvg } from './receipt-html';

/**
 * Turns the shop logo into black-and-white dots for the thermal printer (the printer cannot
 * read PNG or SVG). Done in the browser, then saved with the printer settings.
 */
export async function buildPrinterLogo(logo: string | null, widthDots = 320): Promise<PrinterLogo> {
  const src = logo ?? `data:image/svg+xml;base64,${btoa(builtInLogoSvg('#000', 525, 120))}`;
  const img = new Image();
  img.src = src;
  await img.decode();
  const width = Math.round(widthDots / 8) * 8;
  const ratio = (img.naturalHeight || 120) / (img.naturalWidth || 525);
  const height = Math.max(1, Math.min(200, Math.round(width * ratio)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const bytesPerRow = width / 8;
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (luminance < 160) bits[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  let binary = '';
  for (const b of bits) binary += String.fromCharCode(b);
  return { width, height, data: btoa(binary) };
}
