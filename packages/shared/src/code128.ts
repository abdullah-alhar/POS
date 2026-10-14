/**
 * Code 128 (set B) barcodes, drawn by the browser when a receipt is printed without the ESC/POS
 * printer. Thermal printers draw their own barcodes from the text.
 */

/** Bar/space widths for each symbol value 0–106 (106 = stop). */
const PATTERNS = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

const START_B = 104;
const STOP = 106;

/** Symbol values (start, data, checksum, stop) for printable ASCII text. */
export function code128BValues(text: string): number[] {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Code 128 B supports printable ASCII only');
  const data = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const checksum = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** Alternating bar/space module widths, starting with a bar. */
export function code128BWidths(text: string): number[] {
  return code128BValues(text).flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** An SVG string of the barcode (bars only), `moduleWidth` units per module. */
export function code128Svg(text: string, height = 40, moduleWidth = 1): string {
  const widths = code128BWidths(text);
  const quiet = 10;
  let x = quiet;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0)
      bars.push(
        `<rect x="${x * moduleWidth}" y="0" width="${w * moduleWidth}" height="${height}"/>`,
      );
    x += w;
  });
  const total = (x + quiet) * moduleWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total}" height="${height}" shape-rendering="crispEdges">${bars.join('')}</svg>`;
}
