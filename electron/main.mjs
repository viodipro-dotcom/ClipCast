import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  clearGoogleOAuthClient,
  clearYouTubeTokens,
  getGoogleOAuthClient,
  getYouTubeTokens,
  migrateLegacySecrets,
  redactSecrets,
  setGoogleOAuthClient,
  setYouTubeTokens,
} from './secrets.mjs';
import { clearYouTubeTokensCache } from './youtube.mjs';
import * as updateService from './updateService.mjs';
import { exportDiagnosticsBundle } from './diagnosticsExport.mjs';
import {
  resolveBundledPythonExe,
  runPythonSmokeTest,
  writePythonDiagnosticsLog,
} from './pythonRuntime.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root (one level above electron/)
const APP_ROOT = path.join(__dirname, '..');

const APP_DATA_NAME = 'ClipCast';
const DEV_APP_DATA_NAME = 'ClipCast-dev';

function configureUserDataPath() {
  try {
    const base = app.getPath('appData');
    const name = app.isPackaged ? APP_DATA_NAME : DEV_APP_DATA_NAME;
    const target = path.join(base, name);
    if (app.getPath('userData') !== target) {
      app.setPath('userData', target);
    }
  } catch (e) {
    console.warn('[main] Failed to set userData path', e);
  }
}

configureUserDataPath();

const PROTOCOL_SCHEME = 'clipcast';

let mainWindow = null;
let tray = null;
let assistCenterWindow = null;
let assistOverlayWindow = null;
let setAutoUploadWindowFn = null;
let setAssistOverlayWindowFn = null;
let refreshAssistOverlayStateFn = null;
let setYouTubeWindowFn = null;
let computeBackendCache = null;
let computeBackendCacheMeta = {
  lastProbeAtMs: 0,
  lastProbeFailed: false,
  lastProbeReason: null,
  lastProbeSource: null,
};
const COMPUTE_BACKEND_REPROBE_COOLDOWN_MS = 10 * 60 * 1000;
let batchNotificationTimer = null;

const GPU_LOG_NAME = 'gpu_diagnostics.log';
const GPU_CRASH_TRACK_WINDOW_MS = 10 * 60 * 1000;
const GPU_CRASH_DISABLE_THRESHOLD = 2;

process.on('unhandledRejection', (reason) => {
  try {
    console.warn('[main] unhandledRejection', reason);
  } catch {
    // ignore
  }
});

app.on('child-process-gone', (_event, details) => {
  if (details?.type !== 'GPU') return;
  const payload = {
    type: details?.type,
    reason: details?.reason,
    exitCode: details?.exitCode,
    serviceName: details?.serviceName,
  };
  console.warn('[gpu] child-process-gone', payload);
  recordGpuProcessIssue('child-process-gone', payload);
});

app.on('gpu-process-crashed', (_event, killed) => {
  const payload = { killed: Boolean(killed) };
  console.warn('[gpu] gpu-process-crashed', payload);
  recordGpuProcessIssue('gpu-process-crashed', payload);
});

const RENDERER_ERROR_LOG_NAME = 'renderer_errors.log';

function writeRendererErrorLog(payload) {
  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, RENDERER_ERROR_LOG_NAME);
    const safe = (value) => redactSecrets(value ?? '');
    const entry = {
      timestamp: new Date().toISOString(),
      appVersion: app.getVersion?.() || 'unknown',
      type: typeof payload?.type === 'string' ? payload.type : 'unknown',
      message: safe(payload?.message),
      stack: payload?.stack ? safe(payload.stack) : null,
      href: payload?.href ? safe(payload.href) : '',
      hash: payload?.hash ? safe(payload.hash) : '',
      source: payload?.source ? safe(payload.source) : '',
      line: typeof payload?.line === 'number' ? payload.line : null,
      column: typeof payload?.column === 'number' ? payload.column : null,
    };
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return logPath;
  } catch (e) {
    console.error('[renderer-log] Failed to write renderer error log', e);
    return null;
  }
}
let lastNotificationCount = { total: 0, instagram: 0, tiktok: 0 };
let lastNotificationTime = 0;
let ipcHandlersInitialized = false;
let pendingDeepLinkUrl = null;
let supabaseAccessToken = '';
let supabaseFunctionsUrlOverride = '';
let updateNextPromptTimer = null;
let loggedHfSymlinkWarning = false;

const activePipelineRuns = new Map();

function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payloadPart = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4);
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function deriveSupabaseFunctionsUrl(token) {
  const payload = decodeJwtPayload(token);
  const iss = typeof payload?.iss === 'string' ? payload.iss : '';
  if (!iss) return '';
  const base = iss.replace(/\/auth\/v1\/?$/i, '');
  return base ? `${base.replace(/\/+$/, '')}/functions/v1` : '';
}

function getDeepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  const found = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${PROTOCOL_SCHEME}://`));
  return found || null;
}

function sendPendingDeepLinkToRenderer() {
  if (!pendingDeepLinkUrl) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('auth:deep-link', pendingDeepLinkUrl);
    mainWindow.webContents.send('auth:callback', pendingDeepLinkUrl);
    console.log('[deep-link] sent pending to renderer (auth:callback)');
    pendingDeepLinkUrl = null;
  } catch {
    // ignore
  }
}

function focusWindowAndSendDeepLink(url) {
  console.log('[deep-link] received:', redactSecrets(url));
  pendingDeepLinkUrl = url;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    try {
      mainWindow.webContents.send('auth:deep-link', url);
      mainWindow.webContents.send('auth:callback', url);
      console.log('[deep-link] sent to renderer (auth:callback)');
    } catch {
      // ignore
    }
    pendingDeepLinkUrl = null;
  }
}

function registerDeepLinkFallback(win) {
  if (!win || !win.webContents) return;
  const trySend = () => {
    if (!pendingDeepLinkUrl) return;
    try {
      win.webContents.send('auth:deep-link', pendingDeepLinkUrl);
      win.webContents.send('auth:callback', pendingDeepLinkUrl);
      console.log('[deep-link] sent pending to renderer (auth:callback)');
      pendingDeepLinkUrl = null;
    } catch {
      // ignore
    }
  };
  win.webContents.once('did-finish-load', trySend);
  win.webContents.once('dom-ready', trySend);
}

function scheduleUpdateCheckFromConfig() {
  if (!app.isPackaged) return;
  if (updateNextPromptTimer) {
    clearTimeout(updateNextPromptTimer);
    updateNextPromptTimer = null;
  }
  const { nextPromptAtMs } = getUpdaterConfig();
  const now = Date.now();
  if (!nextPromptAtMs || now >= nextPromptAtMs) {
    try {
      console.log('[update] Running scheduled check (now >= nextPromptAtMs).');
      updateService.check();
    } catch (e) {
      console.error('[update] Error during scheduled check:', e);
    }
    return;
  }
  const delay = Math.max(0, Math.min(nextPromptAtMs - now, 24 * 60 * 60 * 1000));
  if (delay === 0) {
    try {
      console.log('[update] Running scheduled check (delay=0).');
      updateService.check();
    } catch (e) {
      console.error('[update] Error during scheduled check (delay=0):', e);
    }
    return;
  }
  console.log('[update] Scheduling next update check in', Math.round(delay / 1000), 'seconds');
  updateNextPromptTimer = setTimeout(() => {
    try {
      console.log('[update] Timer fired, running update check.');
      updateService.check();
    } catch (e) {
      console.error('[update] Error during timed update check:', e);
    }
  }, delay);
}

// Single instance + protocol registration
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

if (app.isPackaged) {
  // Packaged app: executable is the installed ClipCast.exe
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
} else if (process.platform === 'win32') {
  // Dev on Windows: Electron is launched via `electron .`, so we must pass
  // the executable AND the entry argument to register the protocol correctly.
  const exePath = process.execPath;
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : APP_ROOT;
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, exePath, [entry]);
} else {
  // Other dev platforms can use the simple form
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

app.on('second-instance', (_event, argv) => {
  const url = getDeepLinkFromArgv(argv);
  if (url) {
    focusWindowAndSendDeepLink(url);
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url && url.startsWith(`${PROTOCOL_SCHEME}://`)) {
      focusWindowAndSendDeepLink(url);
    }
  });
}

function safeMkdir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

const REPORTS_RETENTION_DAYS = 30;
const MAX_RUN_LOGS = 20;
const MAX_STACK_FRAMES = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

function getBundledPythonPath() {
  if (!app.isPackaged) return null;
  try {
    const exe = resolveBundledPythonExe();
    return exe && exe !== 'python' ? exe : null;
  } catch {
    return null;
  }
}

function getBundledFfmpegPaths() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const probeExe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const envFfmpeg = process.env.FFMPEG_PATH || '';
  const envFfprobe = process.env.FFPROBE_PATH || '';
  if (envFfmpeg || envFfprobe) {
    return { ffmpeg: envFfmpeg || '', ffprobe: envFfprobe || '' };
  }
  if (!app.isPackaged) {
    const devBase = path.join(APP_ROOT, 'vendor', 'bin');
    return {
      ffmpeg: path.join(devBase, exe),
      ffprobe: path.join(devBase, probeExe),
    };
  }
  const base = process.resourcesPath;
  return {
    ffmpeg: path.join(base, 'bin', exe),
    ffprobe: path.join(base, 'bin', probeExe),
  };
}

/**
 * FIX: In packaged builds, avoid spawning via cmd.exe / shell.
 * Spawn the embedded Python directly with args array (shell: false).
 */
