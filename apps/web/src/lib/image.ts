/**
 * Shrink a picture in the browser before upload, so photos and logos stay small.
 * SVG files are kept as they are (they are already small and stay sharp at any size).
 */
export async function imageFileToDataUrl(
  file: File,
  options: {
    maxSize: number;
    type?: 'image/png' | 'image/jpeg' | 'image/webp';
    quality?: number;
    square?: boolean;
  },
): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsDataURL(file);
    });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (options.square) {
      // Centre crop to a square (profile photos).
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2;
      sy = (sh - side) / 2;
      sw = sh = side;
    }
    const scale = Math.min(1, options.maxSize / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(options.type ?? 'image/png', options.quality ?? 0.88);
  } catch {
    throw new Error('That file is not a picture we can read');
  } finally {
    URL.revokeObjectURL(url);
  }
}
