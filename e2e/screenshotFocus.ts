import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

const IMAGES_BASE = path.join(process.cwd(), 'website', 'public', 'docs', 'images');

export type ScreenshotFocusOptions = {
  /** Full output path (e.g. website/public/docs/images/add-files-jobs/01-add-files-button.jpg) */
  outPath: string;
  /** CSS selector for the element to focus (use this OR focusLocator) */
  focusSelector?: string;
  /** Playwright locator for the element (use this OR focusSelector) */
  focusLocator?: { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> };
  padding?: number;
  shape?: 'rect' | 'circle';
  strokeWidth?: number;
  color?: string;
};

const DEFAULT_PADDING = 24;
const DEFAULT_STROKE_WIDTH = 6;
const DEFAULT_COLOR = 'red';

/**
 * Takes a full-page screenshot, crops to the focus element with padding,
 * draws a highlight (rect or circle) around it, and saves to outPath.
 * Uses viewport screenshot so bounding box coordinates match.
 */
export async function screenshotFocus(
  page: { screenshot: (opts?: { type?: 'png'; fullPage?: boolean }) => Promise<Buffer>; locator: (selector: string) => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } },
  opts: ScreenshotFocusOptions
): Promise<void> {
  const padding = opts.padding ?? DEFAULT_PADDING;
  const shape = opts.shape ?? 'rect';
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const color = opts.color ?? DEFAULT_COLOR;

  const box = opts.focusLocator
    ? await opts.focusLocator.boundingBox()
    : await page.locator(opts.focusSelector!).boundingBox();

  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`screenshotFocus: element not found or has no size (selector=${opts.focusSelector ?? 'locator'})`);
  }

  const fullBuffer = await page.screenshot({ type: 'png', fullPage: false });
  const meta = await sharp(fullBuffer).metadata();
  const viewWidth = meta.width ?? 0;
  const viewHeight = meta.height ?? 0;

  let cropLeft = Math.max(0, box.x - padding);
  let cropTop = Math.max(0, box.y - padding);
  let cropRight = Math.min(viewWidth, box.x + box.width + padding);
  let cropBottom = Math.min(viewHeight, box.y + box.height + padding);
  if (cropRight <= cropLeft) cropRight = cropLeft + 1;
  if (cropBottom <= cropTop) cropBottom = cropTop + 1;
  const cropWidth = Math.min(viewWidth, cropRight - cropLeft);
  const cropHeight = Math.min(viewHeight, cropBottom - cropTop);

  const highlightX = box.x - cropLeft;
  const highlightY = box.y - cropTop;
  const highlightW = box.width;
  const highlightH = box.height;

  const extLeft = Math.floor(cropLeft);
  const extTop = Math.floor(cropTop);
  const extWidth = Math.max(1, Math.floor(cropWidth));
  const extHeight = Math.max(1, Math.floor(cropHeight));

  const cropped = await sharp(fullBuffer)
    .extract({ left: extLeft, top: extTop, width: extWidth, height: extHeight })
    .toBuffer();

  const svgContent =
    shape === 'circle'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${extWidth}" height="${extHeight}">
  <circle cx="${highlightX + highlightW / 2}" cy="${highlightY + highlightH / 2}" r="${Math.min(highlightW, highlightH) / 2}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${extWidth}" height="${extHeight}">
  <rect x="${highlightX}" y="${highlightY}" width="${highlightW}" height="${highlightH}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
</svg>`;

  const overlaySvg = Buffer.from(svgContent);
  const outDir = path.dirname(opts.outPath);
  fs.mkdirSync(outDir, { recursive: true });

  await sharp(cropped)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toFile(opts.outPath);
}

/** Resolve path under website/public/docs/images/<section>/<filename> */
export function focusOutPath(section: string, filename: string): string {
  return path.join(IMAGES_BASE, section, filename);
}