function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function spawnPipelineProcess(params) {
  const {
    pythonExe,
    runPipelinePy,
    args,
    env = {},
    cwd,
    onStdout,
    onStderr,
  } = params;

  if (!fileExists(pythonExe)) {
    throw new Error(`[pipeline] python exe missing: ${pythonExe}`);
  }
  if (!fileExists(runPipelinePy)) {
    throw new Error(`[pipeline] run_pipeline.py missing: ${runPipelinePy}`);
  }

  const argv = ['-u', runPipelinePy, ...args];
  const child = spawn(pythonExe, argv, {
    cwd: cwd ?? path.dirname(runPipelinePy),
    env: { ...process.env, ...env },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (onStdout) child.stdout?.on('data', (d) => onStdout(String(d)));
  if (onStderr) child.stderr?.on('data', (d) => onStderr(String(d)));

  child.on('error', (err) => {
    const info = [
      `[pipeline] spawn error: ${err?.message ?? err}`,
      `[pipeline] pythonExe=${pythonExe}`,
      `[pipeline] runPipelinePy=${runPipelinePy}`,
      `[pipeline] argv=${JSON.stringify(argv)}`,
      `[pipeline] isPackaged=${app.isPackaged}`,
      `[pipeline] cwd=${cwd ?? path.dirname(runPipelinePy)}`,
    ].join('\n');
    console.error(info);
  });

  return child;
}

async function killProcessTree(pid, reason = 'manual') {
  if (!pid || Number.isNaN(Number(pid))) return false;
  const targetPid = Number(pid);
  if (process.platform === 'win32') {
    return await new Promise((resolve) => {
      try {
        const killer = spawn('taskkill', ['/PID', String(targetPid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
        });
        killer.on('close', () => resolve(true));
        killer.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  try {
    process.kill(targetPid, 'SIGTERM');
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      process.kill(targetPid, 'SIGKILL');
    } catch {
      // ignore
    }
  }, 1500);
  return true;
}

function registerPipelineRun(runId, child, options = {}) {
  if (!runId || !child || !child.pid) return;
  activePipelineRuns.set(runId, {
    runId,
    child,
    pid: child.pid,
    startedAt: Date.now(),
    canceled: false,
    cancelReason: null,
    logLine: typeof options.logLine === 'function' ? options.logLine : null,
  });
}

function markPipelineCanceled(runId, reason = 'manual') {
  const entry = activePipelineRuns.get(runId);
  if (!entry) return null;
  entry.canceled = true;
  entry.cancelReason = reason;
  return entry;
}

function finalizePipelineRun(runId) {
  activePipelineRuns.delete(runId);
}

async function cancelPipelineRun(runId, reason = 'manual') {
  const entry = markPipelineCanceled(runId, reason);
  if (!entry) return { ok: true, canceled: false };
  try {
    if (entry.logLine) {
      entry.logLine(formatTechLog('WARN', 'pipeline', 'Run cancelled', { runId, reason }));
    }
  } catch {
    // ignore
  }
  await killProcessTree(entry.pid, reason);
  return { ok: true, canceled: true };
}

async function cancelAllPipelineRuns(reason = 'manual') {
  const runs = Array.from(activePipelineRuns.values());
  if (runs.length === 0) return { ok: true, canceled: false, count: 0 };
  await Promise.all(runs.map((entry) => cancelPipelineRun(entry.runId, reason)));
  return { ok: true, canceled: true, count: runs.length };
}

function isFfmpegInfoLine(line) {
  const text = line.toLowerCase();
  if (text.startsWith('ffmpeg version') || text.startsWith('ffprobe version')) return true;
  if (text.startsWith('configuration:') || text.startsWith('built with')) return true;
  if (text.startsWith('input #') || text.startsWith('output #')) return true;
  if (text.startsWith('stream #') || text.startsWith('stream mapping')) return true;
  if (text.startsWith('metadata:') || text.startsWith('duration:') || text.startsWith('bitrate:')) return true;
  if (text.startsWith('libswscale') || text.startsWith('libswresample')) return true;
  if (text.startsWith('major_brand') || text.startsWith('minor_version')) return true;
  if (text.startsWith('compatible_brands') || text.startsWith('creation_time')) return true;
  if (text.startsWith('handler_name') || text.startsWith('vendor_id')) return true;
  if (text.startsWith('encoder') || text.startsWith('tsse')) return true;
  if (text.startsWith('bitrate') || text.startsWith('maxrate') || text.startsWith('te_is_reencode')) return true;
  if (text.includes(' tbr') && text.includes(' tbn')) return true;
  if (text.startsWith('frame=') || text.startsWith('size=') || text.startsWith('time=') || text.startsWith('speed=')) return true;
  if (text.includes('press [q]')) return true;
  if (text.startsWith('libav')) return true;
  return false;
}

function isHfSymlinkWarning(line) {
  const text = line.toLowerCase();
  return text.includes('symlink')
    && (text.includes('huggingface') || text.includes('huggingface_hub') || text.includes('hf hub') || text.includes('hf_hub'));
}

function classifyPipelineStderrLine(line) {
  const trimmed = line.replace(/\r/g, '').trim();
  if (!trimmed) return null;
  if (isHfSymlinkWarning(trimmed)) {
    if (loggedHfSymlinkWarning) return null;
    loggedHfSymlinkWarning = true;
    return {
      level: 'INFO',
      line: 'HuggingFace cache symlinks are not supported on this system; using file copies instead.',
    };
  }
  if (isFfmpegInfoLine(trimmed)) {
    return { level: 'INFO', line: trimmed };
  }
  return { level: 'WARN', line: trimmed };
}

// Default outputs base (same as previous hardcoded behavior)
const DEFAULT_OUTPUTS_DIR = path.join(APP_ROOT, 'yt_pipeline', 'outputs');

const OUTPUTS_SUBDIRS = ['Audio', 'Transcripts', 'Metadata', 'Exports', 'Reports'];

function getPipelineDir() {
  if (app.isPackaged) {
    const unpackedDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'yt_pipeline');
    if (fs.existsSync(unpackedDir)) return unpackedDir;
  }
  return path.join(APP_ROOT, 'yt_pipeline');
}

function getDefaultOutputsDir() {
  if (app.isPackaged && app.isReady()) {
    return path.join(app.getPath('userData'), 'outputs');
  }
  return DEFAULT_OUTPUTS_DIR;
}

function getAppConfigPath() {
  return path.join(app.getPath('userData'), 'app_config.json');
}

function loadAppConfig() {
  try {
    const p = getAppConfigPath();
    if (!fs.existsSync(p)) return {};
    const data = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('[main] Error loading app config:', e);
    return {};
  }
}

function saveAppConfig(config) {
  try {
    const p = getAppConfigPath();
    safeMkdir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify({ ...loadAppConfig(), ...config }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[main] Error saving app config:', e);
    return false;
  }
}

const DEFAULT_HARDWARE_ACCEL_CONFIG = {
  disabled: false,
  reason: null,
  lastChangedAtMs: 0,
  gpuCrashCount: 0,
  lastGpuCrashAtMs: 0,
  lastIssue: null,
};

function getHardwareAccelerationConfig() {
  const cfg = loadAppConfig();
  const raw = cfg?.hardwareAcceleration;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HARDWARE_ACCEL_CONFIG };
  return {
    ...DEFAULT_HARDWARE_ACCEL_CONFIG,
    ...raw,
  };
}

function setHardwareAccelerationConfig(next) {
  saveAppConfig({ hardwareAcceleration: next });
  return next;
}

function writeGpuDiagnosticsLog(event, details) {
  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    safeMkdir(logDir);
    const logPath = path.join(logDir, GPU_LOG_NAME);
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      details,
      appVersion: app.getVersion?.() || 'unknown',
    };
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function applyHardwareAccelerationPolicy() {
  const cfg = getHardwareAccelerationConfig();
  if (cfg.disabled) {
    try {
      app.disableHardwareAcceleration();
      app.commandLine.appendSwitch('disable-gpu');
    } catch {
      // ignore
    }
    console.warn('[gpu] Hardware acceleration disabled by config:', cfg.reason || 'unknown');
    writeGpuDiagnosticsLog('hardware-acceleration-disabled', { reason: cfg.reason || 'unknown' });
  }
}

function recordGpuProcessIssue(kind, details) {
  const now = Date.now();
  const current = getHardwareAccelerationConfig();
  const last = Number(current.lastGpuCrashAtMs || 0);
  const withinWindow = last && now - last <= GPU_CRASH_TRACK_WINDOW_MS;
  const nextCrashCount = withinWindow ? Number(current.gpuCrashCount || 0) + 1 : 1;
  const next = {
    ...current,
    gpuCrashCount: nextCrashCount,
    lastGpuCrashAtMs: now,
    lastIssue: kind,
  };
  writeGpuDiagnosticsLog(kind, details);
  if (!current.disabled && nextCrashCount >= GPU_CRASH_DISABLE_THRESHOLD) {
    next.disabled = true;
    next.reason = `auto_disabled_after_${nextCrashCount}_gpu_events`;
    next.lastChangedAtMs = now;
    console.warn('[gpu] Disabling hardware acceleration on next launch (GPU instability detected).');
  }
  setHardwareAccelerationConfig(next);
}

applyHardwareAccelerationPolicy();

function getUpdaterConfig() {
  const cfg = loadAppConfig();
  const raw = cfg && typeof cfg === 'object' ? cfg.updater : null;
  if (!raw || typeof raw !== 'object') {
    return { nextPromptAtMs: 0 };
  }
  const n = Number(raw.nextPromptAtMs || 0);
  return { nextPromptAtMs: Number.isFinite(n) && n > 0 ? n : 0 };
}

function setUpdaterNextPromptAt(nextPromptAtMs) {
  try {
    const cfg = loadAppConfig();
    const current = cfg && typeof cfg === 'object' ? cfg : {};
    const existingUpdater = current.updater && typeof current.updater === 'object' ? current.updater : {};
    const value = Number(nextPromptAtMs) || 0;
    const next = {
      ...current,
      updater: {
        ...existingUpdater,
        nextPromptAtMs: value > 0 ? value : 0,
      },
    };
    saveAppConfig(next);
    return getUpdaterConfig();
  } catch (e) {
    console.error('[main] Error setting updater.nextPromptAtMs:', e);
    return getUpdaterConfig();
  }
}
const DEFAULT_DEVELOPER_OPTIONS = {
  autoCleanupOutputReports: true,
  debugMode: false,
  // Data retention (app-only; does not delete video files or uploads)
  autoArchivePosted: false,
  archiveAfterDays: 7,
  autoDeleteArchived: false,
  deleteArchivedAfterDays: 30,
  // Auto-clean output artifacts (Audio/Exports/Metadata/Transcripts only; originals not touched)
  autoCleanOutputArtifacts: false,
  artifactRetentionDays: 30,
  computeBackendPreference: 'auto',
  pythonPath: '',
};

function clampDays(n, def) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return def;
  if (v > 365) return 365;
  return Math.floor(v);
}

function getDeveloperOptions() {
  const config = loadAppConfig();
  const opts = config.developerOptions;
  if (!opts || typeof opts !== 'object') return { ...DEFAULT_DEVELOPER_OPTIONS };
  const pref = typeof opts.computeBackendPreference === 'string' ? opts.computeBackendPreference : 'auto';
  const normalizedPref = ['auto', 'prefer_gpu', 'force_cpu'].includes(pref) ? pref : 'auto';
  const pythonPath = typeof opts.pythonPath === 'string' ? opts.pythonPath.trim() : '';
  return {
    autoCleanupOutputReports: opts.autoCleanupOutputReports !== false,
    debugMode: Boolean(opts.debugMode),
    autoArchivePosted: Boolean(opts.autoArchivePosted),
    archiveAfterDays: clampDays(opts.archiveAfterDays, DEFAULT_DEVELOPER_OPTIONS.archiveAfterDays),
    autoDeleteArchived: Boolean(opts.autoDeleteArchived),
    deleteArchivedAfterDays: clampDays(opts.deleteArchivedAfterDays, DEFAULT_DEVELOPER_OPTIONS.deleteArchivedAfterDays),
    autoCleanOutputArtifacts: Boolean(opts.autoCleanOutputArtifacts),
    artifactRetentionDays: clampDays(opts.artifactRetentionDays, DEFAULT_DEVELOPER_OPTIONS.artifactRetentionDays),
    computeBackendPreference: normalizedPref,
    pythonPath,
  };
}

function setDeveloperOptions(payload) {
  if (!payload || typeof payload !== 'object') return getDeveloperOptions();
  const current = getDeveloperOptions();
  const validPrefs = ['auto', 'prefer_gpu', 'force_cpu'];
  const pythonPath = typeof payload.pythonPath === 'string' ? payload.pythonPath.trim() : undefined;
  const next = {
    ...current,
    ...(typeof payload.autoCleanupOutputReports === 'boolean' ? { autoCleanupOutputReports: payload.autoCleanupOutputReports } : {}),
    ...(typeof payload.debugMode === 'boolean' ? { debugMode: payload.debugMode } : {}),
    ...(typeof payload.autoArchivePosted === 'boolean' ? { autoArchivePosted: payload.autoArchivePosted } : {}),
    ...(typeof payload.archiveAfterDays !== 'undefined' ? { archiveAfterDays: clampDays(payload.archiveAfterDays, current.archiveAfterDays) } : {}),
    ...(typeof payload.autoDeleteArchived === 'boolean' ? { autoDeleteArchived: payload.autoDeleteArchived } : {}),
    ...(typeof payload.deleteArchivedAfterDays !== 'undefined' ? { deleteArchivedAfterDays: clampDays(payload.deleteArchivedAfterDays, current.deleteArchivedAfterDays) } : {}),
    ...(typeof payload.autoCleanOutputArtifacts === 'boolean' ? { autoCleanOutputArtifacts: payload.autoCleanOutputArtifacts } : {}),
    ...(typeof payload.artifactRetentionDays !== 'undefined' ? { artifactRetentionDays: clampDays(payload.artifactRetentionDays, current.artifactRetentionDays) } : {}),
    ...(typeof payload.computeBackendPreference === 'string' && validPrefs.includes(payload.computeBackendPreference)
      ? { computeBackendPreference: payload.computeBackendPreference }
      : {}),
    ...(typeof pythonPath === 'string' ? { pythonPath } : {}),
  };
  saveAppConfig({ developerOptions: next });
  return next;
}

function getPipelinePythonPath() {
  if (app.isPackaged) {
    try {
      return resolveBundledPythonExe();
    } catch {
      return '';
    }
  }

  const opts = getDeveloperOptions();
  if (opts?.pythonPath && fs.existsSync(opts.pythonPath)) {
    return opts.pythonPath;
  }

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }

  return '';
}

function isBundledPythonExe(pythonExe) {
  if (!app.isPackaged || !pythonExe) return false;
  try {
    const res = path.normalize(process.resourcesPath || '').toLowerCase();
    const exe = path.normalize(pythonExe).toLowerCase();
    if (!res) return false;
    if (!exe.startsWith(res)) return false;
    return exe.includes(`${path.sep}python${path.sep}`.toLowerCase());
  } catch {
    return false;
  }
}

function buildBundledPythonEnv(baseEnv, pythonExe) {
  const env = { ...baseEnv };
  env.CLIPCAST_PY_ENV = 'bundled';
  const removeKeys = [
    'PYTHONHOME',
    'PYTHONPATH',
    'PYTHONUSERBASE',
    'PYTHONNOUSERSITE',
    'CONDA_PREFIX',
    'CONDA_DEFAULT_ENV',
    'CONDA_PROMPT_MODIFIER',
    'CONDA_SHLVL',
    'CONDA_EXE',
    '_CONDA_EXE',
    'CONDA_PYTHON_EXE',
    'VIRTUAL_ENV',
    'PIP_PREFIX',
    'PIP_REQUIRE_VIRTUALENV',
  ];
  for (const key of removeKeys) {
    if (key in env) delete env[key];
  }
  const pythonDir = pythonExe ? path.dirname(pythonExe) : '';
  const pythonRoot = pythonDir && pythonDir.toLowerCase().endsWith(`${path.sep}scripts`)
    ? path.dirname(pythonDir)
    : pythonDir;
  const extraDirs = [
    pythonDir,
    pythonRoot,
    path.join(pythonRoot, 'Library', 'bin'),
    path.join(pythonRoot, 'DLLs'),
    path.join(pythonRoot, 'bin'),
  ].filter((p) => p && fs.existsSync(p));
  const pathEntries = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const filtered = pathEntries.filter((p) => !/(^|\\|\/)(miniconda|anaconda|conda|envs)(\\|\/|$)/i.test(p));
  const systemDirs = [];
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    systemDirs.push(
      systemRoot,
      path.join(systemRoot, 'System32'),
      path.join(systemRoot, 'System32', 'Wbem'),
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
    );
  }
  env.PATH = [...extraDirs, ...systemDirs, ...filtered].filter(Boolean).join(path.delimiter);
  return env;
}

function buildPythonEnv(pythonExe, extraEnv = {}) {
  const base = { ...process.env, ...extraEnv };
  if (isBundledPythonExe(pythonExe)) {
    return buildBundledPythonEnv(base, pythonExe);
  }
  return buildCustomPythonEnv(base, pythonExe);
}

function buildCustomPythonEnv(baseEnv, pythonExe) {
  const env = { ...baseEnv };
  env.CLIPCAST_PY_ENV = 'custom';
  const pythonDir = pythonExe ? path.dirname(pythonExe) : '';
  const pythonRoot = pythonDir && pythonDir.toLowerCase().endsWith(`${path.sep}scripts`)
    ? path.dirname(pythonDir)
    : pythonDir;
  const extraDirs = [
    pythonDir,
    pythonRoot,
    path.join(pythonRoot, 'Library', 'bin'),
    path.join(pythonRoot, 'DLLs'),
    path.join(pythonRoot, 'bin'),
    path.join(APP_ROOT, 'vendor', 'cuda'),
  ].filter((p) => p && fs.existsSync(p));
  const pathEntries = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  env.PATH = [...extraDirs, ...pathEntries].filter(Boolean).join(path.delimiter);
  return env;
}

function summarizeAdapters(adapters = []) {
  if (!Array.isArray(adapters) || adapters.length === 0) return '';
  return adapters
    .map((a) => {
      const name = a?.name ? String(a.name) : 'Unknown';
      const vendor = a?.vendor ? String(a.vendor) : 'unknown';
      const vram = Number(a?.vram_mb || 0);
      const vramLabel = vram > 0 ? `${vram}MB` : '';
      return [name, vendor !== 'unknown' ? vendor : '', vramLabel].filter(Boolean).join(' ');
    })
    .join('; ');
}

function runPythonJson(pythonExe, args, { cwd, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(pythonExe, args, {
      cwd: cwd || APP_ROOT,
      shell: false,
      windowsHide: true,
      env: buildPythonEnv(pythonExe),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, Math.max(1000, Number(timeoutMs) || 15000));

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const finalize = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    child.on('error', (err) => {
      finalize({
        ok: false,
        error: String(err?.message || err),
        stdout,
        stderr,
        code: err?.code,
        timedOut,
      });
    });

    child.on('close', (code, signal) => {
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const lastLine = lines.length ? lines[lines.length - 1] : '';
      if (!lastLine) {
        finalize({
          ok: false,
          error: timedOut ? 'timeout' : (stderr.trim() || 'no_output'),
          stdout,
          stderr,
          code,
          signal,
          timedOut,
        });
        return;
      }
      try {
        const data = JSON.parse(lastLine);
        finalize({ ok: true, data, stdout, stderr, code, signal, timedOut });
      } catch (e) {
        finalize({
          ok: false,
          error: `Failed to parse JSON: ${String(e)}`,
          stdout,
          stderr,
          code,
          signal,
          timedOut,
        });
      }
    });
  });
}

async function detectComputeBackend(opts = {}) {
  const logFn = typeof opts.log === 'function' ? opts.log : null;
  const logInfo = (message, keys = {}) => logFn && logFn('INFO', 'compute', message, keys);
  const logWarn = (message, keys = {}) => logFn && logFn('WARN', 'compute', message, keys);
  const logError = (message, keys = {}) => logFn && logFn('ERROR', 'compute', message, keys);
  const python = getPipelinePythonPath();
  const devOpts = getDeveloperOptions();
  const hasCustomPath = Boolean(devOpts?.pythonPath && fs.existsSync(devOpts.pythonPath));
  const hasEnvPath = Boolean(process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH));
  const pythonSource = app.isPackaged
    ? 'bundled'
    : (hasCustomPath || hasEnvPath ? 'custom' : 'none');
  const pipelineDir = getPipelineDir();
  const probeScript = path.join(pipelineDir, 'tools', 'gpu_probe.py');
  const smokeScript = path.join(pipelineDir, 'tools', 'cuda_smoke_test.py');

  const base = {
    availableGpu: false,
    details: {},
    error: null,
    pythonPath: python,
  };

  if (!python) {
    return { ...base, error: 'No Python path available (no bundled runtime or custom path configured)' };
  }

  if (!fs.existsSync(probeScript)) {
    return {
      ...base,
      error: 'gpu_probe.py not found in yt_pipeline/tools',
    };
  }

  logInfo('Compute backend python executable', { python });
  const probe = await runPythonJson(python, ['-u', probeScript], { cwd: pipelineDir, timeoutMs: 15000 });
  const details = probe.ok ? (probe.data || {}) : {};
  const adapters = Array.isArray(details.adapters) ? details.adapters : [];
  const nvidiaGpus = Array.isArray(details.nvidia_gpus) ? details.nvidia_gpus : [];
  const nvidiaPresent = Boolean(
    details.nvidia_present
      || nvidiaGpus.length > 0
      || adapters.some((a) => String(a?.vendor || '').toLowerCase() === 'nvidia')
  );
  const adapterSummary = summarizeAdapters(adapters);
  if (adapterSummary) {
    logInfo('GPU adapters found', { adapters: adapterSummary });
  } else {
    logInfo('GPU adapters found', { adapters: 'none' });
  }
  logInfo('NVIDIA present', { nvidia: nvidiaPresent ? 'yes' : 'no' });

  let smoke = null;
  if (nvidiaPresent) {
    if (fs.existsSync(smokeScript)) {
      logInfo('Smoke test python executable', { python });
      logInfo('CUDA smoke test started', { script: smokeScript });
      smoke = await runPythonJson(python, ['-u', smokeScript], { cwd: pipelineDir, timeoutMs: 20000 });
    } else {
      smoke = { ok: false, error: 'cuda_smoke_test.py not found in yt_pipeline/tools' };
    }
    if (smoke && smoke.ok && smoke.data && smoke.data.ok) {
      logInfo('CUDA smoke test passed', { deviceCount: smoke.data.cuda_device_count || 0 });
    } else {
      const reason = smoke?.data?.reason || smoke?.error || 'cuda_smoke_failed';
      logWarn('CUDA smoke test failed', { reason });
      if (smoke?.data) {
        logWarn('CUDA smoke test diagnostics', {
          deviceCount: smoke.data.cuda_device_count ?? null,
          deviceCountRaw: smoke.data.cuda_device_count_raw ?? null,
          deviceQueryError: smoke.data.cuda_device_query_error || undefined,
          supportedComputeTypes: smoke.data.supported_compute_types || [],
          supportedComputeTypesError: smoke.data.supported_compute_types_error || undefined,
        });
      }
      if (reason === 'no_cuda_device') {
        logWarn('GPU detected but CUDA device count = 0', {
          deviceCount: smoke?.data?.cuda_device_count ?? null,
        });
      }
    }
    if (smoke?.data?.inference_test) {
      logInfo('CUDA inference smoke test', {
        status: smoke.data.inference_test,
        error: smoke.data.inference_error || undefined,
        model: smoke.data.inference_model || undefined,
      });
    }
    if (smoke?.data?.dll_check?.status === 'failed') {
      const missing = Array.isArray(smoke.data.dll_check.missing) ? smoke.data.dll_check.missing.join(', ') : '';
      logWarn('CUDA runtime DLLs missing', { missing: missing || 'unknown' });
    }
  } else {
    logInfo('CUDA smoke test skipped', { reason: 'no_nvidia_gpu' });
  }

  const smokeOk = Boolean(smoke && smoke.ok && smoke.data && smoke.data.ok);
  const smokeData = smoke && smoke.data ? smoke.data : null;
  const error =
    (nvidiaPresent && !smokeOk)
      ? (smoke?.error || smokeData?.error || smokeData?.reason || 'cuda_smoke_failed')
      : (probe.ok ? (details?.error || null) : (probe.error || 'gpu_probe_failed'));

  const firstNvidiaAdapter = adapters.find((a) => String(a?.vendor || '').toLowerCase() === 'nvidia') || null;
  const normalizedDetails = {
    ...details,
    adapters,
    nvidia_present: nvidiaPresent,
    nvidia_gpus: nvidiaGpus,
    gpu_count: smokeData?.cuda_device_count || nvidiaGpus.length || details?.gpu_count || 0,
    gpu_name: nvidiaGpus[0]?.name || firstNvidiaAdapter?.name || details?.gpu_name || null,
    vram_total_mb: nvidiaGpus[0]?.vram_total_mb || firstNvidiaAdapter?.vram_mb || details?.vram_total_mb || 0,
    cuda_smoke: smokeData || null,
    cuda_smoke_raw_error: smoke && !smoke.ok ? smoke.error : null,
    cuda_available: smokeOk,
    python_source: pythonSource,
    python_exec: python,
  };

  return {
    availableGpu: smokeOk,
    details: normalizedDetails,
    error,
    pythonPath: python,
  };
}

function shouldSkipComputeBackendProbe(opts = {}) {
  if (!computeBackendCache) return false;
  const forceRefresh = Boolean(opts.forceRefresh);
  if (!forceRefresh) return true;
  const userInitiated = Boolean(opts.userInitiated);
  if (userInitiated) return false;
  if (computeBackendCacheMeta?.lastProbeFailed) return true;
  const lastProbeAtMs = Number(computeBackendCacheMeta?.lastProbeAtMs || 0);
  if (lastProbeAtMs && Date.now() - lastProbeAtMs < COMPUTE_BACKEND_REPROBE_COOLDOWN_MS) {
    return true;
  }
  return false;
}

function recordComputeBackendProbe(result, opts = {}, error = null) {
  const failed = Boolean(error) || !Boolean(result?.availableGpu);
  const reason =
    (result?.details && result.details.cuda_smoke && result.details.cuda_smoke.reason)
      || result?.error
      || (typeof error === 'string' ? error : (error ? String(error) : null));
  computeBackendCacheMeta = {
    lastProbeAtMs: Date.now(),
    lastProbeFailed: failed,
    lastProbeReason: reason || null,
    lastProbeSource: typeof opts.source === 'string' ? opts.source : null,
  };
}

async function getComputeBackend(opts = {}) {
  const logFn = typeof opts.log === 'function' ? opts.log : null;
  const logInfo = (message, keys = {}) => logFn && logFn('INFO', 'compute', message, keys);
  if (shouldSkipComputeBackendProbe(opts)) {
    logInfo('Compute backend probe skipped', {
      reason: computeBackendCacheMeta?.lastProbeReason || 'cached',
      source: computeBackendCacheMeta?.lastProbeSource || 'unknown',
    });
    return computeBackendCache;
  }
  try {
    computeBackendCache = await detectComputeBackend(opts);
    recordComputeBackendProbe(computeBackendCache, opts, null);
  } catch (e) {
    computeBackendCache = {
      availableGpu: false,
      details: {},
      error: String(e),
      pythonPath: getPipelinePythonPath(),
    };
    recordComputeBackendProbe(computeBackendCache, opts, e);
  }
  return computeBackendCache;
}

async function refreshComputeBackend() {
  computeBackendCache = null;
  return await getComputeBackend({ forceRefresh: true, userInitiated: true, source: 'developer_refresh' });
}

/** Returns the configured outputs base directory (absolute). Ensures it exists. */
function getOutputsBaseDir() {
  const config = loadAppConfig();
  const raw = config.outputsDir;
  const dir = typeof raw === 'string' && raw.trim() && path.isAbsolute(path.resolve(raw))
    ? path.resolve(raw.trim())
    : getDefaultOutputsDir();
  safeMkdir(dir);
  return dir;
}

/** Returns path to a subdir under outputs base (e.g. 'Reports', 'Exports'). Creates it if needed. */
function getOutputsSubdir(subdirName) {
  const base = getOutputsBaseDir();
  const sub = path.join(base, subdirName);
  safeMkdir(sub);
  return sub;
}

/**
 * Format a single technical log line: [YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [COMPONENT] message | key=value ...
 * Values with spaces are quoted. No newlines; safe for single-line logs.
 */
