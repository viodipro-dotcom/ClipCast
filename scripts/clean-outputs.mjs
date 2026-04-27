import fs from 'fs';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const OUTPUTS_ROOT = path.join(ROOT, 'yt_pipeline', 'outputs');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cleanOutputs(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories but do not delete the directory itself
      cleanOutputs(fullPath);
    } else {
      // Delete files, ignore errors
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore
      }
    }
  }
}

function main() {
  console.log('[clean-outputs] Cleaning files from yt_pipeline/outputs (keeping folder structure)');
  ensureDir(OUTPUTS_ROOT);
  cleanOutputs(OUTPUTS_ROOT);
  console.log('[clean-outputs] Done');
}

main();

