import fs from "fs";
import path from "path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/** Display title for each folder (guide page) */
export const FOLDER_TITLES: Record<string, string> = {
  "add-files-jobs": "Add Files & Jobs",
  "exports": "Exports",
  "faq": "FAQ",
  "getting-started": "Getting Started",
  "guide": "Guide (01–08)",
  "manual-assist": "Manual Assist",
  "pipeline": "Pipeline",
  "presets": "Presets",
  "scheduler": "Scheduler",
  "settings": "Settings",
  "troubleshooting": "Troubleshooting",
  "ui-overview": "UI Overview",
  "youtube-connect-upload": "YouTube Connect & Upload",
};

/** Guide page order for screenshots index (folders without images are omitted when listing from disk). */
export const SCREENSHOT_FOLDER_ORDER = [
  "getting-started",
  "ui-overview",
  "add-files-jobs",
  "pipeline",
  "presets",
  "exports",
  "youtube-connect-upload",
  "manual-assist",
  "scheduler",
  "settings",
  "troubleshooting",
  "guide",
  "faq",
] as const;

export interface ScreenshotEntry {
  filename: string;
  path: string; // copyable path e.g. /docs/images/getting-started/01-home.jpg
}

export function getScreenshotsByFolder(): Record<string, ScreenshotEntry[]> {
  const baseDir = path.join(process.cwd(), "public", "docs", "images");
  const result: Record<string, ScreenshotEntry[]> = {};

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const folderName = ent.name;
      const folderPath = path.join(baseDir, folderName);
      const files = fs.readdirSync(folderPath);
      const images = files
        .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
        .sort()
        .map((filename) => ({
          filename,
          path: `/docs/images/${folderName}/${filename}`,
        }));
      if (images.length > 0) {
        result[folderName] = images;
      }
    }
  } catch {
    // base dir missing or unreadable
  }

  return result;
}

/** Same as getScreenshotsByFolder but keys sorted by guide page order (SCREENSHOT_FOLDER_ORDER). */
export function getScreenshotsByFolderOrdered(): [string, ScreenshotEntry[]][] {
  const byFolder = getScreenshotsByFolder();
  const orderList: string[] = [...SCREENSHOT_FOLDER_ORDER];
  const rest = Object.keys(byFolder).filter((k) => !orderList.includes(k)).sort();
  const orderedKeys = [...orderList.filter((k) => byFolder[k]?.length), ...rest];
  return orderedKeys.map((folder) => [folder, byFolder[folder]]);
}