function formatTechLog(level, component, message, keys = {}) {
  const now = new Date();
  const ts =
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0') +
    ' ' +
    String(now.getHours()).padStart(2, '0') +
    ':' +
    String(now.getMinutes()).padStart(2, '0') +
    ':' +
    String(now.getSeconds()).padStart(2, '0') +
    '.' +
    String(now.getMilliseconds()).padStart(3, '0');
  const lev = String(level).toUpperCase().slice(0, 5);
  const comp = String(component).slice(0, 12).padEnd(12);
  let msg = String(redactSecrets(message ?? '') ?? '').replace(/\r?\n/g, ' ').trim().slice(0, 500);
  const parts = [];
  const safeKeys = redactSecrets(keys);
  if (safeKeys && typeof safeKeys === 'object' && !Array.isArray(safeKeys)) {
    for (const [k, v] of Object.entries(safeKeys)) {
      if (k === '' || v === undefined) continue;
      const val = String(v);
      const needsQuotes = /[\s|="]/.test(val);
      parts.push(needsQuotes ? `${k}="${val.replace(/"/g, '\\"')}"` : `${k}=${val}`);
    }
  }
  const suffix = parts.length ? ' | ' + parts.join(' ') : '';
  return `[${ts}] [${lev}] [${comp}] ${msg}${suffix}`;
}

/** Trim stack trace to max N frames (each "at ..." line counts as one). */
function trimStack(stackStr, maxFrames = MAX_STACK_FRAMES) {
  if (!stackStr || typeof stackStr !== 'string') return '';
  const lines = stackStr.split(/\r?\n/).filter((l) => l.trim());
  const result = [];
  let count = 0;
  for (const line of lines) {
    result.push(line);
    if (line.trimStart().startsWith('at ') && ++count >= maxFrames) break;
  }
  return result.join('; ');
}

/** Generate runId for log filenames: YYYYMMDD_HHMMSS */
function formatRunId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${min}${sec}`;
}

/**
 * Rotate last_run.log: copy current content to run-YYYYMMDD-HHMMSS.log, then clear last_run.log.
 * Prune run-*.log to keep last MAX_RUN_LOGS.
 */
function rotateRunLog(reportsDir, runId) {
  const lastLogPath = path.join(reportsDir, 'last_run.log');
  const runIdForFile = runId.replace('_', '-');
  const runLogPath = path.join(reportsDir, `run-${runIdForFile}.log`);
  try {
    if (fs.existsSync(lastLogPath)) {
      const content = fs.readFileSync(lastLogPath, 'utf8');
      if (content.trim().length > 0) {
        safeMkdir(reportsDir);
        fs.writeFileSync(runLogPath, content.endsWith('\n') ? content : content + '\n', 'utf8');
      }
    }
    fs.writeFileSync(lastLogPath, '', 'utf8');
  } catch {
    // ignore
  }
  try {
    const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
    const runLogs = entries
      .filter((e) => e.isFile() && e.name.startsWith('run-') && e.name.endsWith('.log'))
      .map((e) => ({ name: e.name, path: path.join(reportsDir, e.name), mtime: fs.statSync(path.join(reportsDir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (let i = MAX_RUN_LOGS; i < runLogs.length; i++) {
      try {
        fs.unlinkSync(runLogs[i].path);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/** Move known report files from outputs root into outputs/Reports/ (one-time migration). */
function migrateReportsToSubfolder(outputsDir) {
  try {
    const reportsDir = path.join(outputsDir, 'Reports');
    safeMkdir(reportsDir);
    const toMove = [
      'last_run.log',
      'upload_last.log',
    ];
    const dir = fs.readdirSync(outputsDir, { withFileTypes: true });
    for (const ent of dir) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      if (toMove.includes(name)) {
        const src = path.join(outputsDir, name);
        const dest = path.join(reportsDir, name);
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(src, dest);
        } catch {
          // ignore
        }
      }
      if ((name.startsWith('report_') && (name.endsWith('.txt') || name.endsWith('.csv')))) {
        const src = path.join(outputsDir, name);
        const dest = path.join(reportsDir, name);
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(src, dest);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

/** Delete files in reportsDir older than retentionDays (default 30). Only touches files, not subdirs. Logs only when debugMode is ON. */
function cleanOldReports(reportsDir, retentionDays = REPORTS_RETENTION_DAYS) {
  const opts = getDeveloperOptions();
  if (!opts.autoCleanupOutputReports) return;
  try {
    if (!fs.existsSync(reportsDir)) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
    let deleted = 0;
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const full = path.join(reportsDir, ent.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          deleted += 1;
          if (opts.debugMode) console.log('[reports-cleanup] Deleted:', full);
        }
      } catch {
        // ignore
      }
    }
    if (opts.debugMode && deleted > 0) console.log('[reports-cleanup] Removed', deleted, 'file(s) from', reportsDir);
  } catch {
    // ignore
  }
}

/** Subdirs under outputs that are eligible for artifact cleanup (not Reports). */
const ARTIFACT_CLEANUP_SUBDIRS = ['Audio', 'Exports', 'Metadata', 'Transcripts'];

/**
 * Delete files older than retentionDays in Audio/Exports/Metadata/Transcripts under outputsBase.
 * Does not touch Reports or originals. Safe: validates paths, skips symlinks outside base, logs and continues on failure.
 * @param {{ outputsBase: string; retentionDays: number }} options
 * @param {{ logLine?: (line: string) => void }} logOpts - optional: logLine(line) appends to technical log and can send to renderer
 * @returns {{ deleted: number; errors: number }}
 */
function cleanupOutputArtifacts({ outputsBase, retentionDays }, logOpts = {}) {
  const logLine = logOpts.logLine || (() => {});
  let deleted = 0;
  let errors = 0;
  if (!outputsBase || typeof outputsBase !== 'string') return { deleted: 0, errors: 0 };
  const baseResolved = path.resolve(outputsBase);
  if (!fs.existsSync(baseResolved) || !fs.statSync(baseResolved).isDirectory()) {
    return { deleted: 0, errors: 0 };
  }
  const cutoff = Date.now() - Math.max(1, Math.min(365, Number(retentionDays) || 30)) * 24 * 60 * 60 * 1000;

  function deleteOldFilesInDir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) {
          deleteOldFilesInDir(full);
          continue;
        }
        let resolvedFull = full;
        if (stat.isSymbolicLink()) {
          try {
            resolvedFull = fs.realpathSync(full);
          } catch {
            continue;
          }
          const normalizedResolved = path.resolve(resolvedFull);
          if (normalizedResolved !== path.resolve(baseResolved) && !normalizedResolved.startsWith(baseResolved + path.sep)) {
            continue;
          }
        } else {
          try {
            resolvedFull = fs.realpathSync(full);
          } catch {
            resolvedFull = path.resolve(full);
          }
        }
        const normalizedResolvedPath = path.resolve(resolvedFull);
        if (normalizedResolvedPath !== path.resolve(baseResolved) && !normalizedResolvedPath.startsWith(baseResolved + path.sep)) {
          continue;
        }
        if (stat.mtimeMs >= cutoff) continue;
        fs.unlinkSync(full);
        deleted += 1;
      } catch (e) {
        errors += 1;
        const reason = e?.message || String(e);
        const msg = `Auto-clean: failed to delete ${full} (${reason}).`;
        logLine(msg);
        if (getDeveloperOptions().debugMode) console.warn(msg);
      }
    }
  }

  for (const sub of ARTIFACT_CLEANUP_SUBDIRS) {
    const subPath = path.join(baseResolved, sub);
    try {
      deleteOldFilesInDir(subPath);
    } catch {
      // skip missing or inaccessible folder
    }
  }

  const summary = `Auto-clean: deleted ${deleted} files older than ${retentionDays} days from Audio/Exports/Metadata/Transcripts.`;
  if (deleted > 0 || errors > 0) {
    logLine(summary);
  }
  return { deleted, errors };
}

/**
 * Run artifact cleanup if enabled.
 * @param {{ sendPipelineLog?: (line: string) => void; logLine?: (line: string) => void }} opts - If logLine provided, use it; else append formatted line to last_run.log and call sendPipelineLog.
 */
function runCleanupOutputArtifactsIfEnabled(opts = {}) {
  const developerOpts = getDeveloperOptions();
  if (!developerOpts.autoCleanOutputArtifacts) return;
  const outputsBase = getOutputsBaseDir();
  const retentionDays = developerOpts.artifactRetentionDays || 30;
  const reportsDir = path.join(outputsBase, 'Reports');
  const lastLogPath = path.join(reportsDir, 'last_run.log');
  const logLine =
    typeof opts.logLine === 'function'
      ? opts.logLine
      : (line) => {
          const formatted = formatTechLog('INFO', 'cleanup', line, {});
          try {
            safeMkdir(reportsDir);
            fs.appendFileSync(lastLogPath, formatted + '\n', 'utf8');
          } catch {
            // ignore
          }
          try {
            if (typeof opts.sendPipelineLog === 'function') opts.sendPipelineLog(formatted + '\n');
          } catch {
            // ignore
          }
        };
  cleanupOutputArtifacts({ outputsBase, retentionDays }, { logLine });
}

const CUSTOM_AI_PRESETS_VERSION = 1;
const CUSTOM_AI_PLATFORM_KEYS = ['all', 'youtube', 'instagram', 'tiktok'];
const DEFAULT_DESCRIPTION_TEMPLATE = '{DESCRIPTION}\n\n{HASHTAGS}';

function createEmptyPlatformMap() {
  return { all: '', youtube: '', instagram: '', tiktok: '' };
}

function createEmptyCustomAiBlocks() {
  return {
    cta: createEmptyPlatformMap(),
    links: createEmptyPlatformMap(),
    disclaimer: createEmptyPlatformMap(),
  };
}

function normalizePlatformMap(input) {
  const base = createEmptyPlatformMap();
  if (input && typeof input === 'object') {
    for (const key of CUSTOM_AI_PLATFORM_KEYS) {
      const value = input[key];
      if (typeof value === 'string') {
        base[key] = value;
      }
    }
  } else if (typeof input === 'string') {
    base.all = input;
  }
  return base;
}

function normalizeCustomAiBlocks(input) {
  return {
    cta: normalizePlatformMap(input?.cta),
    links: normalizePlatformMap(input?.links),
    disclaimer: normalizePlatformMap(input?.disclaimer),
  };
}

function normalizeCustomAiPreset(input) {
  const now = Date.now();
  const preset = {
    id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : '',
    name: typeof input?.name === 'string' ? input.name.trim() : '',
    createdAt: Number.isFinite(input?.createdAt) ? Number(input.createdAt) : now,
    updatedAt: Number.isFinite(input?.updatedAt) ? Number(input.updatedAt) : now,
    instructions: normalizePlatformMap(input?.instructions),
    descriptionTemplate: normalizePlatformMap(input?.descriptionTemplate),
    blocks: {
      cta: normalizePlatformMap(input?.blocks?.cta),
      links: normalizePlatformMap(input?.blocks?.links),
      disclaimer: normalizePlatformMap(input?.blocks?.disclaimer),
    },
  };
  if (!preset.id) {
    preset.id = `preset_${now}_${Math.random().toString(36).slice(2, 9)}`;
  }
  return preset;
}

function getMetadataSettingsFile() {
  return path.join(app.getPath('userData'), 'metadata_settings.json');
}

function loadMetadataSettings() {
  try {
    const defaults = {
      customInstructions: createEmptyPlatformMap(),
      descriptionTemplate: createEmptyPlatformMap(),
      blocks: createEmptyCustomAiBlocks(),
    };
    const metadataSettingsFile = getMetadataSettingsFile();
    if (!fs.existsSync(metadataSettingsFile)) return defaults;
    const data = fs.readFileSync(metadataSettingsFile, 'utf8');
    const parsed = JSON.parse(data);
    return {
      customInstructions: normalizePlatformMap(parsed?.customInstructions),
      descriptionTemplate: normalizePlatformMap(parsed?.descriptionTemplate),
      blocks: normalizeCustomAiBlocks(parsed?.blocks),
    };
  } catch (e) {
    console.error('[main] Error loading metadata settings:', e);
    return {
      customInstructions: createEmptyPlatformMap(),
      descriptionTemplate: createEmptyPlatformMap(),
      blocks: createEmptyCustomAiBlocks(),
    };
  }
}

function saveMetadataSettings(settings) {
  try {
    const metadataSettingsFile = getMetadataSettingsFile();
    safeMkdir(path.dirname(metadataSettingsFile));
    fs.writeFileSync(metadataSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[main] Error saving metadata settings:', e);
    return false;
  }
}

function loadCustomAiPresetsStore() {
  try {
    const presetsFile = path.join(app.getPath('userData'), 'custom_ai_presets.json');
    if (!fs.existsSync(presetsFile)) {
      const emptyStore = { version: CUSTOM_AI_PRESETS_VERSION, activePresetId: null, presets: [] };
      saveCustomAiPresetsStore(emptyStore);
      return emptyStore;
    }
    const data = fs.readFileSync(presetsFile, 'utf8');
    const parsed = JSON.parse(data);
    const presets = Array.isArray(parsed?.presets) ? parsed.presets.map(normalizeCustomAiPreset) : [];
    const activePresetId = typeof parsed?.activePresetId === 'string' ? parsed.activePresetId : null;
    return {
      version: CUSTOM_AI_PRESETS_VERSION,
      activePresetId,
      presets,
    };
  } catch (e) {
    console.error('[main] Error loading custom AI presets:', e);
    return { version: CUSTOM_AI_PRESETS_VERSION, activePresetId: null, presets: [] };
  }
}

function saveCustomAiPresetsStore(store) {
  try {
    const presetsFile = path.join(app.getPath('userData'), 'custom_ai_presets.json');
    const normalizedStore = {
      version: CUSTOM_AI_PRESETS_VERSION,
      activePresetId: typeof store?.activePresetId === 'string' ? store.activePresetId : null,
      presets: Array.isArray(store?.presets) ? store.presets.map(normalizeCustomAiPreset) : [],
    };
    const serialized = JSON.stringify(normalizedStore, null, 2);
    console.log(`[customai:presets:file] path=${presetsFile} bytes=${Buffer.byteLength(serialized, 'utf8')}`);
    safeMkdir(path.dirname(presetsFile));
    fs.writeFileSync(presetsFile, serialized, 'utf8');
    return true;
  } catch (e) {
    console.error('[main] Error saving custom AI presets:', e);
    return false;
  }
}

function collectVideoFiles(rootDir) {
  const exts = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
  const out = [];
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const n = ent.name.toLowerCase();
        if (n === 'node_modules' || n === '.git' || n === 'dist' || n === 'dist-electron') continue;
        stack.push(p);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.has(ext)) out.push(p);
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b));
  return Array.from(new Set(out));
}

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const isGuideScreenshots = process.env.GENERATE_GUIDE === '1';

  const win = new BrowserWindow({
    width: isGuideScreenshots ? 1920 : 1400,
    height: isGuideScreenshots ? 1080 : 900,
    x: isGuideScreenshots ? 0 : undefined,
    y: isGuideScreenshots ? 0 : undefined,
    fullscreen: false,
    fullscreenable: !isGuideScreenshots,
    maximizable: !isGuideScreenshots,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Enable devtools in development mode
      devTools: !app.isPackaged,
    },
  });

  // Extra guard: if the OS restores it maximized/fullscreen, undo it for guide shots.
  if (isGuideScreenshots) {
    try {
      win.setFullScreen(false);
    } catch {}
    try {
      if (win.isMaximized()) win.unmaximize();
    } catch {}
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const prodHtmlPath = path.join(APP_ROOT, 'dist', 'index.html');
  console.log('[main] loading', !app.isPackaged ? devUrl : prodHtmlPath);

  if (!app.isPackaged) {
    try {
      await win.loadURL(devUrl);
    } catch (err) {
      const msg = String(err);
      await win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<h2>Dev server not reachable</h2>
             <p>Tried: <b>${devUrl}</b></p>
             <pre style="white-space:pre-wrap">${msg}</pre>
             <p>Run: <code>npm run dev</code></p>`
          )
      );
    }
  } else {
    win.loadFile(prodHtmlPath);
  }

  win.webContents.on('did-fail-load', (...args) => {
    console.error('[main] [did-fail-load]', ...args);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] [render-gone]', details);
  });
  win.webContents.on('crashed', () => {
    console.error('[main] [renderer-crashed]');
  });

  if (!app.isPackaged) {
    try {
      win.webContents.openDevTools({ mode: 'detach' });
    } catch {
      // ignore devtools failures
    }
  }

  return win;
}

