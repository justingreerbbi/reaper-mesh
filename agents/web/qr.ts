// QR codes for sharing channels: drawn from text here, and read back from images by jsQR.
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

/** The standard quiet zone. Scanners need this white margin, on both themes. */
const QUIET_MODULES = 4;

/** A QR code as a grid of dark modules, plus its width including the quiet zone. */
export function qrMatrix(value: string) {
  const code = qrcode(0, 'M');
  code.addData(value, 'Byte');
  code.make();
  const size = code.getModuleCount();
  const dark = (row: number, column: number) => code.isDark(row, column);
  return { size, total: size + QUIET_MODULES * 2, dark };
}

/** SVG path data, in modules, with the quiet zone included in the coordinates. */
export function qrPath(value: string) {
  const { size, total, dark } = qrMatrix(value);
  let path = '';
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++)
      if (dark(row, column)) path += `M${column + QUIET_MODULES} ${row + QUIET_MODULES}h1v1h-1z`;
  return { path, total };
}

/** Always dark on white, whatever the theme, because that's what scanners read best. */
export function qrPixels(value: string, scale: number) {
  const { size, total, dark } = qrMatrix(value);
  const width = total * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      if (!dark(row, column)) continue;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const offset =
            (((row + QUIET_MODULES) * scale + y) * width + (column + QUIET_MODULES) * scale + x) *
            4;
          data[offset] = data[offset + 1] = data[offset + 2] = 5;
        }
    }
  return { data, width };
}

/** The text in a QR code in an image, or undefined when none is readable. */
export function readQr(data: Uint8ClampedArray, width: number, height: number) {
  // jsQR ships as CommonJS: Node sees the module object here, and the bundler sees the function.
  const read = ((jsQR as unknown as { default?: unknown }).default ?? jsQR) as unknown as (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: { inversionAttempts: 'attemptBoth' },
  ) => { data: string } | null;
  return read(data, width, height, { inversionAttempts: 'attemptBoth' })?.data || undefined;
}
