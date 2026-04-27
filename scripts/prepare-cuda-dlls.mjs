import fs from 'fs';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const REQUIRED = ['cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll'];
const OPTIONAL = ['cudnn64_8.dll'];

function normalizeDir(p) {
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

function collectCudaPaths() {
  const paths = [];
  const env = process.env;
  if (env.CUDA_PATH) paths.push(env.CUDA_PATH);
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('CUDA_PATH_V') && value) paths.push(value);
  }
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const base = path.join(programFiles, 'NVIDIA GPU Computing Toolkit', 'CUDA');
  const versions = ['v12.4', 'v12.3', 'v12.2', 'v12.1', 'v12.0'];
  for (const v of versions) {
    paths.push(path.join(base, v));
  }
  return Array.from(new Set(paths)).filter((p) => p && fs.existsSync(p));
}

function collectSearchDirs() {
  const dirs = [];
  const env = process.env;
  const userProfile = env.USERPROFILE || '';

  const cudaRoots = collectCudaPaths();
  for (const root of cudaRoots) {
    dirs.push(path.join(root, 'bin'));
  }

  if (env.CONDA_PREFIX) {
    dirs.push(path.join(env.CONDA_PREFIX, 'bin'));
    dirs.push(path.join(env.CONDA_PREFIX, 'Library', 'bin'));
  }

  const condaBases = [
    userProfile ? path.join(userProfile, 'miniconda3') : '',
    userProfile ? path.join(userProfile, 'anaconda3') : '',
  ].filter(Boolean);

  for (const base of condaBases) {
    dirs.push(path.join(base, 'Library', 'bin'));
    const envsDir = path.join(base, 'envs');
    if (fs.existsSync(envsDir)) {
      try {
        const entries = fs.readdirSync(envsDir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const envRoot = path.join(envsDir, ent.name);
          dirs.push(path.join(envRoot, 'bin'));
          dirs.push(path.join(envRoot, 'Library', 'bin'));
        }
      } catch {
        // ignore
      }
    }
  }

  return Array.from(new Set(dirs.map(normalizeDir))).filter((p) => p && fs.existsSync(p));
}

function findDllInDirs(dllName, dirs) {
  for (const dir of dirs) {
    const candidate = path.join(dir, dllName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function copyDll(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(src));
  fs.copyFileSync(src, dest);
  return dest;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[cuda-dlls] Skipping (not Windows).');
    return;
  }

  const outDir = path.join(ROOT, 'vendor', 'cuda');
  fs.mkdirSync(outDir, { recursive: true });
  const existingMissing = REQUIRED.filter((dll) => !fs.existsSync(path.join(outDir, dll)));
  if (!existingMissing.length) {
    console.log('[cuda-dlls] Using existing DLLs in vendor/cuda.');
    return;
  }

  const searchDirs = collectSearchDirs();
  if (!searchDirs.length) {
    console.warn('[cuda-dlls] No CUDA/Conda paths found. Set CUDA_PATH or CONDA_PREFIX to bundle DLLs.');
  }
  const found = {};
  const missing = [];

  for (const dll of REQUIRED) {
    if (fs.existsSync(path.join(outDir, dll))) {
      continue;
    }
    const src = findDllInDirs(dll, searchDirs);
    if (!src) {
      missing.push(dll);
      continue;
    }
    found[dll] = copyDll(src, outDir);
  }

  for (const dll of OPTIONAL) {
    if (fs.existsSync(path.join(outDir, dll))) {
      continue;
    }
    const src = findDllInDirs(dll, searchDirs);
    if (src) {
      found[dll] = copyDll(src, outDir);
    }
  }

  console.log('[cuda-dlls] Output:', outDir);
  Object.entries(found).forEach(([dll, src]) => {
    console.log(`[cuda-dlls] Bundled: ${dll} <- ${src}`);
  });

  const finalMissing = REQUIRED.filter((dll) => !fs.existsSync(path.join(outDir, dll)));
  if (finalMissing.length) {
    console.error(`[cuda-dlls] Missing required DLLs: ${finalMissing.join(', ')}`);
    process.exit(1);
  }
}

main();