// Initialize IPC handlers BEFORE creating window (so renderer calls don't fail)
async function initIpcHandlers() {
  if (ipcHandlersInitialized) {
    console.warn('[main] initIpcHandlers called more than once; skipping registration');
    return;
  }
  ipcHandlersInitialized = true;

  // Update service (auto-updater): only active when packaged
  updateService.init({ getWindow: () => mainWindow, packaged: app.isPackaged });
  ipcMain.handle('update:check', () => {
    updateService.check();
    return undefined;
  });
  ipcMain.handle('update:download', () => {
    updateService.download();
    return undefined;
  });
  ipcMain.handle('update:install', () => {
    updateService.install();
    return undefined;
  });
  ipcMain.handle('update:getStatus', () => updateService.getStatus());
  ipcMain.handle('update:dismiss', () => {
    if (!app.isPackaged) {
      return { disabled: true, reason: 'dev' };
    }
    const now = Date.now();
    const next = setUpdaterNextPromptAt(now + ONE_HOUR_MS);
    scheduleUpdateCheckFromConfig();
    return { ok: true, nextPromptAtMs: next.nextPromptAtMs };
  });

  ipcMain.handle('renderer:logError', async (_e, payload) => {
    const logPath = writeRendererErrorLog(payload);
    return logPath ? { ok: true, path: logPath } : { ok: false };
  });

  ipcMain.handle('diagnostics:exportSupportBundle', async (_evt, authSnapshotFromRenderer) => {
    console.log('[diagnostics] export started');
    try {
      const result = await exportDiagnosticsBundle({
        authSnapshotFromRenderer,
        getPipelinePythonPath,
        getDeveloperOptions,
        getComputeBackend,
        getOutputsSubdir,
        updateGetStatus: () => updateService.getStatus(),
      });
      if (result?.ok && result.path) {
        console.log('[diagnostics] export completed:', result.path);
      } else {
        console.warn('[diagnostics] export finished without path', result);
      }
      return result;
    } catch (e) {
      const msg = String(e?.message ?? e);
      console.error('[diagnostics] export failed:', msg);
      return { ok: false, error: msg };
    }
  });

  // Register fallback handlers first to ensure they're always available
  // These will be overridden by autoupload.mjs if it loads successfully
  const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
  
  ipcMain.handle('jobs:load', () => {
    try {
      if (!fs.existsSync(jobsFile)) return [];
      const data = fs.readFileSync(jobsFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.jobs)) return parsed.jobs;
      return [];
    } catch (e) {
      console.error('[main] Error loading jobs (fallback):', e);
      return [];
    }
  });

  ipcMain.handle('jobs:save', (_e, jobs) => {
    try {
      safeMkdir(path.dirname(jobsFile));
      fs.writeFileSync(jobsFile, JSON.stringify(Array.isArray(jobs) ? jobs : [], null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[main] Error saving jobs (fallback):', e);
      return false;
    }
  });

  // Persist per-row preferences (targets/visibility) even before scheduling.
  // This is separate from jobs.json so we don't create jobs until user sets a schedule.
  const rowPrefsFile = path.join(app.getPath('userData'), 'row_prefs.json');

  ipcMain.handle('rowprefs:load', () => {
    try {
      if (!fs.existsSync(rowPrefsFile)) return {};
      const data = fs.readFileSync(rowPrefsFile, 'utf8');
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (e) {
      console.error('[main] Error loading row prefs:', e);
      return {};
    }
  });

  ipcMain.handle('rowprefs:save', (_e, prefs) => {
    try {
      const safe = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
      safeMkdir(path.dirname(rowPrefsFile));
      fs.writeFileSync(rowPrefsFile, JSON.stringify(safe, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[main] Error saving row prefs:', e);
      return false;
    }
  });

  // Persist full library list (all imported rows) so it survives restarts.
  const libraryFile = path.join(app.getPath('userData'), 'library.json');

  ipcMain.handle('library:load', () => {
    try {
      if (!fs.existsSync(libraryFile)) {
        return { version: 1, rows: [] };
      }
      const data = fs.readFileSync(libraryFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return { version: 1, rows: parsed };
      }
      if (parsed && Array.isArray(parsed.rows)) {
        return parsed;
      }
      return { version: 1, rows: [] };
    } catch (e) {
      console.error('[main] Error loading library:', e);
      return { version: 1, rows: [] };
    }
  });

  ipcMain.handle('library:save', (_e, payload) => {
    try {
      const rows = Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload)
          ? payload
          : [];
      const toWrite = {
        version: typeof payload?.version === 'number' ? payload.version : 1,
        updatedAt: Date.now(),
        rows,
      };
      safeMkdir(path.dirname(libraryFile));
      fs.writeFileSync(libraryFile, JSON.stringify(toWrite, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[main] Error saving library:', e);
      return false;
    }
  });

  /** Data retention: auto-archive posted rows and optionally delete old archived rows. App-only; does not touch files or uploads. */
  function runDataRetention() {
    const opts = getDeveloperOptions();
    if (!opts.autoArchivePosted && !opts.autoDeleteArchived) return;
    try {
      let libraryPayload = { version: 1, rows: [] };
      if (fs.existsSync(libraryFile)) {
        const data = fs.readFileSync(libraryFile, 'utf8');
        const parsed = JSON.parse(data);
        libraryPayload = Array.isArray(parsed) ? { version: 1, rows: parsed } : (parsed?.rows ? parsed : libraryPayload);
      }
      const rows = Array.isArray(libraryPayload.rows) ? libraryPayload.rows : [];
      let jobs = [];
      if (fs.existsSync(jobsFile)) {
        const data = fs.readFileSync(jobsFile, 'utf8');
        const parsed = JSON.parse(data);
        jobs = Array.isArray(parsed) ? parsed : (parsed?.jobs ? parsed.jobs : []);
      }
      const now = Date.now();
      const archiveAfterMs = (opts.archiveAfterDays || 7) * 24 * 60 * 60 * 1000;
      const deleteAfterMs = (opts.deleteArchivedAfterDays || 30) * 24 * 60 * 60 * 1000;
      let libraryChanged = false;
      let jobsChanged = false;
      const normalizedPath = (p) => path.normalize(String(p || '')).toLowerCase();

      // Build filePath -> earliest postedAt from jobs (per row)
      const rowPostedAt = new Map();
      for (const job of jobs) {
        const fp = job?.filePath;
        if (!fp) continue;
        const key = normalizedPath(fp);
        let earliest = null;
        const run = job.run || {};
        for (const platform of ['youtube', 'instagram', 'tiktok']) {
          const r = run[platform];
          if (r?.done && typeof r.at === 'number') {
            if (earliest == null || r.at < earliest) earliest = r.at;
          }
        }
        if (earliest != null) {
          const prev = rowPostedAt.get(key);
          if (prev == null || earliest < prev) rowPostedAt.set(key, earliest);
        }
      }

      // Auto-archive: set archivedAt for posted rows older than archiveAfterDays (only if no pending schedules)
      if (opts.autoArchivePosted) {
        const rowHasPendingSchedule = new Set();
        for (const job of jobs) {
          const run = job.run || {};
          const targets = job.targets || {};
          const hasPending = (targets.youtube && !run.youtube?.done) || (targets.instagram && !run.instagram?.done) || (targets.tiktok && !run.tiktok?.done);
          if (hasPending && job.filePath) rowHasPendingSchedule.add(normalizedPath(job.filePath));
        }
        for (const row of rows) {
          if (row.archivedAt != null) continue;
          const key = normalizedPath(row.filePath);
          if (rowHasPendingSchedule.has(key)) continue;
          const postedAt = rowPostedAt.get(key);
          if (postedAt == null) continue;
          if (now - postedAt < archiveAfterMs) continue;
          row.archivedAt = now;
          libraryChanged = true;
          if (opts.debugMode) console.log('[retention] Archived row:', row.filePath || row.id);
        }
      }

      // Auto-delete archived: remove rows (and their jobs) when archived longer than deleteArchivedAfterDays
      if (opts.autoDeleteArchived) {
        const toDelete = new Set();
        for (const row of rows) {
          const at = row.archivedAt;
          if (at == null || typeof at !== 'number') continue;
          if (now - at < deleteAfterMs) continue;
          toDelete.add(normalizedPath(row.filePath));
          if (opts.debugMode) console.log('[retention] Delete from app (archived):', row.filePath || row.id);
        }
        if (toDelete.size > 0) {
          const nextRows = rows.filter((r) => !toDelete.has(normalizedPath(r.filePath)));
          libraryPayload.rows = nextRows;
          libraryPayload.updatedAt = now;
          libraryChanged = true;
          const nextJobs = jobs.filter((j) => !toDelete.has(normalizedPath(j.filePath)));
          if (nextJobs.length !== jobs.length) {
            jobs = nextJobs;
            jobsChanged = true;
          }
        }
      }

      if (libraryChanged) {
        safeMkdir(path.dirname(libraryFile));
        fs.writeFileSync(libraryFile, JSON.stringify({ ...libraryPayload, updatedAt: now }, null, 2), 'utf8');
      }
      if (jobsChanged) {
        safeMkdir(path.dirname(jobsFile));
        fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('[main] Data retention error:', e);
    }
  }

  ipcMain.handle('retention:run', () => {
    runDataRetention();
    return undefined;
  });

  // Run retention on startup (non-blocking, after a short delay) and once per day
  setTimeout(() => runDataRetention(), 3000);
  setInterval(() => runDataRetention(), 24 * 60 * 60 * 1000);

  // Register fallback handlers for autoupload settings
  const settingsFile = path.join(app.getPath('userData'), 'autoupload_settings.json');
  
  function loadSettingsFallback() {
    try {
      if (!fs.existsSync(settingsFile)) return { enabled: false, silentMode: false, pollSeconds: 30 };
      const data = fs.readFileSync(settingsFile, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('[main] Error loading settings (fallback):', e);
      return { enabled: false, silentMode: false, pollSeconds: 30 };
    }
  }

  function saveSettingsFallback(settings) {
    try {
      safeMkdir(path.dirname(settingsFile));
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[main] Error saving settings (fallback):', e);
      return false;
    }
  }

  ipcMain.handle('autoupload:setEnabled', (_e, enabled) => {
    const settings = loadSettingsFallback();
    settings.enabled = !!enabled;
    saveSettingsFallback(settings);
    return settings.enabled;
  });

  ipcMain.handle('autoupload:getEnabled', () => {
    const settings = loadSettingsFallback();
    return settings.enabled || false;
  });

  ipcMain.handle('autoupload:setSilentMode', (_e, silent) => {
    const settings = loadSettingsFallback();
    settings.silentMode = !!silent;
    saveSettingsFallback(settings);
    return settings.silentMode;
  });

  ipcMain.handle('autoupload:getSilentMode', () => {
    const settings = loadSettingsFallback();
    return settings.silentMode || false;
  });

  // UI settings
  const uiSettingsFile = path.join(app.getPath('userData'), 'ui_settings.json');

  function loadUiSettings() {
    try {
      if (!fs.existsSync(uiSettingsFile)) return { uiLanguage: 'en' };
      const data = fs.readFileSync(uiSettingsFile, 'utf8');
      const parsed = JSON.parse(data);
      return {
        uiLanguage: typeof parsed?.uiLanguage === 'string' ? parsed.uiLanguage : 'en',
        uiLanguageLabel: typeof parsed?.uiLanguageLabel === 'string' ? parsed.uiLanguageLabel : undefined,
      };
    } catch (e) {
      console.error('[main] Error loading UI settings:', e);
      return { uiLanguage: 'en' };
    }
  }

  function saveUiSettings(settings) {
    try {
      safeMkdir(path.dirname(uiSettingsFile));
      fs.writeFileSync(uiSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[main] Error saving UI settings:', e);
      return false;
    }
  }

  ipcMain.handle('settings:get', () => {
    return loadUiSettings();
  });

  ipcMain.handle('settings:set', (_e, payload) => {
    const current = loadUiSettings();
    const next = {
      ...current,
      ...(payload && typeof payload === 'object' ? payload : {}),
    };
    saveUiSettings(next);
    return next;
  });

  // Outputs folder (Developer Mode): pick, get, set with validation
  ipcMain.handle('settings:pickOutputsDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      properties: ['openDirectory'],
      title: 'Select outputs folder',
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, path: null };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('settings:pickPythonPath', async () => {
    const filters = process.platform === 'win32'
      ? [{ name: 'Python', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'All Files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      properties: ['openFile'],
      title: 'Select Python executable',
      filters,
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, path: null };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('settings:getOutputsDir', () => {
    return { ok: true, path: getOutputsBaseDir() };
  });

  ipcMain.handle('settings:setOutputsDir', (_e, dirPath) => {
    if (typeof dirPath !== 'string' || !dirPath.trim()) {
      return { ok: false, error: 'Path is required' };
    }
    const resolved = path.resolve(dirPath.trim());
    if (!path.isAbsolute(resolved)) {
      return { ok: false, error: 'Path must be absolute' };
    }
    try {
      safeMkdir(resolved);
      const testFile = path.join(resolved, '.yt_uploader_writable_test');
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
    } catch (e) {
      return { ok: false, error: `Directory not writable: ${e?.message || String(e)}` };
    }
    saveAppConfig({ outputsDir: resolved });
    const reportsDir = path.join(resolved, 'Reports');
    safeMkdir(reportsDir);
    migrateReportsToSubfolder(resolved);
    cleanOldReports(reportsDir, REPORTS_RETENTION_DAYS);
    return { ok: true, path: resolved };
  });

  ipcMain.handle('settings:resetOutputsDir', () => {
    saveAppConfig({ outputsDir: undefined });
    const newPath = getOutputsBaseDir();
    const reportsDir = path.join(newPath, 'Reports');
    safeMkdir(reportsDir);
    migrateReportsToSubfolder(newPath);
    cleanOldReports(reportsDir, REPORTS_RETENTION_DAYS);
    return { ok: true, path: newPath };
  });

  ipcMain.handle('settings:getDeveloperOptions', () => getDeveloperOptions());
  ipcMain.handle('settings:setDeveloperOptions', (_e, payload) => setDeveloperOptions(payload));
  ipcMain.handle('settings:getComputeBackend', async () => getComputeBackend());
  ipcMain.handle('settings:refreshComputeBackend', async () => refreshComputeBackend());

  ipcMain.handle('settings:getDefaultOutputsDir', () => {
    return { ok: true, path: getDefaultOutputsDir() };
  });

  // secrets (keytar-backed)
  ipcMain.handle('secrets:getYouTubeTokens', async () => {
    const tokens = await getYouTubeTokens();
    return { ok: true, tokens: tokens ? { redacted: true } : null };
  });
  ipcMain.handle('secrets:setYouTubeTokens', async (_e, tokens) => {
    await setYouTubeTokens(tokens);
    return { ok: true };
  });
  ipcMain.handle('secrets:clearYouTubeTokens', async () => {
    await clearYouTubeTokens();
    clearYouTubeTokensCache();
    return { ok: true };
  });

  ipcMain.handle('secrets:getGoogleOAuthClient', async () => {
    const creds = await getGoogleOAuthClient();
    return {
      ok: true,
      clientId: creds?.clientId ?? null,
      hasClientSecret: Boolean(creds?.clientSecret),
    };
  });
  ipcMain.handle('secrets:setGoogleOAuthClient', async (_e, clientId, clientSecret) => {
    await setGoogleOAuthClient(String(clientId ?? '').trim(), clientSecret);
    return { ok: true };
  });
  ipcMain.handle('secrets:clearGoogleOAuthClient', async () => {
    await clearGoogleOAuthClient();
    return { ok: true };
  });

  ipcMain.handle('auth:setSupabaseAccessToken', async (_e, token, functionsUrl) => {
    supabaseAccessToken = typeof token === 'string' ? token : '';
    if (typeof functionsUrl === 'string' && functionsUrl.trim()) {
      supabaseFunctionsUrlOverride = functionsUrl.trim();
    }
    return { ok: true };
  });

  ipcMain.handle('settings:moveOutputsToNewDir', async (_e, { fromDir, toDir, deleteAfterCopy = false }) => {
    if (typeof fromDir !== 'string' || typeof toDir !== 'string' || !path.isAbsolute(fromDir) || !path.isAbsolute(toDir)) {
      return { ok: false, error: 'Invalid paths' };
    }
    const normalizedFrom = path.resolve(fromDir);
    const normalizedTo = path.resolve(toDir);
    if (normalizedFrom === normalizedTo) {
      return { ok: true, copiedCount: 0, copiedBytes: 0, deletedCount: 0, deleteFailedPaths: [] };
    }
    const subdirs = ['Audio', 'Transcripts', 'Metadata', 'Exports', 'Reports'];
    let copiedCount = 0;
    let copiedBytes = 0;
    const deleteFailedPaths = [];

    function copyRecursive(srcPath, destPath) {
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        copiedCount += 1;
        copiedBytes += stat.size;
      } else if (stat.isDirectory()) {
        safeMkdir(destPath);
        const entries = fs.readdirSync(srcPath, { withFileTypes: true });
        for (const ent of entries) {
          copyRecursive(path.join(srcPath, ent.name), path.join(destPath, ent.name));
        }
      }
    }

    try {
      safeMkdir(normalizedTo);
      for (const name of subdirs) {
        const src = path.join(normalizedFrom, name);
        const dest = path.join(normalizedTo, name);
        if (!fs.existsSync(src)) continue;
        safeMkdir(dest);
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const ent of entries) {
          const srcPath = path.join(src, ent.name);
          const destPath = path.join(dest, ent.name);
          try {
            if (fs.existsSync(destPath)) continue;
            copyRecursive(srcPath, destPath);
          } catch (e) {
            console.warn('[outputs-migration] Skip copy:', srcPath, e?.message);
          }
        }
      }

      let deletedCount = 0;
      if (deleteAfterCopy) {
        for (const name of subdirs) {
          const subPath = path.join(normalizedFrom, name);
          if (!fs.existsSync(subPath)) continue;
          function deleteRecursiveSafe(dirPath) {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const ent of entries) {
              const full = path.join(dirPath, ent.name);
              const relative = path.relative(normalizedFrom, full);
              if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
              try {
                if (ent.isFile()) {
                  fs.unlinkSync(full);
                  deletedCount += 1;
                } else if (ent.isDirectory()) {
                  deleteRecursiveSafe(full);
                  fs.rmdirSync(full);
                }
              } catch (e) {
                deleteFailedPaths.push(full);
                console.warn('[outputs-migration] Failed to delete:', full, e?.message);
              }
            }
          }
          deleteRecursiveSafe(subPath);
          try {
            if (fs.readdirSync(subPath).length === 0) fs.rmdirSync(subPath);
          } catch {
            // dir not empty or locked
          }
        }
      }

      const copiedMB = (copiedBytes / (1024 * 1024)).toFixed(2);
      const logLine = `Outputs migration: copied ${copiedCount} files (${copiedMB} MB) to ${normalizedTo}.`;
      console.log('[outputs-migration]', logLine);
      try {
        const formatted = formatTechLog('INFO', 'filesystem', logLine, { copiedCount, copiedMB: String(copiedMB) });
        mainWindow?.webContents?.send('pipeline:log', { runId: 'outputs-migration', line: formatted + '\n' });
      } catch {
        // ignore
      }
      if (deleteAfterCopy) {
        const delLine = `Outputs migration: deleted ${deletedCount} files from ${normalizedFrom}.`;
        console.log('[outputs-migration]', delLine);
        try {
          const formatted = formatTechLog('INFO', 'filesystem', delLine, { deletedCount });
          mainWindow?.webContents?.send('pipeline:log', { runId: 'outputs-migration', line: formatted + '\n' });
        } catch {
          // ignore
        }
        if (deleteFailedPaths.length > 0) {
          const failLine = `Outputs migration: failed to delete ${deleteFailedPaths.length} files.`;
          console.warn('[outputs-migration]', failLine, deleteFailedPaths);
          try {
            const formatted = formatTechLog('WARN', 'filesystem', failLine, { count: deleteFailedPaths.length });
            mainWindow?.webContents?.send('pipeline:log', { runId: 'outputs-migration', line: formatted + '\n' });
          } catch {
            // ignore
          }
        }
      }

      return {
        ok: true,
        copiedCount,
        copiedBytes,
        deletedCount,
        deleteFailedCount: deleteFailedPaths.length,
        deleteFailedPaths: deleteFailedPaths.slice(0, 50),
        message: deleteFailedPaths.length > 0
          ? 'Moved outputs. Some files could not be removed from the old folder (in use). You can delete them later.'
          : undefined,
      };
    } catch (e) {
      const errMsg = String(e?.message || e);
      console.error('[outputs-migration]', errMsg);
      return { ok: false, error: errMsg, copiedCount, copiedBytes, deletedCount: 0, deleteFailedPaths: [] };
    }
  });

  ipcMain.handle('metadata:getCustomInstructions', () => {
    const settings = loadMetadataSettings();
    return settings.customInstructions || { all: '', youtube: '', instagram: '', tiktok: '' };
  });

  ipcMain.handle('metadata:setCustomInstructions', (_e, instructions) => {
    const settings = loadMetadataSettings();
    settings.customInstructions = normalizePlatformMap(instructions);
    saveMetadataSettings(settings);
    return settings.customInstructions;
  });

  ipcMain.handle('metadata:getCustomAiSettings', () => {
    const settings = loadMetadataSettings();
    return {
      customInstructions: normalizePlatformMap(settings.customInstructions),
      descriptionTemplate: normalizePlatformMap(settings.descriptionTemplate),
      blocks: normalizeCustomAiBlocks(settings.blocks),
    };
  });

  ipcMain.handle('metadata:setCustomAiSettings', (_e, payload) => {
    const settings = loadMetadataSettings();
    settings.customInstructions = normalizePlatformMap(payload?.customInstructions);
    settings.descriptionTemplate = normalizePlatformMap(payload?.descriptionTemplate);
    settings.blocks = normalizeCustomAiBlocks(payload?.blocks);
    saveMetadataSettings(settings);
    return settings;
  });

  // Custom AI presets
  const presetsUserDataDir = app.getPath('userData');
  const presetsFileInit = path.join(presetsUserDataDir, 'custom_ai_presets.json');
  console.log(`[customai:presets:init] userData=${presetsUserDataDir}`);
  console.log(`[customai:presets:init] presetsFile=${presetsFileInit}`);
  const syncMetadataFromPreset = (preset) => {
    if (!preset) return false;
    const settings = loadMetadataSettings();
    settings.customInstructions = normalizePlatformMap(preset.instructions);
    settings.descriptionTemplate = normalizePlatformMap(preset.descriptionTemplate);
    settings.blocks = normalizeCustomAiBlocks(preset.blocks);
    saveMetadataSettings(settings);
    return true;
  };

  ipcMain.handle('customai:presets:list', () => {
    const store = loadCustomAiPresetsStore();
    return {
      activePresetId: store.activePresetId || null,
      presets: (store.presets || []).map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
      })),
    };
  });

  ipcMain.handle('customai:presets:get', (_e, presetId) => {
    const store = loadCustomAiPresetsStore();
    if (!presetId || typeof presetId !== 'string') return null;
    return store.presets.find((p) => p.id === presetId) || null;
  });

  ipcMain.handle('customai:presets:save', (_e, preset) => {
    try {
      const store = loadCustomAiPresetsStore();
      const presetsFile = path.join(app.getPath('userData'), 'custom_ai_presets.json');
      console.log(`[IPC save] called ${Date.now()}`);
      console.log(`[IPC save] userData=${app.getPath('userData')}`);
      console.log(`[IPC save] presetsFile=${presetsFile}`);
      console.log(`[IPC save] incoming preset name=${preset?.name} id=${preset?.id}`);
      console.log(`[IPC save] before count=${store.presets?.length ?? 0}`);
      if (!Array.isArray(store.presets)) {
        store.presets = [];
      }
      const existingIndex = store.presets.findIndex((p) => p.id === preset?.id);
      const existing = existingIndex >= 0 ? store.presets[existingIndex] : null;
      const mergedPreset = {
        ...existing,
        ...preset,
        descriptionTemplate: preset?.descriptionTemplate ?? existing?.descriptionTemplate,
        blocks: {
          cta: preset?.blocks?.cta ?? existing?.blocks?.cta,
          links: preset?.blocks?.links ?? existing?.blocks?.links,
          disclaimer: preset?.blocks?.disclaimer ?? existing?.blocks?.disclaimer,
        },
      };
      const normalized = normalizeCustomAiPreset(mergedPreset);
      if (!normalized.name) {
        return { ok: false, error: 'Preset name is required' };
      }

      const now = Date.now();
      const createdAt = existing?.createdAt ?? normalized.createdAt ?? now;
      const updatedPreset = {
        ...normalized,
        createdAt,
        updatedAt: now,
      };

      if (existingIndex >= 0) {
        store.presets[existingIndex] = updatedPreset;
      } else {
        store.presets.push(updatedPreset);
      }
      const saved = saveCustomAiPresetsStore(store);
      console.log(`[IPC save] after count=${store.presets.length}`);
      console.log(`[IPC save] saved=${saved} id=${updatedPreset.id} name=${updatedPreset.name}`);

      if (store.activePresetId === updatedPreset.id) {
        syncMetadataFromPreset(updatedPreset);
      }

      return { ok: true, preset: updatedPreset };
    } catch (e) {
      console.error('[main] Error saving custom AI preset:', e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('customai:presets:delete', (_e, presetId) => {
    try {
      if (!presetId || typeof presetId !== 'string') {
        return { ok: false, error: 'Invalid preset id' };
      }
      const store = loadCustomAiPresetsStore();
      const filtered = store.presets.filter((p) => p.id !== presetId);
      store.presets = filtered;
      if (store.activePresetId === presetId) {
        store.activePresetId = null;
      }
      saveCustomAiPresetsStore(store);
      return { ok: true };
    } catch (e) {
      console.error('[main] Error deleting custom AI preset:', e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('customai:presets:setActive', (_e, presetId) => {
    try {
      const store = loadCustomAiPresetsStore();
      if (presetId === null || presetId === undefined || presetId === '') {
        store.activePresetId = null;
        saveCustomAiPresetsStore(store);
        return { ok: true, activePresetId: null };
      }
      if (typeof presetId !== 'string') {
        return { ok: false, error: 'Invalid preset id' };
      }
      const preset = store.presets.find((p) => p.id === presetId);
      if (!preset) {
        return { ok: false, error: 'Preset not found' };
      }
      store.activePresetId = presetId;
      saveCustomAiPresetsStore(store);
      syncMetadataFromPreset(preset);
      return { ok: true, activePresetId: presetId };
    } catch (e) {
      console.error('[main] Error setting active custom AI preset:', e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('customai:presets:applyToOutputs', async (_e, payload) => {
    try {
      const paths = Array.isArray(payload?.paths)
        ? payload.paths.filter((p) => typeof p === 'string' && p.trim())
        : [];
      const platforms = Array.isArray(payload?.platforms)
        ? payload.platforms.filter((p) => ['youtube', 'instagram', 'tiktok'].includes(p))
        : undefined;
      return await applyCustomAiPresetToOutputs({ paths, platforms });
    } catch (e) {
      console.error('[main] Error applying custom AI preset to outputs:', e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('autoupload:triggerNotification', () => {
    console.warn('[main] autoupload:triggerNotification called but autoupload module not loaded');
    return { ok: false, error: 'Autoupload module not available' };
  });

  ipcMain.handle('autoupload:getPendingNotifications', () => {
    return [];
  });

  ipcMain.handle('autoupload:reShowPendingNotifications', () => {
    console.warn('[main] autoupload:reShowPendingNotifications called but autoupload module not loaded');
    return { ok: false, error: 'Autoupload module not available' };
  });

  ipcMain.handle('autoupload:authYouTube', async () => {
    console.warn('[main] autoupload:authYouTube called but autoupload module not loaded');
    return { ok: false, error: 'Autoupload module not available', code: 1 };
  });

  ipcMain.handle('assistoverlay:next', async () => {
    console.warn('[main] assistoverlay:next called but autoupload module not loaded');
    return { ok: false, error: 'Autoupload module not available' };
  });

  ipcMain.handle('assistoverlay:getCount', async () => {
    return { ok: true, count: 0 };
  });

  console.log('[main] Fallback jobs and autoupload handlers registered');

  // Initialize auto-upload IPC handlers.
  // This module registers:
  // - jobs:save / jobs:load (will override fallback handlers)
  // - autoupload:setEnabled / autoupload:authYouTube (will override fallback handlers)
  try {
    const au = await import('./autoupload.mjs');
    setAutoUploadWindowFn = au?.setAutoUploadWindow || null;
    setAssistOverlayWindowFn = au?.setAssistOverlayWindow || null;
    refreshAssistOverlayStateFn = au?.refreshAssistOverlayState || null;
    if (typeof au?.initAutoUpload === 'function') {
      au.initAutoUpload(ipcMain, { getOutputsDir: () => getOutputsBaseDir() });
      console.log('[autoupload] IPC handlers registered successfully');
    } else {
      console.error('[autoupload] initAutoUpload function not found');
    }
  } catch (e) {
    console.error('[autoupload] init failed:', e);
    console.error('[autoupload] error stack:', e?.stack);
    console.log('[autoupload] Using fallback handlers for all autoupload operations');
  }

  // Initialize YouTube (Node-only googleapis) IPC handlers.
  try {
    const yt = await import('./youtube_ipc.mjs');
    setYouTubeWindowFn = yt?.setYouTubeWindow || null;
    if (typeof yt?.initYouTubeIpc === 'function') {
      yt.initYouTubeIpc(ipcMain, {
        appRoot: APP_ROOT,
        getOutputsDir: () => getOutputsBaseDir(),
        logToPipeline: (line) => {
          try {
            const trimmed = String(line || '').replace(/\r?\n$/, '').trim();
            const formatted = formatTechLog('INFO', 'youtube', trimmed || 'Upload log', {});
            mainWindow?.webContents?.send('pipeline:log', { runId: 'youtube', line: formatted + '\n' });
          } catch {
            // ignore
          }
        },
      });
      console.log('[youtube] IPC handlers registered');
    } else {
      console.error('[youtube] initYouTubeIpc function not found');
    }
  } catch (e) {
    console.error('[youtube] init failed:', e);
    console.error('[youtube] error stack:', e?.stack);
  }

  // File system stats handler (must be registered early)
  ipcMain.handle('fs:getFileStats', async (_evt, filePath) => {
    // E2E_SEED mode: return fake stats for seeded library rows (guide screenshots)
    if (process.env.E2E_SEED === '1' && typeof filePath === 'string' && filePath.includes('e2e-seed')) {
      const baseTime = Date.now() - 86400000;
      const num = filePath.match(/seed-(\d+)\.mp4/)?.[1] || '1';
      const offset = parseInt(num, 10) * 3600000;
      return {
        ok: true,
        birthtimeMs: baseTime + offset,
        mtimeMs: baseTime + offset,
        size: 1024 * 1024 * 50,
      };
    }
    // E2E_TEST mode: return fake stats for fake files
    if (process.env.E2E_TEST === '1' && filePath?.includes('e2e/test-videos')) {
      // Return deterministic stats based on filename for testing
      const baseTime = Date.now() - 86400000; // 1 day ago
      const videoNum = filePath.match(/video(\d+)\.mp4/)?.[1] || '1';
      const offset = parseInt(videoNum) * 3600000; // 1 hour per video
      // Support video numbers from 1 to 30 (or more)
      const stats = {
        ok: true,
        birthtimeMs: baseTime + offset,
        mtimeMs: baseTime + offset,
        size: 1024 * 1024 * 100, // 100MB fake size
      };
      return stats;
    }
    try {
      const stats = fs.statSync(filePath);
      return {
        ok: true,
        // Important: don't collapse created/modified into the same value.
        // Using `||` can treat 0 as falsy and incorrectly fall back to mtimeMs.
        birthtimeMs: Number.isFinite(stats.birthtimeMs) ? stats.birthtimeMs : undefined,
        mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : undefined,
        size: stats.size,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Reveal file in folder handler
  ipcMain.handle('shell:showItemInFolder', async (_evt, filePath) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { ok: false, error: 'Invalid file path' };
      }
      if (!fs.existsSync(filePath)) {
        return { ok: false, notFound: true };
      }
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Template handlers
  const templatesFile = path.join(app.getPath('userData'), 'templates.json');
  
  ipcMain.handle('templates:load', () => {
    try {
      if (!fs.existsSync(templatesFile)) return [];
      const data = fs.readFileSync(templatesFile, 'utf8');
      const templates = JSON.parse(data);
      return Array.isArray(templates) ? templates : [];
    } catch (e) {
      console.error('[main] Error loading templates:', e);
      return [];
    }
  });

  ipcMain.handle('templates:save', (_e, template) => {
    try {
      const templates = [];
      if (fs.existsSync(templatesFile)) {
        const data = fs.readFileSync(templatesFile, 'utf8');
        const existing = JSON.parse(data);
        if (Array.isArray(existing)) templates.push(...existing);
      }
      
      // Generate ID if missing
      if (!template.id) {
        template.id = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Set timestamps
      const now = Date.now();
      if (!template.createdAt) template.createdAt = now;
      template.updatedAt = now;
      
      // Remove existing template with same ID
      const filtered = templates.filter(t => t.id !== template.id);
      filtered.push(template);
      
      safeMkdir(path.dirname(templatesFile));
      fs.writeFileSync(templatesFile, JSON.stringify(filtered, null, 2), 'utf8');
      return { ok: true, template };
    } catch (e) {
      console.error('[main] Error saving template:', e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('templates:delete', (_e, templateId) => {
    try {
      if (!fs.existsSync(templatesFile)) return { ok: true };
      const data = fs.readFileSync(templatesFile, 'utf8');
      const templates = JSON.parse(data);
      if (!Array.isArray(templates)) return { ok: true };
      
      const filtered = templates.filter(t => t.id !== templateId);
      fs.writeFileSync(templatesFile, JSON.stringify(filtered, null, 2), 'utf8');
      return { ok: true };
    } catch (e) {
      console.error('[main] Error deleting template:', e);
      return { ok: false, error: String(e) };
    }
  });

  // Shell handlers
  ipcMain.handle('shell:openExternal', async (_evt, url) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Auth: open OAuth URL in external browser (Supabase/Google login)
  ipcMain.handle('auth:openExternal', async (_evt, url) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Assist Center handlers
  const DUE_NOW_TOLERANCE_MIN = 10; // 10 minutes tolerance window
  
  ipcMain.handle('assistcenter:getDueJobs', async () => {
    try {
      const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
      if (!fs.existsSync(jobsFile)) return { dueNow: [], dueSoon: [] };

      const data = fs.readFileSync(jobsFile, 'utf8');
      let jobs = JSON.parse(data);
      if (!Array.isArray(jobs)) return { dueNow: [], dueSoon: [] };

      // Exclude jobs whose row is archived (library has archivedAt set for that filePath)
      const libraryFileForDue = path.join(app.getPath('userData'), 'library.json');
      const archivedPaths = new Set();
      if (fs.existsSync(libraryFileForDue)) {
        try {
          const libData = fs.readFileSync(libraryFileForDue, 'utf8');
          const lib = JSON.parse(libData);
          const rows = Array.isArray(lib?.rows) ? lib.rows : (Array.isArray(lib) ? lib : []);
          const norm = (p) => path.normalize(String(p || '')).toLowerCase();
          for (const row of rows) {
            if (row.archivedAt != null && row.filePath) archivedPaths.add(norm(row.filePath));
          }
        } catch {
          // ignore
        }
      }
      if (archivedPaths.size > 0) {
        const norm = (p) => path.normalize(String(p || '')).toLowerCase();
        jobs = jobs.filter((j) => !archivedPaths.has(norm(j.filePath)));
      }

      const now = Date.now();
      const toleranceMs = DUE_NOW_TOLERANCE_MIN * 60 * 1000;
      const soonMs = 60 * 60 * 1000; // Next 60 minutes
      
      const dueNow = [];
      const dueSoon = [];
      
      for (const job of jobs) {
        if (!job || typeof job.publishAtUtcMs !== 'number') continue;
        if (job.publishAtUtcMs > now + soonMs) continue; // Too far in future
        
        // Check if job has pending platforms (Instagram/TikTok only for manual assist)
        const targets = job.targets || { youtube: false, instagram: false, tiktok: false };
        const run = job.run || {};
        
        const pendingPlatforms = [];
        if (targets.instagram && !run.instagram?.done) {
          pendingPlatforms.push({ platform: 'instagram', status: 'pending' });
        }
        if (targets.tiktok && !run.tiktok?.done) {
          pendingPlatforms.push({ platform: 'tiktok', status: 'pending' });
        }
        
        if (pendingPlatforms.length === 0) continue; // No pending manual assist platforms
        
        const jobItem = {
          id: job.id || job.filePath,
          filePath: job.filePath,
          filename: path.basename(job.filePath || ''),
          publishAtUtcMs: job.publishAtUtcMs,
          platforms: pendingPlatforms,
        };
        
        if (job.publishAtUtcMs <= now + toleranceMs) {
          dueNow.push(jobItem);
        } else if (job.publishAtUtcMs <= now + soonMs) {
          dueSoon.push(jobItem);
        }
      }
      
      // Sort by publish time
      dueNow.sort((a, b) => a.publishAtUtcMs - b.publishAtUtcMs);
      dueSoon.sort((a, b) => a.publishAtUtcMs - b.publishAtUtcMs);
      
      return { dueNow, dueSoon };
    } catch (e) {
      console.error('[assist-center] Error loading due jobs:', e);
      return { dueNow: [], dueSoon: [], error: String(e) };
    }
  });
  
  ipcMain.handle('assistcenter:assistJob', async (_evt, { jobId, platform }) => {
    try {
      const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
      if (!fs.existsSync(jobsFile)) {
        return { ok: false, error: 'Jobs file not found' };
      }
      
      const data = fs.readFileSync(jobsFile, 'utf8');
      const jobs = JSON.parse(data);
      if (!Array.isArray(jobs)) {
        return { ok: false, error: 'Invalid jobs format' };
      }
      
      const job = jobs.find(j => (j.id || j.filePath) === jobId);
      if (!job) {
        return { ok: false, error: 'Job not found' };
      }
      
      if (!['instagram', 'tiktok'].includes(platform)) {
        return { ok: false, error: 'Invalid platform (must be instagram or tiktok)' };
      }
      
      // Implement assist logic (same as autoupload:triggerAssist)
      const url = platform === 'instagram' 
        ? 'https://www.instagram.com/' 
        : 'https://www.tiktok.com/upload';
      
      // Copy metadata to clipboard
      const outputsDir = getOutputsBaseDir();
      const stem = path.basename(job.filePath, path.extname(job.filePath));
      const platformDir = path.join(outputsDir, 'Exports', platform === 'instagram' ? 'Instagram' : 'TikTok');
      
      const readText = (p) => {
        try {
          return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
        } catch {
          return '';
        }
      };
      
      const titleFile = path.join(platformDir, `${stem}.title.txt`);
      const descFile = path.join(platformDir, `${stem}.description.txt`);
      const tagsFile = path.join(platformDir, `${stem}.hashtags.txt`);
      
      const title = readText(titleFile);
      const desc = readText(descFile);
      const tags = readText(tagsFile);
      
      // Format metadata for clipboard (same format as autoupload.mjs)
      const clipboardText = [title, desc, tags].filter(Boolean).join('\n\n');
      const { clipboard } = await import('electron');
      clipboard.writeText(clipboardText);
      
      // Open browser
      await shell.openExternal(url);
      
      // Show file in folder
      shell.showItemInFolder(job.filePath);
      
      // Log to pipeline log
      try {
        mainWindow?.webContents?.send('pipeline:log', { 
          runId: 'assist-center', 
          line: `[assist-center] Assisted ${platform} for ${path.basename(job.filePath)}\n` 
        });
      } catch {
        // ignore
      }
      
      console.log(`[assist-center] Assisted ${platform} for job ${jobId}`);
      
      return { ok: true };
    } catch (e) {
      console.error('[assist-center] Error assisting job:', e);
      return { ok: false, error: String(e) };
    }
  });
  
  ipcMain.handle('assistcenter:markDone', async (_evt, { jobId, platform }) => {
    try {
      const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
      if (!fs.existsSync(jobsFile)) {
        return { ok: false, error: 'Jobs file not found' };
      }
      
      const data = fs.readFileSync(jobsFile, 'utf8');
      const jobs = JSON.parse(data);
      if (!Array.isArray(jobs)) {
        return { ok: false, error: 'Invalid jobs format' };
      }
      
      const job = jobs.find(j => (j.id || j.filePath) === jobId);
      if (!job) {
        return { ok: false, error: 'Job not found' };
      }
      
      if (!['instagram', 'tiktok'].includes(platform)) {
        return { ok: false, error: 'Invalid platform' };
      }
      
      job.run = job.run || {};
      job.run[platform] = { done: true, at: Date.now(), ok: true, mode: 'manual_assist' };
      
      fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');
      
      // Send status update to renderer
      try {
        mainWindow?.webContents?.send('autoupload:status', {
          id: job.id || job.filePath,
          platform,
          status: 'Done',
          message: `Posted on ${platform}`,
        });
      } catch {
        // ignore
      }
      
      console.log(`[assist-center] Marked ${platform} as done for job ${jobId}`);

      refreshAssistOverlayStateFn?.();
      
      return { ok: true };
    } catch (e) {
      console.error('[assist-center] Error marking job as done:', e);
      return { ok: false, error: String(e) };
    }
  });
  
  ipcMain.handle('assistcenter:skipJob', async (_evt, { jobId, platform }) => {
    try {
      const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
      if (!fs.existsSync(jobsFile)) {
        return { ok: false, error: 'Jobs file not found' };
      }
      
      const data = fs.readFileSync(jobsFile, 'utf8');
      const jobs = JSON.parse(data);
      if (!Array.isArray(jobs)) {
        return { ok: false, error: 'Invalid jobs format' };
      }
      
      const job = jobs.find(j => (j.id || j.filePath) === jobId);
      if (!job) {
        return { ok: false, error: 'Job not found' };
      }
      
      if (!['instagram', 'tiktok'].includes(platform)) {
        return { ok: false, error: 'Invalid platform' };
      }
      
      // Skip +30 minutes: update publishAtUtcMs for this platform
      // Since jobs can have multiple platforms, we need to track per-platform publish times
      // For simplicity, we'll update the main publishAtUtcMs and add 30 minutes
      const skipMs = 30 * 60 * 1000; // 30 minutes
      job.publishAtUtcMs = (job.publishAtUtcMs || Date.now()) + skipMs;
      
      fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');
      
      console.log(`[assist-center] Skipped ${platform} for job ${jobId} (+30 min)`);

      refreshAssistOverlayStateFn?.();
      
      return { ok: true, newPublishAtUtcMs: job.publishAtUtcMs };
    } catch (e) {
      console.error('[assist-center] Error skipping job:', e);
      return { ok: false, error: String(e) };
    }
  });

  console.log('[fs] IPC handlers registered');
  console.log('[assist-center] IPC handlers registered');
}

async function ensureCriticalResourcesPresent() {
  if (!app.isPackaged) {
    return;
  }

  const problems = [];

  const pythonPath = getBundledPythonPath();
  if (!pythonPath || !fs.existsSync(pythonPath)) {
    problems.push('Embedded Python runtime (resources/python) is missing or invalid.');
  }

  const pipelineDir = getPipelineDir();
  const pipelineScript = path.join(pipelineDir, 'run_pipeline.py');
  if (!fs.existsSync(pipelineDir) || !fs.existsSync(pipelineScript)) {
    problems.push('Python backend (yt_pipeline/run_pipeline.py) is missing from installation.');
  }

  const { ffmpeg, ffprobe } = getBundledFfmpegPaths();
  const ffmpegPath = ffmpeg && fs.existsSync(ffmpeg) ? ffmpeg : '';
  const ffprobePath = ffprobe && fs.existsSync(ffprobe) ? ffprobe : '';
  if (!fs.existsSync(ffmpeg)) {
    problems.push('Internal ffmpeg executable (resources/bin/ffmpeg.exe) is missing.');
  }
  if (!fs.existsSync(ffprobe)) {
    problems.push('Internal ffprobe executable (resources/bin/ffprobe.exe) is missing.');
  }

  if (problems.length > 0) {
    const message = [
      'ClipCast is not correctly installed.',
      '',
      ...problems.map((p) => `- ${p}`),
      '',
      'Please reinstall ClipCast from the official installer or contact support.',
    ].join('\n');

    try {
      dialog.showErrorBox('ClipCast - Installation error', message);
    } catch {
      // ignore dialog errors
    }

    log('ERROR', 'startup', 'Critical resources missing', { problems });
    app.quit();
  }
}

app.whenReady().then(async () => {
  // Capture any deep link passed on first launch
  const initialDeepLink = getDeepLinkFromArgv(process.argv);
  if (initialDeepLink) {
    pendingDeepLinkUrl = initialDeepLink;
  }

  await ensureCriticalResourcesPresent();

  // Register IPC handlers FIRST (before window creation)
  await initIpcHandlers();

  try {
    await migrateLegacySecrets({
      log: (line) => console.log(String(line || '')),
    });
  } catch (e) {
    console.warn('[secrets] migration failed:', redactSecrets(e?.message || e));
  }

  mainWindow = await createWindow();
  
  // Handle window closed event
  mainWindow.on('closed', () => {
    mainWindow = null;
    console.log('[main] Main window closed');
  });

  // Fallback: deliver pending deep link on did-finish-load and dom-ready so renderer always receives it
  registerDeepLinkFallback(mainWindow);

  // Scheduled update check on startup when packaged (respects \"Later\" deferrals)
  if (app.isPackaged) {
    scheduleUpdateCheckFromConfig();
  }

  // Wire window references for event emission
  setAutoUploadWindowFn?.(mainWindow);
  assistOverlayWindow = await createAssistOverlayWindow();
  setAssistOverlayWindowFn?.(assistOverlayWindow);
  setYouTubeWindowFn?.(mainWindow);
  
  // Create system tray for background operation
  createTray();

  // Start batch notification timer
  startBatchNotificationTimer();

  // Ensure outputs/Reports exists, migrate any root-level report files, then clean old reports if auto-cleanup is ON (30-day retention)
  try {
    const outputsDir = getOutputsBaseDir();
    const reportsDir = getOutputsSubdir('Reports');
    migrateReportsToSubfolder(outputsDir);
    cleanOldReports(reportsDir, REPORTS_RETENTION_DAYS);
    runCleanupOutputArtifactsIfEnabled({
      sendPipelineLog: (line) => {
        try {
          mainWindow?.webContents?.send('pipeline:log', { runId: 'auto-clean', line: line + '\n' });
        } catch {
          // ignore
        }
      },
    });
  } catch {
    // ignore
  }

  // Optional: run reports cleanup once per day (lightweight, does not block UI)
  const REPORTS_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const reportsCleanupTimer = setInterval(() => {
    try {
      const outputsDir = getOutputsBaseDir();
      const reportsDir = path.join(outputsDir, 'Reports');
      migrateReportsToSubfolder(outputsDir);
      cleanOldReports(reportsDir, REPORTS_RETENTION_DAYS);
      runCleanupOutputArtifactsIfEnabled({
        sendPipelineLog: (line) => {
          try {
            mainWindow?.webContents?.send('pipeline:log', { runId: 'auto-clean', line: line + '\n' });
          } catch {
            // ignore
          }
        },
      });
    } catch {
      // ignore
    }
  }, REPORTS_CLEANUP_INTERVAL_MS);
  reportsCleanupTimer.unref?.();

  app.on('activate', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = await createWindow();
      mainWindow.on('closed', () => {
        mainWindow = null;
        console.log('[main] Main window closed');
      });
      registerDeepLinkFallback(mainWindow);
      setAutoUploadWindowFn?.(mainWindow);
      assistOverlayWindow = await createAssistOverlayWindow();
      setAssistOverlayWindowFn?.(assistOverlayWindow);
      setYouTubeWindowFn?.(mainWindow);
    }
  });
});

function createTray() {
  // Windows tray icons are most reliable with PNG/ICO (SVG often renders as empty).
  // Preferred: use a real PNG file if available (user-provided).
  // Fallback: generate a small PNG at runtime (no external files, no deps).

  const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const pngChunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = data.length;
    const out = Buffer.allocUnsafe(8 + len + 4);
    out.writeUInt32BE(len, 0);
    typeBuf.copy(out, 4);
    data.copy(out, 8);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    out.writeUInt32BE(crc, 8 + len);
    return out;
  };

  const buildPngRgba = (w, h, pixelFn) => {
    // Raw image data: each row starts with filter byte 0, then RGBA pixels.
    const rowSize = 1 + w * 4;
    const raw = Buffer.allocUnsafe(rowSize * h);
    let off = 0;
    for (let y = 0; y < h; y++) {
      raw[off++] = 0; // filter type 0
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = pixelFn(x, y);
        raw[off++] = r & 0xff;
        raw[off++] = g & 0xff;
        raw[off++] = b & 0xff;
        raw[off++] = a & 0xff;
      }
    }

    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.allocUnsafe(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const compressed = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([
      signature,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  };

  const normalizeTrayIcon = (img, targetSize = 16) => {
    // Crops transparent padding and centers the visible pixels into a targetSize x targetSize PNG.
    // Works around source PNGs that have the icon drawn in a corner (common when exporting).
    try {
      if (!img || img.isEmpty()) return img;
      const { width, height } = img.getSize();
      if (!width || !height) return img;

      const bmp = img.toBitmap(); // BGRA
      const alphaThreshold = 10;
      let minX = width, minY = height, maxX = -1, maxY = -1;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const a = bmp[i + 3];
          if (a > alphaThreshold) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      // If fully transparent, give up.
      if (maxX < minX || maxY < minY) return img;

      const cropW = Math.max(1, maxX - minX + 1);
      const cropH = Math.max(1, maxY - minY + 1);

      let cropped = img;
      try {
        cropped = img.crop({ x: minX, y: minY, width: cropW, height: cropH });
      } catch {
        // ignore crop failures
      }

      const cSize = cropped.getSize();
      const scale = targetSize / Math.max(1, Math.max(cSize.width, cSize.height));
      const outW = Math.max(1, Math.round(cSize.width * scale));
      const outH = Math.max(1, Math.round(cSize.height * scale));

      const resized = cropped.resize({ width: outW, height: outH, quality: 'best' });
      const rSize = resized.getSize();
      const rBmp = resized.toBitmap(); // BGRA

      const offsetX = Math.floor((targetSize - rSize.width) / 2);
      const offsetY = Math.floor((targetSize - rSize.height) / 2);

      const png = buildPngRgba(targetSize, targetSize, (x, y) => {
        const sx = x - offsetX;
        const sy = y - offsetY;
        if (sx < 0 || sy < 0 || sx >= rSize.width || sy >= rSize.height) return [0, 0, 0, 0];
        const i = (sy * rSize.width + sx) * 4;
        const b = rBmp[i + 0];
        const g = rBmp[i + 1];
        const r = rBmp[i + 2];
        const a = rBmp[i + 3];
        return [r, g, b, a];
      });

      return nativeImage.createFromBuffer(png);
    } catch {
      return img;
    }
  };

  let icon = nativeImage.createEmpty();

  // 1) Try loading a project icon first (best quality)
  try {
    const assetRoots = [];
    if (app.isPackaged) {
      assetRoots.push(path.join(process.resourcesPath, 'assets'));
    }
    assetRoots.push(path.join(APP_ROOT, 'assets'));

    const preferredIconCandidates = [];
    for (const root of assetRoots) {
      preferredIconCandidates.push(
        // Logo (play + broadcast) – primary tray icon
        path.join(root, 'logo option 1.png'),
        // Fallbacks
        path.join(root, 'icon_01.png'),
        path.join(root, 'tray-icon.png')
      );
    }

    for (const p of preferredIconCandidates) {
      try {
        if (!p || !fs.existsSync(p)) continue;
        const fromFile = nativeImage.createFromPath(p);
        if (!fromFile.isEmpty()) {
          icon = normalizeTrayIcon(fromFile, 16);
          console.log(`[tray] Using tray icon from file: ${p}`);
          break;
        } else {
          console.warn(`[tray] Tray icon exists but could not be loaded (empty image): ${p}`);
        }
      } catch (innerErr) {
        console.warn(`[tray] Failed to load tray icon from: ${p}`, innerErr);
      }
    }
  } catch (e) {
    console.warn('[tray] Failed while selecting tray icon file:', e);
  }

  // 2) Fallback: generate a simple visible icon
  if (icon.isEmpty()) {
    try {
      // Build directly at tray-size so it fills the tray "square" as much as possible.
      // Windows tray is typically 16x16 logical pixels.
      const w = 16;
      const h = 16;

      // Match app vibe: purple gradient background + big clapperboard.
      const bgA = [0x8b, 0x5c, 0xf6, 0xff]; // #8b5cf6
      const bgB = [0x63, 0x66, 0xf1, 0xff]; // #6366f1
      const ink = [0x11, 0x18, 0x27, 0xff]; // #111827
      const stripe = [0xe5, 0xe7, 0xeb, 0xff]; // #e5e7eb
      const inner = [0x1f, 0x29, 0x37, 0xff]; // #1f2937

      const lerp = (a, b, t) => Math.round(a + (b - a) * t);
      const lerpColor = (c1, c2, t) => [
        lerp(c1[0], c2[0], t),
        lerp(c1[1], c2[1], t),
        lerp(c1[2], c2[2], t),
        0xff,
      ];

      const png = buildPngRgba(w, h, (x, y) => {
        // Background gradient across full square (no transparency)
        const t = (x + y) / (w + h - 2);
        const bg = lerpColor(bgA, bgB, t);

        // Big clapperboard centered
        // Top clap: rows 2-5, Body: rows 6-13
        const left = 2;
        const right = 13;
        const topY0 = 2;
        const topY1 = 5;
        const sepY = 6;
        const bodyY0 = 7;
        const bodyY1 = 13;

        const inX = x >= left && x <= right;
        const inTop = inX && y >= topY0 && y <= topY1;
        const inSep = inX && y === sepY;
        const inBody = inX && y >= bodyY0 && y <= bodyY1;

        if (inSep) return ink;

        if (inTop) {
          const sx = x - left;
          const sy = y - topY0;
          // diagonal-ish stripes
          const band = (sx + sy * 2) % 6;
          return band < 3 ? stripe : ink;
        }

        if (inBody) {
          // Rounded-ish corners by skipping pixels
          const corner = (y === bodyY1 && (x === left || x === right)) || (y === bodyY1 - 1 && (x === left || x === right));
          if (corner) return bg;

          const innerRect = x >= left + 2 && x <= right - 2 && y >= bodyY0 + 2 && y <= bodyY1 - 2;
          return innerRect ? inner : ink;
        }

        return bg;
      });
      icon = nativeImage.createFromBuffer(png);
    } catch (e) {
      console.warn('[tray] Failed to create fallback tray icon PNG:', e);
      icon = nativeImage.createEmpty();
    }
  }

  // At this point we already normalize to 16x16 for file icons and build fallback at 16x16.

  tray = new Tray(icon);
  tray.setToolTip('ClipCast - Scheduled jobs running in background');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Assist Center',
      click: () => {
        toggleAssistCenter();
      },
    },
    {
      label: 'Open ClipCast',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow().then((win) => {
            mainWindow = win;
            setAutoUploadWindowFn?.(mainWindow);
            setYouTubeWindowFn?.(mainWindow);
          });
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Left-click to toggle Assist Center
  tray.on('click', () => {
    toggleAssistCenter();
  });
  
  // Double-click to open main window
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow().then((win) => {
        mainWindow = win;
        setAutoUploadWindowFn?.(mainWindow);
        setYouTubeWindowFn?.(mainWindow);
      });
    }
  });
  
  console.log('[tray] Tray icon created');
}

async function createAssistCenterWindow() {
  if (assistCenterWindow) {
    assistCenterWindow.show();
    assistCenterWindow.focus();
    try {
      assistCenterWindow.webContents?.send('assistcenter:refresh');
    } catch {
      // ignore
    }
    return assistCenterWindow;
  }

  const preloadPath = path.join(__dirname, 'preload.cjs');
  const win = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const assistCenterUrl = `${devUrl}/#/assist-center`;

  if (!app.isPackaged) {
    try {
      await win.loadURL(assistCenterUrl);
    } catch (err) {
      await win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<h2>Dev server not reachable</h2>
             <p>Tried: <b>${assistCenterUrl}</b></p>
             <p>Run: <code>npm run dev</code></p>`
          )
      );
    }
  } else {
    win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { hash: 'assist-center' });
  }

  win.webContents.on('did-finish-load', () => {
    try {
      win.webContents.send('assistcenter:refresh');
    } catch {
      // ignore
    }
  });

  win.on('closed', () => {
    assistCenterWindow = null;
    console.log('[assist-center] Window closed');
  });

  assistCenterWindow = win;
  console.log('[assist-center] Window created');
  return win;
}

function positionAssistOverlayWindow(win) {
  try {
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    const bounds = win.getBounds();
    const pad = 8;
    const nextX = Math.max(x, x + width - bounds.width - pad);
    const nextY = Math.max(y, y + Math.round((height - bounds.height) / 2));
    win.setPosition(nextX, nextY, false);
  } catch {
    // ignore
  }
}

async function createAssistOverlayWindow() {
  if (assistOverlayWindow) {
    return assistOverlayWindow;
  }

  const preloadPath = path.join(__dirname, 'preload.cjs');
  const win = new BrowserWindow({
    width: 120,
    height: 120,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Allow the overlay window to receive mouse clicks reliably in all environments.
    // We keep it small, always-on-top and frameless, but it must be focusable for click handling.
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionAssistOverlayWindow(win);

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const overlayUrl = `${devUrl}/#/assist-overlay`;

  if (!app.isPackaged) {
    try {
      await win.loadURL(overlayUrl);
    } catch (err) {
      await win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<h2>Dev server not reachable</h2>
             <p>Tried: <b>${overlayUrl}</b></p>
             <p>Run: <code>npm run dev</code></p>`
          )
      );
    }
  } else {
    win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { hash: 'assist-overlay' });
  }

  win.on('closed', () => {
    assistOverlayWindow = null;
    console.log('[assist-overlay] Window closed');
  });

  assistOverlayWindow = win;
  win.hide();
  console.log('[assist-overlay] Window created');
  return win;
}

function toggleAssistCenter() {
  if (assistCenterWindow) {
    if (assistCenterWindow.isVisible()) {
      assistCenterWindow.hide();
      console.log('[assist-center] Window hidden');
    } else {
      assistCenterWindow.show();
      assistCenterWindow.focus();
      console.log('[assist-center] Window shown');
      try {
        assistCenterWindow.webContents?.send('assistcenter:refresh');
      } catch {
        // ignore
      }
    }
  } else {
    createAssistCenterWindow();
  }
}

app.on('window-all-closed', (event) => {
  void cancelAllPipelineRuns('window-closed');
  // On Windows/Linux, keep app running in system tray for scheduled jobs
  if (process.platform !== 'darwin') {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    if (!tray) {
      createTray();
    }
  } else {
    // On macOS, quit normally
    app.quit();
  }
});

// ---------- dialogs (legacy) ----------
ipcMain.handle('dialog:openFiles', async () => {
  // E2E_TEST mode: return fake files instead of opening dialog
  if (process.env.E2E_TEST === '1') {
    // Generate 30 fake files for pagination testing (need at least 26 for pagination with 25 rows per page)
    const fakeFiles = [];
    for (let i = 1; i <= 30; i++) {
      fakeFiles.push(path.join(APP_ROOT, 'e2e', 'test-videos', `video${i}.mp4`));
    }
    return fakeFiles;
  }
  const res = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return res.canceled ? '' : res.filePaths[0];
});

// ---------- scan folder for videos ----------
ipcMain.handle('fs:scanVideos', async (_evt, folder) => {
  try {
    if (!folder) return [];
    return await collectVideoFiles(folder);
  } catch (e) {
    console.error('[fs:scanVideos] failed:', e);
    return [];
  }
});

// fs:getFileStats is now registered in initIpcHandlers() above

// ---------- ONE picker: file OR folder (recommended) ----------
ipcMain.handle('dialog:pickVideos', async () => {
  // E2E_TEST mode: return fake files instead of opening dialog
  if (process.env.E2E_TEST === '1') {
    // Generate 30 fake files for pagination testing (need at least 26 for pagination with 25 rows per page)
    const fakeFiles = [];
    for (let i = 1; i <= 30; i++) {
      fakeFiles.push(path.join(APP_ROOT, 'e2e', 'test-videos', `video${i}.mp4`));
    }
    return fakeFiles;
  }
  
  const choice = await dialog.showMessageBox({
    type: 'question',
    message: 'Add videos',
    detail: 'Select video files OR select a folder (we will scan it for videos).',
    buttons: ['Files', 'Folder', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });

  if (choice.response === 2) return [];

  if (choice.response === 0) {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
    });
    return res.canceled ? [] : res.filePaths;
  }

  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths?.[0]) return [];
  return await collectVideoFiles(res.filePaths[0]);
});

// ---------- pipeline runner ----------
ipcMain.handle('pipeline:runPipeline', async (_event, payload) => {
  const runId = formatRunId();
  const send = (line) => {
    try {
      mainWindow?.webContents.send('pipeline:log', { runId, line });
    } catch {
      // ignore
    }
  };
  const fileDoneMarker = 'PIPELINE_FILE_DONE|';
  let stdoutBuffer = '';
  const emitFileDone = (line) => {
    if (!line || typeof line !== 'string') return;
    const markerIndex = line.indexOf(fileDoneMarker);
    if (markerIndex === -1) return;
    const raw = line.slice(markerIndex + fileDoneMarker.length);
    const parts = raw.split('|');
    const action = (parts[0] || '').trim();
    const filePath = parts.slice(1).join('|').trim();
    if (!filePath) return;
    const status = action === 'ERROR' ? 'Error' : 'Done';
    try {
      mainWindow?.webContents.send('pipeline:fileDone', {
        runId,
        filePath,
        status,
        action,
        at: Date.now(),
      });
    } catch {
      // ignore
    }
  };

  // E2E_TEST mode: fake pipeline execution (don't run Python)
  if (process.env.E2E_TEST === '1') {
    const e2eWrite = (level, msg, keys) => send(formatTechLog(level, 'pipeline', msg, keys) + '\n');
    e2eWrite('INFO', 'E2E fake pipeline execution', {});
    e2eWrite('INFO', `E2E processing ${payload?.paths?.length || 0} files`, { count: payload?.paths?.length || 0 });
    if (Array.isArray(payload?.paths)) {
      payload.paths.forEach((filePath, index) => {
        setTimeout(() => {
          try {
            mainWindow?.webContents.send('pipeline:fileDone', {
              runId,
              filePath,
              status: 'Done',
              action: 'E2E_TEST',
              at: Date.now(),
            });
          } catch {
            // ignore
          }
        }, 50 * (index + 1));
      });
    }
    // Simulate success after a short delay
    setTimeout(() => {
      e2eWrite('INFO', 'E2E pipeline completed (fake)', {});
    }, 100);
    return { ok: true, runId };
  }

  const mode = payload?.mode ?? 'files'; // 'files' | 'folder'
  const rawPaths = payload?.paths ?? payload?.files ?? [];
  const paths = Array.isArray(rawPaths) ? rawPaths.filter(Boolean) : [];
  const variant = payload?.variant ?? '';
  const platforms = payload?.platforms; // Optional array of platforms to generate for

  const pipelineDir = getPipelineDir();
  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'yt_pipeline', 'run_pipeline.py')
    : path.join(pipelineDir, 'run_pipeline.py');

  const outputsDir = getOutputsBaseDir();
  const reportsDir = getOutputsSubdir('Reports');
  const lastLogPath = path.join(reportsDir, 'last_run.log');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const payloadAccessToken = typeof payload?.auth?.accessToken === 'string' ? payload.auth.accessToken : '';
  const payloadFunctionsUrl = typeof payload?.auth?.functionsUrl === 'string' ? payload.auth.functionsUrl : '';
  const effectiveAccessToken = payloadAccessToken || supabaseAccessToken;
  const derivedFunctionsUrl = effectiveAccessToken ? deriveSupabaseFunctionsUrl(effectiveAccessToken) : '';
  const supabaseFunctionsUrl = payloadFunctionsUrl
    || supabaseFunctionsUrlOverride
    || derivedFunctionsUrl
    || process.env.SUPABASE_FUNCTIONS_URL
    || (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1` : '');

  rotateRunLog(reportsDir, runId);

  const writeLine = (line) => {
    const chunk = line.endsWith('\n') ? line : line + '\n';
    try {
      fs.appendFileSync(lastLogPath, chunk, 'utf8');
    } catch {
      // ignore
    }
    send(chunk);
  };

  const log = (level, component, message, keys) => {
    writeLine(formatTechLog(level, component, message, keys));
  };

  const developerOpts = getDeveloperOptions();
  const pref = developerOpts.computeBackendPreference || 'auto';
  const debugMode = Boolean(developerOpts.debugMode);
  let computeInfo = null;
  let effectiveDevice = 'cpu';
  let fallbackReason = null;
  if (pref === 'force_cpu') {
    log('INFO', 'compute', 'Force CPU selected; skipping GPU probe', {});
    effectiveDevice = 'cpu';
  } else {
    try {
      computeInfo = await getComputeBackend({ forceRefresh: true, log, source: 'pipeline' });
    } catch (e) {
      computeInfo = null;
      fallbackReason = String(e);
    }
    const availableGpu = Boolean(computeInfo && computeInfo.availableGpu);
    const nvidiaPresent = Boolean(computeInfo && computeInfo.details && computeInfo.details.nvidia_present);
    if (availableGpu) {
      effectiveDevice = 'cuda';
    } else {
      effectiveDevice = 'cpu';
      if (nvidiaPresent) {
        fallbackReason = (computeInfo?.details?.cuda_smoke?.reason || computeInfo?.error || 'cuda_unavailable');
      } else {
        fallbackReason = fallbackReason || 'no_nvidia_gpu';
      }
    }
  }
  const whisperComputeType =
    effectiveDevice === 'cuda'
      ? process.env.WHISPER_COMPUTE_TYPE || 'float16'
      : process.env.WHISPER_COMPUTE_TYPE || 'int8';

  log('INFO', 'pipeline', 'Compute backend resolved', {
    preference: pref,
    availableGpu: effectiveDevice === 'cuda',
    effectiveDevice,
    fallbackReason: fallbackReason || undefined,
  });
  if (fallbackReason) {
    log('WARN', 'pipeline', 'Compute backend fallback', { preference: pref, reason: fallbackReason });
    if (pref === 'prefer_gpu') {
      log('ERROR', 'compute', 'GPU requested but unavailable; falling back to CPU', { reason: fallbackReason });
    }
  }

  const appVersion = app?.getVersion?.() || '0.0.0';
  log('INFO', 'pipeline', 'Run started', {
    runId,
    outputsDir,
    appVersion,
    platform: process.platform || 'unknown',
  });

  if (!fs.existsSync(script)) {
    log('ERROR', 'pipeline', 'Step failed', { step: 'init', err: 'pipeline script not found', script });
    if (app.isPackaged && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Pipeline script missing',
        message: 'run_pipeline.py was not found in the installation.',
        detail: `Expected: ${script}. Reinstall ClipCast or restore app.asar.unpacked.`,
      }).catch(() => {});
    }
    return { runId, code: 2 };
  }

  let python;
  try {
    python = getPipelinePythonPath();
  } catch (e) {
    log('ERROR', 'runner', 'Python resolution failed', { err: String(e) });
    writePythonDiagnosticsLog({ step: 'resolve', error: String(e), resourcesPath: process.resourcesPath });
    if (app.isPackaged && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Python runtime not found',
        message: 'ClipCast could not find its bundled Python runtime.',
        detail: String(e),
      }).catch(() => {});
    }
    return { runId, code: 2 };
  }

  if (!python) {
    log('ERROR', 'runner', 'No Python path (packaged build)');
    return { runId, code: 2 };
  }

  log('INFO', 'runner', 'Using Python for pipeline', { python });
  log('INFO', 'compute', 'Pipeline python executable', { python });

  const smokeResult = await runPythonSmokeTest(python);
  if (!smokeResult.ok) {
    const diag = {
      step: 'smoke_test',
      pythonExe: python,
      error: smokeResult.error,
      code: smokeResult.code,
      stdout: smokeResult.stdout || '',
      stderr: smokeResult.stderr || '',
      resourcesPath: process.resourcesPath,
      scriptExists: fileExists(script),
      processArch: process.arch,
      processVersions: process.versions,
    };
    writePythonDiagnosticsLog(diag);
    log('ERROR', 'runner', 'Python smoke test failed', { error: smokeResult.error });
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Python runtime could not start',
        message: 'ClipCast could not start its bundled Python runtime. This is often caused by antivirus or Windows Defender blocking child processes. Please add ClipCast to exclusions or reinstall.',
        detail: `Path: ${python}\nError: ${smokeResult.error}`,
      }).catch(() => {});
    }
    return { runId, code: 1, error: smokeResult.error };
  }

  const { ffmpeg, ffprobe } = getBundledFfmpegPaths();
  const ffmpegPath = ffmpeg && fs.existsSync(ffmpeg) ? ffmpeg : '';
  const ffprobePath = ffprobe && fs.existsSync(ffprobe) ? ffprobe : '';

  const scriptArgs = (mode === 'folder'
    ? ['--folder', paths[0] || '', '--variant', variant]
    : ['--files', ...paths, '--variant', variant])
    .concat(
      platforms && Array.isArray(platforms) && platforms.length > 0 ? ['--platforms', ...platforms] : [],
      ['--device', effectiveDevice]
    );

  const pipelineEnv = buildPythonEnv(python, {
    KMP_DUPLICATE_LIB_OK: 'TRUE',
    APP_USER_DATA: app.getPath('userData'),
    ...(effectiveAccessToken ? { SUPABASE_ACCESS_TOKEN: effectiveAccessToken } : {}),
    ...(supabaseFunctionsUrl ? { SUPABASE_FUNCTIONS_URL: supabaseFunctionsUrl } : {}),
    ...(supabaseUrl ? { SUPABASE_URL: supabaseUrl } : {}),
    OUTPUTS_DIR: outputsDir,
    WHISPER_DEVICE: effectiveDevice,
    WHISPER_COMPUTE_TYPE: whisperComputeType,
    ...(ffmpegPath ? { FFMPEG_PATH: ffmpegPath } : {}),
    ...(ffprobePath ? { FFPROBE_PATH: ffprobePath } : {}),
  });

  const workingDir = path.dirname(script);
  log('INFO', 'runner', 'Spawning pipeline (no shell)', { python, script, cwd: workingDir });

  return await new Promise((resolve) => {
    const child = spawnPipelineProcess({
      pythonExe: python,
      runPipelinePy: script,
      args: scriptArgs,
      cwd: workingDir,
      env: pipelineEnv,
      onStdout(s) {
        stdoutBuffer += s;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.replace(/\r/g, '').trim();
          if (trimmed) {
            writeLine(formatTechLog('INFO', 'pipeline', trimmed, {}));
          }
          emitFileDone(line);
        }
      },
      onStderr(s) {
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.replace(/\r/g, '').trim();
          if (!trimmed) continue;
          if (debugMode) {
            writeLine(formatTechLog('WARN', 'pipeline', trimmed, { stream: 'stderr' }));
            continue;
          }
          const classified = classifyPipelineStderrLine(line);
          if (!classified) continue;
          writeLine(formatTechLog(classified.level, 'pipeline', classified.line, {}));
        }
      },
    });

    registerPipelineRun(runId, child, { logLine: writeLine });

    child.on('error', (err) => {
      const code = (err && err.code) || '';
      const isEnoent = String(code) === 'ENOENT';
      const isEperm = String(code) === 'EPERM';
      const scriptExists = fileExists(script);
      const enoentDiag = {
        pythonExe: python,
        cwd: workingDir,
        scriptPath: script,
        scriptExists,
        processArch: process.arch,
        processVersions: process.versions,
        err: String(err),
        code: code || undefined,
      };
      log('ERROR', 'pipeline', 'Step failed', {
        step: 'spawn',
        err: String(err),
        code: code || undefined,
      });
      if (isEnoent || isEperm) {
        writePythonDiagnosticsLog(enoentDiag);
      }
      if (err && err.stack) {
        log('ERROR', 'pipeline', 'Stack', { trace: trimStack(err.stack) });
      }
      if ((isEnoent || isEperm) && app.isPackaged) {
        log('ERROR', 'runner', 'Failed to spawn pipeline process. This can be caused by security software blocking child processes from ClipCast.', {
          python,
          scriptExists,
        });
        log('ERROR', 'runner', 'If this persists, add ClipCast to AV/Defender exclusions or reinstall the app.', {});
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Python runtime blocked',
            message: 'ClipCast could not start its bundled Python runtime. This is often caused by antivirus or Windows Defender blocking child processes. Please add ClipCast to exclusions or reinstall.',
            detail: `Path: ${python}\n\nCheck Windows Security → Protection history (Blocked), Controlled folder access, and ASR rules.`,
          }).catch(() => {});
        }
      } else if (isEnoent) {
        log('WARN', 'runner', 'Python not found; set PYTHON_PATH or developerOptions.pythonPath to full path', {});
      }
      finalizePipelineRun(runId);
      resolve({ runId, code: 1, error: String(err) });
    });

    child.on('close', (code) => {
      const finalize = async () => {
        if (stdoutBuffer) {
          const trimmed = stdoutBuffer.replace(/\r/g, '').trim();
          if (trimmed) writeLine(formatTechLog('INFO', 'pipeline', trimmed, {}));
          emitFileDone(stdoutBuffer);
          stdoutBuffer = '';
        }
        const entry = activePipelineRuns.get(runId);
        if (entry?.canceled) {
          log('WARN', 'pipeline', 'Run cancelled', { code, reason: entry.cancelReason || 'manual' });
        } else {
          log('INFO', 'pipeline', 'Run finished', { code });
        }
        finalizePipelineRun(runId);

        runCleanupOutputArtifactsIfEnabled({
          logLine: (line) => writeLine(formatTechLog('INFO', 'cleanup', line, {})),
        });

        resolve({ runId, code, canceled: Boolean(entry?.canceled) });
      };
      void finalize();
    });
  });
});

ipcMain.handle('pipeline:cancel', async (_event, payload) => {
  const runId = typeof payload?.runId === 'string' ? payload.runId : '';
  const reason = typeof payload?.reason === 'string' ? payload.reason : 'manual';
  if (runId) {
    return await cancelPipelineRun(runId, reason);
  }
  return await cancelAllPipelineRuns(reason);
});

// ---------- outputs reader (for Details) ----------
const STEM_HASH_LENGTH = 8;

function normalizePathForStem(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string') return '';
    const resolved = path.resolve(filePath);
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    return normalized.replace(/\\/g, '/');
  } catch {
    return '';
  }
}

function hashPathForStem(filePath) {
  const normalized = normalizePathForStem(filePath);
  if (!normalized) return '00000000';
  return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, STEM_HASH_LENGTH);
}

function stemFromFilePath(filePath, options = {}) {
  const { legacy = false } = options || {};
  const base = path.basename(filePath || '');
  const ext = path.extname(base);
  let stem = ext ? base.slice(0, -ext.length) : base;

  // Normalize to match Python's safe_stem function
  // Replace characters that are not word chars, hyphens, dots, parens, brackets, spaces, or apostrophes with underscore
  stem = stem.replace(/[^\w\-\.\(\)\[\]\s']/g, '_');
  // Normalize multiple spaces to single space
  stem = stem.replace(/\s+/g, ' ').trim();
  // Remove leading/trailing dots and spaces
  stem = stem.replace(/^[\s\.]+|[\s\.]+$/g, '');

  const safeStem = stem || 'video';
  if (legacy) return safeStem;

  const hash = hashPathForStem(filePath);
  return `${safeStem}__${hash}`;
}

function readMetadataForStem({ filePath, outputsDir, stem }) {
  const metaPath = path.join(outputsDir, 'Metadata', `${stem}.json`);
  const metadata = readJsonIfExists(metaPath);
  if (!metadata) {
    return { stem, metaPath, metadata: null, collision: false };
  }
  const requested = normalizePathForCompare(filePath);
  const source = normalizePathForCompare(metadata?.source_video);
  const collision = Boolean(requested && source && requested !== source);
  return { stem, metaPath, metadata: collision ? null : metadata, collision };
}

function resolveMetadataForPath({ filePath, outputsDir }) {
  const primaryStem = stemFromFilePath(filePath);
  const legacyStem = stemFromFilePath(filePath, { legacy: true });
  const primary = readMetadataForStem({ filePath, outputsDir, stem: primaryStem });
  if (primary.metadata) {
    return { ...primary, usedLegacy: false, legacyStem };
  }
  const legacy = readMetadataForStem({ filePath, outputsDir, stem: legacyStem });
  if (legacy.metadata) {
    return { ...legacy, usedLegacy: true, legacyStem };
  }
  return {
    stem: primaryStem,
    metaPath: primary.metaPath,
    metadata: null,
    collision: primary.collision || legacy.collision,
    usedLegacy: false,
    legacyStem,
  };
}

function readTextIfExists(p) {
  try {
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;
const HASHTAG_TOKEN_RE = /#([^\s#]+)/gu;
const INVALID_HASHTAG_CHARS_RE = /[^\p{L}\p{N}\p{M}_]+/gu;
const SHORT_CODE_RE = /^[A-Za-z]{1,3}\d{0,3}$/;
const NUMERIC_ONLY_RE = /^\d+$/;
const AMBIGUOUS_ALNUM_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{1,5}$/;

function isAmbiguousShortTag(token) {
  const t = String(token || '').trim();
  if (!t) return true;
  if (NUMERIC_ONLY_RE.test(t)) return true;
  if (SHORT_CODE_RE.test(t)) return true;
  if (AMBIGUOUS_ALNUM_RE.test(t)) return true;
  return false;
}

function extractHashtagTokens(token) {
  let raw = String(token ?? '').replace(ZERO_WIDTH_RE, '').trim();
  if (!raw) return [];
  raw = raw.replace(/[＃﹟]/g, '#').replace(/％/g, '%');
  const candidates = raw.includes('#')
    ? Array.from(raw.matchAll(HASHTAG_TOKEN_RE), (match) => match[1])
    : [raw];
  const cleaned = [];
  for (const candidate of candidates) {
    const v = String(candidate || '').replace(INVALID_HASHTAG_CHARS_RE, '');
    if (!v) continue;
    if (isAmbiguousShortTag(v)) continue;
    cleaned.push(`#${v}`);
  }
  return cleaned;
}

function normalizeHashtagsInput(hashtags) {
  let tokens = [];
  if (!hashtags) return [];
  if (typeof hashtags === 'string') {
    tokens = hashtags.split(/[,\s]+/).filter(tag => tag.trim());
  } else if (Array.isArray(hashtags)) {
    tokens = hashtags.map(tag => (typeof tag === 'string' ? tag : String(tag)));
  } else {
    tokens = [String(hashtags)];
  }

  const cleaned = [];
  for (const token of tokens) {
    cleaned.push(...extractHashtagTokens(token));
  }

  const seen = new Set();
  const uniq = [];
  for (const tag of cleaned) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(tag);
  }
  return uniq;
}

function updatePlatformMetadataFiles({ filePath, platform, title, description, hashtags }) {
  const outputsDir = getOutputsBaseDir();
  const resolved = resolveMetadataForPath({ filePath, outputsDir });
  const stem = resolved.stem;

  const platformMap = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
  };
  const platformFolder = platformMap[platform];
  if (!platformFolder) {
    return { ok: false, error: 'invalid platform' };
  }

  const normalizedHashtags = normalizeHashtagsInput(hashtags);

  const metaPath = resolved.metaPath;
  let metadata = resolved.metadata;

  if (!metadata) {
    metadata = {
      source_video: filePath,
      platforms: {},
    };
  }

  if (!metadata.platforms) {
    metadata.platforms = {};
  }
  if (!metadata.source_video) {
    metadata.source_video = filePath;
  }

  metadata.platforms[platform] = {
    title: (title || '').trim(),
    description: (description || '').trim(),
    hashtags: normalizedHashtags,
  };

  try {
    safeMkdir(path.dirname(metaPath));
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (e) {
    return { ok: false, error: `Failed to update metadata JSON: ${String(e)}` };
  }

  const platformDir = path.join(outputsDir, 'Exports', platformFolder);
  safeMkdir(platformDir);

  const titlePath = path.join(platformDir, `${stem}.title.txt`);
  const descPath = path.join(platformDir, `${stem}.description.txt`);
  const tagsPath = path.join(platformDir, `${stem}.hashtags.txt`);
  const jsonPath = path.join(platformDir, `${stem}.json`);

  try {
    fs.writeFileSync(titlePath, (title || '').trim(), 'utf-8');
    fs.writeFileSync(descPath, (description || '').trim(), 'utf-8');
    fs.writeFileSync(tagsPath, normalizedHashtags.join(' '), 'utf-8');

    const exportJson = {
      platform: platform.toLowerCase(),
      source_video: metadata.source_video || filePath,
      variant_type: metadata.variant_type || null,
      include_speaker_name: metadata.include_speaker_name || false,
      generated_at: metadata.generated_at || new Date().toISOString(),
      title: (title || '').trim(),
      description: (description || '').trim(),
      hashtags: normalizedHashtags,
      openai_model: metadata.openai_model || null,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(exportJson, null, 2), 'utf-8');
  } catch (e) {
    return { ok: false, error: `Failed to update export files: ${String(e)}` };
  }

  return { ok: true, stem, platform };
}

function resolvePlatformValue(map, platform) {
  if (!map || typeof map !== 'object') return '';
  const specific = map[platform];
  if (typeof specific === 'string') return specific;
  const fallback = map.all;
  return typeof fallback === 'string' ? fallback : '';
}

function mergePlatformText(base, override) {
  const parts = [];
  if (typeof base === 'string' && base.trim()) parts.push(base.trim());
  if (typeof override === 'string' && override.trim()) parts.push(override.trim());
  return parts.join('\n\n').trim();
}

function resolveMergedPlatformValue(map, platform) {
  if (!map || typeof map !== 'object') return '';
  const base = typeof map.all === 'string' ? map.all : '';
  const override = typeof map[platform] === 'string' ? map[platform] : '';
  return mergePlatformText(base, override);
}

function normalizeHashtagString(value) {
  if (!value) return '';
  return normalizeHashtagsInput(value).join(' ');
}

function applyDescriptionTemplate({ template, title, description, hashtags, cta, links, disclaimer }) {
  const replacements = [
    ['TITLE', title],
    ['DESCRIPTION', description],
    ['HASHTAGS', hashtags],
    ['CTA', cta],
    ['LINKS', links],
    ['DISCLAIMER', disclaimer],
  ];

  let result = template || DEFAULT_DESCRIPTION_TEMPLATE;
  for (const [key, value] of replacements) {
    let safeValue = typeof value === 'string' ? value : '';
    if (key === 'HASHTAGS') {
      safeValue = normalizeHashtagString(safeValue);
    }
    if (['CTA', 'LINKS', 'DISCLAIMER', 'HASHTAGS'].includes(key)) {
      if (safeValue) {
        result = result.replace(new RegExp(`\\{${key}\\}`), safeValue);
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), '');
      } else {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), '');
      }
    } else {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
    }
  }

  result = result.replace(/\{[A-Z_]+\}/g, '');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

function hasAnyCustomAiContent(settings) {
  const hasAnyValue = (map) =>
    map && Object.values(map).some((v) => typeof v === 'string' && v.trim());
  return (
    hasAnyValue(settings?.descriptionTemplate) ||
    hasAnyValue(settings?.blocks?.cta) ||
    hasAnyValue(settings?.blocks?.links) ||
    hasAnyValue(settings?.blocks?.disclaimer)
  );
}

async function applyCustomAiPresetToOutputs({ paths, platforms }) {
  const settings = loadMetadataSettings();
  const instructionsMap = settings?.customInstructions || createEmptyPlatformMap();
  const templateMap = settings?.descriptionTemplate || createEmptyPlatformMap();
  const blocks = settings?.blocks || createEmptyCustomAiBlocks();
  const hasAnyValue = (map) =>
    map && Object.values(map).some((v) => typeof v === 'string' && v.trim());
  const safeLen = (s) => (typeof s === 'string' ? s.trim().length : 0);
  const blockCount = [
    hasAnyValue(blocks?.cta),
    hasAnyValue(blocks?.links),
    hasAnyValue(blocks?.disclaimer),
  ].filter(Boolean).length;
  console.log(
    `[customAI] Preset selected | presetId= presetName= lang= blocks=${blockCount}`
  );
  const allLen = safeLen(instructionsMap.all);
  const ytLen = safeLen(instructionsMap.youtube);
  const igLen = safeLen(instructionsMap.instagram);
  const ttLen = safeLen(instructionsMap.tiktok);
  const templateLen = safeLen(templateMap.all) + safeLen(templateMap.youtube) + safeLen(templateMap.instagram) + safeLen(templateMap.tiktok);
  console.log(
    `[customAI] Plan summary   | exports ytLen=${ytLen} igLen=${igLen} ttLen=${ttLen} templateLen=${templateLen}`
  );
  if (!hasAnyCustomAiContent(settings)) {
    return { ok: false, applied: false, updatedFiles: 0, reason: 'no-active-settings' };
  }

  const requestedPlatforms = Array.isArray(platforms) && platforms.length > 0
    ? platforms.filter((p) => ['youtube', 'instagram', 'tiktok'].includes(p))
    : ['youtube', 'instagram', 'tiktok'];

  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, applied: false, updatedFiles: 0, reason: 'no-paths' };
  }

  const outputsDir = getOutputsBaseDir();
  const platformMap = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
  };
  let updatedFiles = 0;

  for (const filePath of paths) {
    const resolved = resolveMetadataForPath({ filePath, outputsDir });
    const stem = resolved.stem;

    for (const platform of requestedPlatforms) {
      const platformFolder = platformMap[platform];
      if (!platformFolder) continue;
      const platformDir = path.join(outputsDir, 'Exports', platformFolder);
      const titlePath = path.join(platformDir, `${stem}.title.txt`);
      const descPath = path.join(platformDir, `${stem}.description.txt`);
      const tagsPath = path.join(platformDir, `${stem}.hashtags.txt`);

      const baseTitle = readTextIfExists(titlePath).trim();
      const baseDescription = readTextIfExists(descPath).trim();
      const baseHashtags = readTextIfExists(tagsPath).trim();

      const template = resolveMergedPlatformValue(templateMap, platform) || DEFAULT_DESCRIPTION_TEMPLATE;

      const cta = resolveMergedPlatformValue(blocks?.cta, platform);
      const links = resolveMergedPlatformValue(blocks?.links, platform);
      const disclaimer = resolveMergedPlatformValue(blocks?.disclaimer, platform);

      const formattedDescription = applyDescriptionTemplate({
        template,
        title: baseTitle,
        description: baseDescription,
        hashtags: baseHashtags,
        cta,
        links,
        disclaimer,
      });

      if (!fs.existsSync(platformDir)) {
        safeMkdir(platformDir);
      }
      fs.writeFileSync(descPath, formattedDescription, 'utf-8');
      updatedFiles += 1;
    }
  }

  return { ok: true, applied: true, updatedFiles };
}

function normalizePathForCompare(p) {
  return normalizePathForStem(p);
}

ipcMain.handle('outputs:readForPath', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };

    const outputsDir = getOutputsBaseDir();
    const resolved = resolveMetadataForPath({ filePath, outputsDir });
    const stem = resolved.stem;
    const metaPath = resolved.metaPath;
    let metadata = resolved.metadata;

    const readExports = (platformName) => {
      const platformDir = path.join(outputsDir, 'Exports', platformName);
      const titlePath = path.join(platformDir, `${stem}.title.txt`);
      const descPath = path.join(platformDir, `${stem}.description.txt`);
      const tagsPath = path.join(platformDir, `${stem}.hashtags.txt`);
      const jsonPath = path.join(platformDir, `${stem}.json`);
      
      return {
        title: readTextIfExists(titlePath),
        description: readTextIfExists(descPath),
        hashtags: readTextIfExists(tagsPath),
        json: readJsonIfExists(jsonPath),
        dir: platformDir,
      };
    };

    // Check persistent tombstone for deleted metadata
    const deleted = loadDeletedMetadata();
    const deletedPlatforms = deleted[filePath] || {};

    const buildExports = () => {
      const result = {};
      // Only include platforms that are NOT marked as deleted
      if (!deletedPlatforms.youtube) {
        result.youtube = readExports('YouTube');
      } else {
        result.youtube = { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'YouTube') };
      }
      if (!deletedPlatforms.instagram) {
        result.instagram = readExports('Instagram');
      } else {
        result.instagram = { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'Instagram') };
      }
      if (!deletedPlatforms.tiktok) {
        result.tiktok = readExports('TikTok');
      } else {
        result.tiktok = { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'TikTok') };
      }
      return result;
    };

    const exports = metadata ? buildExports() : {
      youtube: { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'YouTube') },
      instagram: { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'Instagram') },
      tiktok: { title: '', description: '', hashtags: '', json: null, dir: path.join(outputsDir, 'Exports', 'TikTok') },
    };

    // Also filter metadata.platforms to exclude deleted platforms
    let filteredMetadata = metadata;
    if (metadata && metadata.platforms && Object.keys(deletedPlatforms).length > 0) {
      filteredMetadata = { ...metadata };
      filteredMetadata.platforms = { ...metadata.platforms };
      Object.keys(deletedPlatforms).forEach((platform) => {
        if (deletedPlatforms[platform]) {
          delete filteredMetadata.platforms[platform];
        }
      });
    }

    return {
      ok: true,
      stem,
      paths: {
        outputsDir,
        metadataPath: metaPath,
      },
      metadata: filteredMetadata,
      exports,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});


// Persistent tombstone for deleted metadata (survives reloads)
const deletedMetadataFile = path.join(app.getPath('userData'), 'deleted_metadata.json');

function loadDeletedMetadata() {
  try {
    if (fs.existsSync(deletedMetadataFile)) {
      const data = fs.readFileSync(deletedMetadataFile, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed || {};
    }
  } catch (e) {
    console.error('[deleteMetadata] Error loading deleted metadata:', e);
  }
  return {};
}

function saveDeletedMetadata(data) {
  try {
    fs.writeFileSync(deletedMetadataFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[deleteMetadata] Error saving deleted metadata:', e);
  }
}

function markMetadataAsDeleted(filePath, platform) {
  const deleted = loadDeletedMetadata();
  if (!deleted[filePath]) {
    deleted[filePath] = {};
  }
  deleted[filePath][platform] = true;
  saveDeletedMetadata(deleted);
}

function unmarkMetadataAsDeleted(filePath, platform) {
  const deleted = loadDeletedMetadata();
  if (deleted[filePath]) {
    delete deleted[filePath][platform];
    if (Object.keys(deleted[filePath]).length === 0) {
      delete deleted[filePath];
    }
    saveDeletedMetadata(deleted);
  }
}

function isMetadataDeleted(filePath, platform) {
  const deleted = loadDeletedMetadata();
  return deleted[filePath] && deleted[filePath][platform] === true;
}

// Delete metadata for a specific platform
ipcMain.handle('outputs:deletePlatform', async (_evt, { filePath, platform }) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };
    if (!platform || !['youtube', 'instagram', 'tiktok'].includes(platform)) {
      return { ok: false, error: 'invalid platform' };
    }

    const outputsDir = getOutputsBaseDir();
    const resolved = resolveMetadataForPath({ filePath, outputsDir });
    const stem = resolved.stem;

    // Map platform names to folder names
    const platformMap = {
      youtube: 'YouTube',
      instagram: 'Instagram',
      tiktok: 'TikTok',
    };
    const platformFolder = platformMap[platform];

    // Delete export files for this platform
    const platformDir = path.join(outputsDir, 'Exports', platformFolder);
    const filesToDelete = [
      path.join(platformDir, `${stem}.title.txt`),
      path.join(platformDir, `${stem}.description.txt`),
      path.join(platformDir, `${stem}.hashtags.txt`),
      path.join(platformDir, `${stem}.json`),
    ];

    for (const filePathToDelete of filesToDelete) {
      try {
        if (fs.existsSync(filePathToDelete)) {
          fs.unlinkSync(filePathToDelete);
        }
      } catch (e) {
        // Continue even if one file fails
      }
    }

    // Update Metadata/{stem}.json to remove platform data
    const metaPath = resolved.metaPath;
    const metadata = resolved.metadata;
    if (metadata && metadata.platforms && metadata.platforms[platform]) {
      delete metadata.platforms[platform];
      // If no platforms left, we could delete the entire metadata file, but let's keep it
      try {
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
      } catch (e) {
        return { ok: false, error: `Failed to update metadata: ${String(e)}` };
      }
    }

    // Mark as deleted in persistent tombstone (survives reloads)
    markMetadataAsDeleted(filePath, platform);

    return { ok: true, stem, platform };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Remove platform from deleted metadata tombstone (when metadata is regenerated)
ipcMain.handle('outputs:unmarkDeleted', async (_evt, { filePath, platform }) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };
    if (!platform || !['youtube', 'instagram', 'tiktok'].includes(platform)) {
      return { ok: false, error: 'invalid platform' };
    }
    unmarkMetadataAsDeleted(filePath, platform);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Update metadata for a specific platform
ipcMain.handle('outputs:updatePlatformMetadata', async (_evt, { filePath, platform, title, description, hashtags }) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };
    if (!platform || !['youtube', 'instagram', 'tiktok'].includes(platform)) {
      return { ok: false, error: 'invalid platform' };
    }
    return updatePlatformMetadataFiles({ filePath, platform, title, description, hashtags });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Backward compatibility: older UI may call exports:readYouTube
ipcMain.handle('exports:readYouTube', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };
    const outputsDir = getOutputsBaseDir();
    const resolved = resolveMetadataForPath({ filePath, outputsDir });
    const stem = resolved.stem;
    const platformDir = path.join(outputsDir, 'Exports', 'YouTube');
    return {
      ok: true,
      stem,
      title: readTextIfExists(path.join(platformDir, `${stem}.title.txt`)),
      description: readTextIfExists(path.join(platformDir, `${stem}.description.txt`)),
      hashtags: readTextIfExists(path.join(platformDir, `${stem}.hashtags.txt`)),
      json: readJsonIfExists(path.join(platformDir, `${stem}.json`)),
      dir: platformDir,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---------- open folders / paths ----------
ipcMain.handle('paths:open', async (_evt, p) => {
  try {
    if (!p || typeof p !== 'string') return { ok: false, error: 'invalid path' };
    const r = await shell.openPath(p);
    return r ? { ok: false, error: r } : { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

const PLATFORM_EXPORT_DIR_NAMES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' };

function getPlatformExportFolder(outputsDir, platform) {
  const dirName = PLATFORM_EXPORT_DIR_NAMES[String(platform || '').toLowerCase()] || 'YouTube';
  return path.join(outputsDir, 'Exports', dirName);
}

/** Returns candidate export file paths for a row (stem) in a platform folder. Order: .json, .title.txt, .description.txt, .hashtags.txt. */
function getExportFilesForRow(outputsDir, platform, filePath) {
  const resolved = resolveMetadataForPath({ filePath, outputsDir });
  const stem = resolved.stem;
  const dir = getPlatformExportFolder(outputsDir, platform);
  const candidates = [
    path.join(dir, `${stem}.json`),
    path.join(dir, `${stem}.title.txt`),
    path.join(dir, `${stem}.description.txt`),
    path.join(dir, `${stem}.hashtags.txt`),
  ];
  const existing = candidates.filter((p) => fs.existsSync(p));
  const primary = existing[0] || candidates[0];
  return { folder: dir, primary, allFiles: existing, hasExport: existing.length > 0 };
}

/**
 * Opens the platform export folder in Explorer (Windows) or Finder (macOS) and selects the 4 metadata files when possible.
 * On Windows: uses PowerShell COM to multi-select; fallback to explorer.exe /select for one file (.json preferred).
 * On macOS: shell.showItemInFolder(primary) (single file only).
 * Uses custom outputsDir from getOutputsBaseDir().
 */
function openExportsInExplorer(outputsDir, platform, filePath) {
  const { folder, primary, allFiles } = getExportFilesForRow(outputsDir, platform, filePath);
  if (allFiles.length === 0) {
    return Promise.resolve(shell.openPath(folder)).then((err) => (err ? { ok: false, error: err, openedFolder: true } : { ok: true, openedFolder: true }));
  }
  if (process.platform === 'win32') {
    const basenames = allFiles.map((p) => path.basename(p));
    const preferJson = allFiles.find((p) => p.toLowerCase().endsWith('.json'));
    const fileForSelect = preferJson || allFiles[0];
    const psScript = [
      'param([string]$folderPath, [string]$fileList)',
      '$files = $fileList -split \';\' | Where-Object { $_ -and (Test-Path (Join-Path $folderPath $_)) }',
      'if ($files.Count -eq 0) {',
      '  Start-Process explorer.exe -ArgumentList "`"$folderPath`""',
      '  exit 0',
      '}',
      'try {',
      '  $shell = New-Object -ComObject Shell.Application',
      '  $folder = $shell.NameSpace($folderPath)',
      '  if (-not $folder) { throw "no folder" }',
      '  $folder.Self.InvokeVerb(\'open\')',
      '  Start-Sleep -Milliseconds 400',
      '  $folderNorm = ($folderPath -replace \'\\\\\', \'/\').ToLower()',
      '  $window = $shell.Windows() | Where-Object { $_.LocationURL.ToLower() -like "*$folderNorm*" } | Select-Object -First 1',
      '  if ($window -and $window.Document) {',
      '    foreach ($f in $files) {',
      '      $item = $folder.ParseName($f)',
      '      if ($item) { try { [void]$window.Document.SelectItem($item, 1) } catch {} }',
      '    }',
      '  } else {',
      '    $firstFull = Join-Path $folderPath $files[0]',
      '    Start-Process explorer.exe -ArgumentList "/select,`"$firstFull`""',
      '  }',
      '} catch {',
      '  $firstFull = Join-Path $folderPath $files[0]',
      '  Start-Process explorer.exe -ArgumentList "/select,`"$firstFull`""',
      '}',
    ].join('\n');
    const scriptPath = path.join(os.tmpdir(), `open-exports-${Date.now()}.ps1`);
    const fileListArg = basenames.join(';');
    try {
      fs.writeFileSync(scriptPath, psScript.trim(), 'utf8');
      return new Promise((resolve) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-folderPath', folder, '-fileList', fileListArg],
          { windowsHide: true }
        );
        const t = setTimeout(() => {
          try { child.kill(); } catch {}
          resolve({ ok: true, openedFolder: false });
        }, 8000);
        child.on('close', (code) => {
          clearTimeout(t);
          resolve({ ok: code === 0, openedFolder: false });
        });
        child.on('error', () => {
          clearTimeout(t);
          try { shell.showItemInFolder(fileForSelect); } catch {}
          resolve({ ok: true, openedFolder: false });
        });
      }).finally(() => {
        try { fs.unlinkSync(scriptPath); } catch {}
      });
    } catch (e) {
      shell.showItemInFolder(fileForSelect);
      return Promise.resolve({ ok: true, openedFolder: false });
    }
  }
  shell.showItemInFolder(primary);
  return Promise.resolve({ ok: true, openedFolder: false });
}

ipcMain.handle('outputs:getExportPathsForRow', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'no filePath' };
    const outputsDir = getOutputsBaseDir();
    const result = {};
    for (const platform of ['youtube', 'instagram', 'tiktok']) {
      result[platform] = getExportFilesForRow(outputsDir, platform, filePath);
    }
    return { ok: true, platforms: result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('outputs:openExportsForPath', async (_evt, { filePath, platform }) => {
  try {
    const outputsDir = getOutputsBaseDir();
    return await openExportsInExplorer(outputsDir, platform, filePath);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('outputs:openRoot', async () => {
  try {
    const outputsDir = getOutputsBaseDir();
    const r = await shell.openPath(outputsDir);
    return r ? { ok: false, error: r } : { ok: true, dir: outputsDir };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ---------- Batch Notification System ----------
function checkAndSendBatchNotification() {
  if (!Notification.isSupported()) {
    console.log('[batch-notification] Notifications not supported');
    return;
  }

  try {
    const jobsFile = path.join(app.getPath('userData'), 'jobs.json');
    if (!fs.existsSync(jobsFile)) {
      return;
    }

    const data = fs.readFileSync(jobsFile, 'utf8');
    const jobs = JSON.parse(data);
    if (!Array.isArray(jobs)) {
      return;
    }

    const now = Date.now();
    const soonMs = 60 * 60 * 1000; // Next 60 minutes
    const toleranceMs = 10 * 60 * 1000; // 10 minutes tolerance

    let instagramCount = 0;
    let tiktokCount = 0;
    let hasDueNow = false;

    for (const job of jobs) {
      if (!job || typeof job.publishAtUtcMs !== 'number') continue;
      if (job.publishAtUtcMs > now + soonMs) continue;

      const targets = job.targets || { youtube: false, instagram: false, tiktok: false };
      const run = job.run || {};

      if (targets.instagram && !run.instagram?.done) {
        if (job.publishAtUtcMs <= now + toleranceMs) {
          hasDueNow = true;
        }
        instagramCount++;
      }
      if (targets.tiktok && !run.tiktok?.done) {
        if (job.publishAtUtcMs <= now + toleranceMs) {
          hasDueNow = true;
        }
        tiktokCount++;
      }
    }

    const total = instagramCount + tiktokCount;

    // Check if we should send notification
    const shouldNotify = 
      total > 0 && (
        // First item becomes due now
        (hasDueNow && (lastNotificationCount.total !== total || 
                       lastNotificationCount.instagram !== instagramCount || 
                       lastNotificationCount.tiktok !== tiktokCount)) ||
        // 60 minutes have passed since last notification
        (now - lastNotificationTime >= 60 * 60 * 1000 && total > 0)
      );

    // Don't spam if count didn't change and Assist Center is already open
    if (shouldNotify && 
        lastNotificationCount.total === total &&
        lastNotificationCount.instagram === instagramCount &&
        lastNotificationCount.tiktok === tiktokCount &&
        assistCenterWindow && 
        assistCenterWindow.isVisible()) {
      console.log('[batch-notification] Skipping notification - count unchanged and Assist Center is open');
      return;
    }

    if (shouldNotify) {
      const platformText = [];
      if (instagramCount > 0) platformText.push(`IG: ${instagramCount}`);
      if (tiktokCount > 0) platformText.push(`TT: ${tiktokCount}`);
      const platformStr = platformText.length > 0 ? ` (${platformText.join(', ')})` : '';

      const notification = new Notification({
        title: 'Manual Assist Jobs Due',
        body: `In the next hour you have ${total} item${total !== 1 ? 's' : ''}${platformStr}. Click to open Assist Center.`,
        tag: 'yt-uploader-batch-notification',
      });

      notification.on('click', () => {
        console.log('[batch-notification] Notification clicked - opening Assist Center');
        toggleAssistCenter();
      });

      notification.show();

      lastNotificationCount = { total, instagram: instagramCount, tiktok: tiktokCount };
      lastNotificationTime = now;

      console.log(`[batch-notification] Sent notification: ${total} items (IG: ${instagramCount}, TT: ${tiktokCount})`);
    }
  } catch (e) {
    console.error('[batch-notification] Error checking jobs:', e);
  }
}

function startBatchNotificationTimer() {
  if (batchNotificationTimer) {
    clearInterval(batchNotificationTimer);
  }

  // Check every 5 minutes
  batchNotificationTimer = setInterval(() => {
    checkAndSendBatchNotification();
  }, 5 * 60 * 1000);

  // Also check immediately on startup (after a short delay to let jobs load)
  setTimeout(() => {
    checkAndSendBatchNotification();
  }, 10000); // 10 seconds after startup

  console.log('[batch-notification] Timer started');
}

function stopBatchNotificationTimer() {
  if (batchNotificationTimer) {
    clearInterval(batchNotificationTimer);
    batchNotificationTimer = null;
    console.log('[batch-notification] Timer stopped');
  }
}

// Clean up on app quit
app.on('before-quit', () => {
  stopBatchNotificationTimer();
  void cancelAllPipelineRuns('app-quit');
});
