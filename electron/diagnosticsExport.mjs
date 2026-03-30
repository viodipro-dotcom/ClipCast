/**
 * Support bundle export: JSON summaries + redacted logs. No tokens, API keys, or keytar values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import log from 'electron-log';
import { redactSecrets } from './secrets.mjs';
import { isConnected as youtubeIsConnected } from './youtube.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.join(__dirname, '..');

const MAX_LOG_BYTES = 25 * 1024 * 1024;

function readPackageJson() {
  try {
    const raw = fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeAuthSnapshot(raw) {
  const base = {
    signedIn: false,
    userEmail: null,
    plan: null,
    subscriptionStatus: null,
    usage: null,
  };
  if (!raw || typeof raw !== 'object') return base;
  const usageIn = raw.usage && typeof raw.usage === 'object' ? raw.usage : null;
  let usage = null;
  if (usageIn) {
    usage = {
      uploads_used: typeof usageIn.uploads_used === 'number' ? usageIn.uploads_used : undefined,
      metadata_used: typeof usageIn.metadata_used === 'number' ? usageIn.metadata_used : undefined,
      uploads_limit:
        usageIn.uploads_limit === null || typeof usageIn.uploads_limit === 'number'
          ? usageIn.uploads_limit
          : undefined,
      metadata_limit:
        usageIn.metadata_limit === null || typeof usageIn.metadata_limit === 'number'
          ? usageIn.metadata_limit
          : undefined,
    };
    if (Object.values(usage).every((v) => typeof v === 'undefined')) usage = null;
  }
  return {
    signedIn: Boolean(raw.signedIn),
    userEmail: typeof raw.userEmail === 'string' ? raw.userEmail.slice(0, 320) : null,
    plan: typeof raw.plan === 'string' ? raw.plan.slice(0, 128) : null,
    subscriptionStatus: typeof raw.subscriptionStatus === 'string' ? raw.subscriptionStatus.slice(0, 128) : null,
    usage,
  };
}

function resolveExportParentDir() {
  try {
    const desktop = app.getPath('desktop');
    if (desktop && fs.existsSync(desktop)) return desktop;
  } catch {
    // ignore
  }
  try {
    return app.getPath('downloads');
  } catch {
    return app.getPath('userData');
  }
}

function timestampFolderName() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function safeWriteJson(dir, fileName, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(obj, null, 2), 'utf8');
}

function copyLogFileRedacted(srcPath, destDir, destName) {
  if (!srcPath || !fs.existsSync(srcPath)) return { copied: false, reason: 'missing' };
  try {
    const st = fs.statSync(srcPath);
    if (!st.isFile()) return { copied: false, reason: 'not_file' };
    if (st.size > MAX_LOG_BYTES) {
      fs.mkdirSync(destDir, { recursive: true });
      const skipNote = `Skipped (too large): ${path.basename(srcPath)} bytes=${st.size}\n`;
      fs.writeFileSync(path.join(destDir, `${destName}.skipped.txt`), skipNote, 'utf8');
      return { copied: false, reason: 'too_large' };
    }
    const raw = fs.readFileSync(srcPath, 'utf8');
    const redacted = redactSecrets(raw);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, destName), redacted, 'utf8');
    return { copied: true };
  } catch (e) {
    return { copied: false, reason: String(e?.message ?? e) };
  }
}

function buildAppInfo() {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.version,
    installPath: app.getPath('exe'),
    resourcesPath: process.resourcesPath || '',
    userDataPath: app.getPath('userData'),
    exportedAt: new Date().toISOString(),
  };
}

function sanitizeUpdateStatusForExport(status) {
  if (!status || typeof status !== 'object') return status;
  const s = { ...status };
  if (s.info && typeof s.info === 'object') {
    const info = { ...s.info };
    if (typeof info.releaseNotes === 'string' && info.releaseNotes.length > 4000) {
      info.releaseNotes = `${info.releaseNotes.slice(0, 4000)}\n…(truncated)`;
    }
    s.info = info;
  }
  return s;
}

function buildUpdaterInfo(packageJson, updateGetStatus) {
  const publish = packageJson?.build?.publish;
  const provider = publish && typeof publish === 'object' ? publish.provider || 'github' : 'unknown';
  let repoTarget = null;
  if (publish && typeof publish === 'object') {
    if (publish.owner && publish.repo) repoTarget = `${publish.owner}/${publish.repo}`;
    else if (typeof publish.repo === 'string') repoTarget = publish.repo;
  }
  const raw = typeof updateGetStatus === 'function' ? updateGetStatus() : { disabled: true };
  const status = sanitizeUpdateStatusForExport(raw);
  return {
    updaterEnabled: !status.disabled,
    provider,
    repoTarget,
    appVersion: app.getVersion(),
    lastKnownUpdateState: status,
  };
}

function resolvePipelineScriptPath() {
  const pipelineDir =
    app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app.asar.unpacked', 'yt_pipeline'))
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'yt_pipeline')
      : path.join(APP_ROOT, 'yt_pipeline');
  const script = path.join(pipelineDir, 'run_pipeline.py');
  return { pipelineDir, scriptPath: script, scriptExists: fs.existsSync(script) };
}

/**
 * @param {object} ctx
 * @param {() => string} ctx.getPipelinePythonPath
 * @param {() => object} ctx.getDeveloperOptions
 * @param {() => Promise<object>} ctx.getComputeBackend
 * @param {() => object} ctx.getOutputsSubdir - (name) => path
 * @param {() => import('electron').UpdateStatus} ctx.updateGetStatus
 * @param {unknown} ctx.authSnapshotFromRenderer
 */
function tryCreateBundleRoot(parentDir, folderName) {
  const outRoot = path.join(parentDir, folderName);
  fs.mkdirSync(outRoot, { recursive: true });
  return outRoot;
}

export async function exportDiagnosticsBundle(ctx) {
  const {
    getPipelinePythonPath,
    getDeveloperOptions,
    getComputeBackend,
    getOutputsSubdir,
    updateGetStatus,
    authSnapshotFromRenderer,
  } = ctx;

  const folderName = `ClipCast-Diagnostics-${timestampFolderName()}`;
  let parentDir = resolveExportParentDir();
  let outRoot;
  try {
    outRoot = tryCreateBundleRoot(parentDir, folderName);
  } catch {
    try {
      parentDir = app.getPath('downloads');
      outRoot = tryCreateBundleRoot(parentDir, folderName);
    } catch (e2) {
      parentDir = app.getPath('userData');
      outRoot = tryCreateBundleRoot(parentDir, folderName);
    }
  }
  const logsDir = path.join(outRoot, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const packageJson = readPackageJson();
  safeWriteJson(outRoot, 'app-info.json', buildAppInfo());

  const ytConnected = await youtubeIsConnected().catch(() => false);
  const authNorm = normalizeAuthSnapshot(authSnapshotFromRenderer);
  safeWriteJson(outRoot, 'auth-info.json', {
    ...authNorm,
    youtubeConnected: Boolean(ytConnected),
  });

  safeWriteJson(outRoot, 'updater-info.json', buildUpdaterInfo(packageJson, updateGetStatus));

  const pythonPath = typeof getPipelinePythonPath === 'function' ? getPipelinePythonPath() : '';
  const pythonPathExists =
    Boolean(pythonPath) && (pythonPath === 'python' || fs.existsSync(pythonPath));
  const { scriptPath, scriptExists } = resolvePipelineScriptPath();
  const devOpts = typeof getDeveloperOptions === 'function' ? getDeveloperOptions() : {};
  let compute = null;
  try {
    compute = typeof getComputeBackend === 'function' ? await getComputeBackend() : null;
  } catch (e) {
    compute = { error: String(e?.message ?? e), availableGpu: false };
  }
  safeWriteJson(outRoot, 'python-info.json', {
    resolvedPythonPath: pythonPath || '',
    pythonPathExists,
    resolvedPipelineScriptPath: scriptPath,
    pipelineScriptExists: scriptExists,
    computeBackendPreference: devOpts.computeBackendPreference ?? null,
    gpuDetected: Boolean(compute && compute.availableGpu),
    computeBackendDetails: compute
      ? {
          availableGpu: compute.availableGpu,
          error: compute.error ?? null,
          pythonPath: compute.pythonPath ?? null,
          details: compute.details ?? null,
        }
      : null,
  });

  const userDataLogs = path.join(app.getPath('userData'), 'logs');
  const logCopySummary = [];
  const copiedSrcRealpaths = new Set();
  const toRealPath = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const noteRealpath = (p) => {
    copiedSrcRealpaths.add(toRealPath(p));
  };
  const alreadyCopied = (p) => copiedSrcRealpaths.has(toRealPath(p));

  if (fs.existsSync(userDataLogs)) {
    for (const name of fs.readdirSync(userDataLogs)) {
      if (!name.toLowerCase().endsWith('.log')) continue;
      const full = path.join(userDataLogs, name);
      const r = copyLogFileRedacted(full, logsDir, name);
      logCopySummary.push({ file: name, ...r });
      if (r.copied) noteRealpath(full);
    }
  }

  const fileTransportPath = log.transports?.file?.getFile?.()?.path;
  if (fileTransportPath && fs.existsSync(fileTransportPath) && !alreadyCopied(fileTransportPath)) {
    const base = path.basename(fileTransportPath);
    const r = copyLogFileRedacted(fileTransportPath, logsDir, base);
    logCopySummary.push({ file: `electron-log:${base}`, ...r });
    if (r.copied) noteRealpath(fileTransportPath);
  }

  let reportsDir = null;
  try {
    reportsDir = typeof getOutputsSubdir === 'function' ? getOutputsSubdir('Reports') : null;
  } catch {
    reportsDir = null;
  }
  if (reportsDir && fs.existsSync(reportsDir)) {
    for (const name of fs.readdirSync(reportsDir)) {
      if (!name.toLowerCase().endsWith('.log')) continue;
      const destName = `pipeline-reports-${name}`;
      const r = copyLogFileRedacted(path.join(reportsDir, name), logsDir, destName);
      logCopySummary.push({ file: `reports/${name}`, ...r });
    }
  }

  safeWriteJson(outRoot, 'export-manifest.json', {
    exportedAt: new Date().toISOString(),
    bundleParentDirectory: parentDir,
    bundleFolderName: folderName,
    logFiles: logCopySummary,
    note: 'Log contents were passed through redactSecrets(); no keytar or env secrets are exported as structured fields.',
  });

  return { ok: true, path: outRoot };
}
