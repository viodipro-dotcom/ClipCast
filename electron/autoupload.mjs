import { app, shell, clipboard, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { uploadVideo, isConnected, connect as ytConnect } from './youtube.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root (one level above electron/)
const APP_ROOT = path.join(__dirname, '..');
const PIPELINE_DIR = path.join(APP_ROOT, 'yt_pipeline');
const DEFAULT_OUTPUTS_DIR = path.join(PIPELINE_DIR, 'outputs');
let getOutputsDir = () => DEFAULT_OUTPUTS_DIR;

const USERDATA_DIR = app.getPath('userData');
const JOBS_FILE = path.join(USERDATA_DIR, 'jobs.json');
const SETTINGS_FILE = path.join(USERDATA_DIR, 'autoupload_settings.json');

let mainWindow = null;
let timer = null;
let running = false;
let assistOverlayWindow = null;
let lastAssistOverlayCount = -1;
/** When Silent OFF: we auto-start only the first due job once per "wave" of due jobs. Reset when no due jobs. */
let hasAutoStartedFirstJob = false;
// Store pending notification actions for Windows compatibility
const pendingNotifications = new Map();
// Track when notifications were last re-shown to prevent spam
const lastReShown = new Map();
// Track last time we checked for re-showing on focus
let lastFocusCheck = 0;

function safeReadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function safeWriteJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

function log(line) {
  const msg = String(line);
  try {
    mainWindow?.webContents?.send('pipeline:log', { line: msg, at: Date.now() });
  } catch {
    // ignore
  }
}

function sendStatus(st) {
  try {
    mainWindow?.webContents?.send('autoupload:status', st);
  } catch {
    // ignore
  }
}

function loadSettings() {
  return safeReadJson(SETTINGS_FILE, { enabled: false, pollSeconds: 30 });
}

function saveSettings(s) {
  safeWriteJson(SETTINGS_FILE, s);
}

function normalizeJobs(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.jobs)) return data.jobs;
  return [];
}

function loadJobs() {
  return normalizeJobs(safeReadJson(JOBS_FILE, []));
}

function saveJobs(jobs) {
  safeWriteJson(JOBS_FILE, Array.isArray(jobs) ? jobs : []);
}

function ensureJobId(job) {
  if (job && !job.id) {
    job.id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return job;
}

function getManualAssistDueEntries(jobs, now = Date.now()) {
  const list = Array.isArray(jobs) ? [...jobs] : [];
  list.sort((a, b) => (a?.publishAtUtcMs || 0) - (b?.publishAtUtcMs || 0));

  const entries = [];
  for (const job of list) {
    if (!job || typeof job.publishAtUtcMs !== 'number') continue;
    if (job.publishAtUtcMs > now) continue;

    const targets = job.targets || { youtube: false, instagram: false, tiktok: false };
    const run = job.run || {};

    if (targets.instagram && !run.instagram?.done) {
      entries.push({ job, platform: 'instagram', publishAtUtcMs: job.publishAtUtcMs });
    }
    if (targets.tiktok && !run.tiktok?.done) {
      entries.push({ job, platform: 'tiktok', publishAtUtcMs: job.publishAtUtcMs });
    }
  }
  return entries;
}

function pushAssistOverlayCount(count) {
  const win = assistOverlayWindow;
  if (!win || win.isDestroyed?.()) return;
  try {
    win.webContents?.send('assistoverlay:count', { count });
  } catch {
    // ignore
  }
}

function setAssistOverlayVisible(visible) {
  const win = assistOverlayWindow;
  if (!win || win.isDestroyed?.()) return;
  try {
    if (visible) {
      if (!win.isVisible?.()) {
        if (typeof win.showInactive === 'function') {
          win.showInactive();
        } else {
          win.show();
        }
      }
    } else if (win.isVisible?.()) {
      win.hide();
    }
  } catch {
    // ignore
  }
}

function refreshAssistOverlayStateFromJobs(jobs) {
  const settings = loadSettings();
  if (!settings.enabled) {
    if (lastAssistOverlayCount !== 0) {
      lastAssistOverlayCount = 0;
      pushAssistOverlayCount(0);
    }
    setAssistOverlayVisible(false);
    return 0;
  }

  const count = getManualAssistDueEntries(jobs).length;
  if (count === 0) {
    hasAutoStartedFirstJob = false;
  }
  if (count !== lastAssistOverlayCount) {
    lastAssistOverlayCount = count;
    pushAssistOverlayCount(count);
  }
  setAssistOverlayVisible(count > 0);
  return count;
}

function platformExportDir(platform) {
  const out = getOutputsDir();
  if (platform === 'youtube') return path.join(out, 'Exports', 'YouTube');
  if (platform === 'instagram') return path.join(out, 'Exports', 'Instagram');
  return path.join(out, 'Exports', 'TikTok');
}

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

function stemFromPath(filePath, options = {}) {
  const { legacy = false } = options || {};
  const base = path.basename(filePath || '');
  const ext = path.extname(base);
  let stem = ext ? base.slice(0, -ext.length) : base;
  stem = stem.replace(/[^\w\-\.\(\)\[\]\s']/g, '_');
  stem = stem.replace(/\s+/g, ' ').trim();
  stem = stem.replace(/^[\s\.]+|[\s\.]+$/g, '');
  const safeStem = stem || 'video';
  if (legacy) return safeStem;
  const hash = hashPathForStem(filePath);
  return `${safeStem}__${hash}`;
}

function readMetadataForStem(filePath, stem) {
  try {
    const metaPath = path.join(getOutputsDir(), 'Metadata', `${stem}.json`);
    const metadata = safeReadJson(metaPath, null);
    if (!metadata) return { stem, metadata: null };

    const requested = normalizePathForCompare(filePath);
    const source = normalizePathForCompare(metadata?.source_video);
    if (requested && source && requested !== source) {
      return { stem, metadata: null };
    }
    return { stem, metadata };
  } catch {
    return { stem, metadata: null };
  }
}

function resolveStemForPath(filePath) {
  const primaryStem = stemFromPath(filePath);
  const primary = readMetadataForStem(filePath, primaryStem);
  if (primary.metadata) return primary;
  const legacyStem = stemFromPath(filePath, { legacy: true });
  const legacy = readMetadataForStem(filePath, legacyStem);
  if (legacy.metadata) return legacy;
  return { stem: primaryStem, metadata: null };
}

function readTextIfExists(p) {
  try {
    if (!p) return '';
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function normalizePathForCompare(p) {
  return normalizePathForStem(p);
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

function normalizeHashtagsText(value) {
  if (!value) return '';
  let tokens = [];
  if (Array.isArray(value)) {
    tokens = value.map((t) => String(t));
  } else {
    tokens = String(value).split(/[,\s]+/);
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
  return uniq.join(' ');
}

function readMetadataPlatform(filePath, platform) {
  try {
    const resolved = resolveStemForPath(filePath);
    const metadata = resolved.metadata;
    if (!metadata) return null;

    const platformMeta = metadata?.platforms?.[platform];
    if (!platformMeta) return null;

    let hashtags = platformMeta.hashtags ?? platformMeta.tags ?? '';
    if (Array.isArray(hashtags)) {
      hashtags = hashtags.join('\n');
    }

    return {
      title: typeof platformMeta.title === 'string' ? platformMeta.title : '',
      description: typeof platformMeta.description === 'string' ? platformMeta.description : '',
      hashtags: typeof hashtags === 'string' ? hashtags : '',
    };
  } catch {
    return null;
  }
}

function computeExportFiles(platform, filePath) {
  const stem = resolveStemForPath(filePath).stem;
  const dir = platformExportDir(platform);
  return {
    dir,
    titleFile: path.join(dir, `${stem}.title.txt`),
    descriptionFile: path.join(dir, `${stem}.description.txt`),
    hashtagsFile: path.join(dir, `${stem}.hashtags.txt`),
    jsonFile: path.join(dir, `${stem}.json`),
  };
}

function getPythonCmd() {
  return process.env.YT_UPLOADER_PYTHON || 'python';
}

function spawnPython(args, { cwd } = {}) {
  const cmd = getPythonCmd();
  log(`[auto-upload] cmd: ${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const child = spawn(cmd, args, {
    cwd: cwd || APP_ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });

  child.stdout.on('data', (d) => log(String(d)));
  child.stderr.on('data', (d) => log(String(d)));
  return new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });
}

async function authYouTube() {
  try {
    await ytConnect({ log });
    return 0;
  } catch (e) {
    log(`[auto-upload] YouTube OAuth failed: ${String(e)}`);
    return 1;
  }
}

async function uploadYouTube(job) {
  const ex = computeExportFiles('youtube', job.filePath);
  const title = readTextIfExists(ex.titleFile).trim();
  const desc = readTextIfExists(ex.descriptionFile).trim();
  const tagsRaw = readTextIfExists(ex.hashtagsFile).trim();

  // Fallback to Metadata JSON if Exports files are empty
  const meta = readMetadataPlatform(job.filePath, 'youtube');
  const resolvedTitle = title || meta?.title || path.basename(job.filePath);
  const resolvedDesc = desc || meta?.description || '';
  const resolvedTagsRaw = tagsRaw || meta?.hashtags || '';
  const normalizedTags = normalizeHashtagsText(resolvedTagsRaw);

  // Append hashtags to description on a new line (same logic as manual upload)
  let description = String(resolvedDesc || '').trim();
  if (normalizedTags) {
    if (description) {
      description = description + '\n\n' + normalizedTags;
    } else {
      description = normalizedTags;
    }
  }

  // Log hashtags for debugging
  if (resolvedTagsRaw) {
    log(`[auto-upload] Hashtags found: ${resolvedTagsRaw.substring(0, 100)}${resolvedTagsRaw.length > 100 ? '...' : ''}`);
    log(`[auto-upload] Processed tags: ${normalizedTags.substring(0, 100)}${normalizedTags.length > 100 ? '...' : ''}`);
  } else {
    log(`[auto-upload] No hashtags found in file: ${ex.hashtagsFile}`);
  }

  sendStatus({ id: job.id, platform: 'youtube', status: 'Processing', message: 'Uploading to YouTube...' });
  try {
    if (!await isConnected()) {
      const msg = 'YouTube not connected. Click "Connect YouTube" first.';
      log(`[auto-upload] ${msg}`);
      sendStatus({ id: job.id, platform: 'youtube', status: 'Error', message: msg });
      return { code: 2, videoId: null };
    }

    // Background runner uploads when job is DUE, so we publish immediately (no scheduling).
    // Pass tags to API (snippet.tags) so they appear in YouTube Tags field; description already has them in text.
    const payload = {
      filePath: job.filePath,
      title: resolvedTitle,
      description,
      tags: normalizedTags || '', // Space-separated with #; youtube.mjs parseTags strips # for API
      publishAt: null,
      privacyStatus: job.visibility || 'private',
      selfDeclaredMadeForKids: job.selfDeclaredMadeForKids === true,
    };

    const result = await uploadVideo(payload, { log, appRoot: APP_ROOT });
    const videoId = result?.videoId || null;
    if (videoId) {
      log(`[auto-upload] YouTube upload succeeded. videoId=${videoId}`);
    }

    // Persist posted status in jobs.json for background uploads
    try {
      const jobs = loadJobs();
      let jobIndex = jobs.findIndex((j) => j.id === job.id);
      if (jobIndex === -1) {
        const targetPath = normalizePathForCompare(job.filePath);
        jobIndex = jobs.findIndex((j) => normalizePathForCompare(j.filePath) === targetPath);
      }
      if (jobIndex >= 0) {
        const targetJob = jobs[jobIndex];
        targetJob.run = targetJob.run || {};
        targetJob.run.youtube = {
          done: true,
          at: Date.now(),
          ok: true,
          videoId: videoId || undefined,
        };
        saveJobs(jobs);
        log(`[auto-upload] ? Marked youtube as posted in jobs.json`);
      } else {
        const now = Date.now();
        const newJob = {
          id: job.id || `${now}-${Math.random().toString(36).slice(2)}`,
          filePath: job.filePath,
          publishAtUtcMs: Number.isFinite(job.publishAtUtcMs) ? job.publishAtUtcMs : now,
          targets: job.targets || { youtube: true, instagram: false, tiktok: false },
          visibility: job.visibility || 'private',
          selfDeclaredMadeForKids: job.selfDeclaredMadeForKids === true,
          createdAt: job.createdAt || now,
          run: {
            youtube: {
              done: true,
              at: now,
              ok: true,
              videoId: videoId || undefined,
            },
          },
        };
        jobs.push(newJob);
        saveJobs(jobs);
        log(`[auto-upload] ? Created job and marked youtube as posted in jobs.json`);
      }
    } catch (e) {
      log(`[auto-upload] ??  Error updating jobs.json after upload: ${String(e)}`);
    }

    sendStatus({ id: job.id, platform: 'youtube', status: 'Done', message: videoId ? `Uploaded to YouTube (${videoId})` : 'Uploaded to YouTube' });
    return { code: 0, videoId };
  } catch (e) {
    log(`[auto-upload] YouTube upload failed: ${String(e)}`);
    sendStatus({ id: job.id, platform: 'youtube', status: 'Error', message: 'YouTube upload failed (see log)' });
    return { code: 1, videoId: null };
  }
}

// Helper function to format and copy metadata to clipboard
function copyMetadataToClipboard(platform, filePath) {
  const ex = computeExportFiles(platform, filePath);
  const title = readTextIfExists(ex.titleFile).trim();
  const desc = readTextIfExists(ex.descriptionFile).trim();
  const tagsRaw = readTextIfExists(ex.hashtagsFile).trim();
  const tagsNormalized = normalizeHashtagsText(tagsRaw);

  // Format metadata for easy copy-paste
  // For YouTube: Title + Description + Tags (all in one)
  // For Instagram: Title + Description + Hashtags (all in one)
  // For TikTok: Title + Description + Hashtags (all in one)
  let clipboardText = '';
  if (platform === 'youtube') {
    // YouTube format: Title on first line, then description, then tags
    clipboardText = title;
    if (desc) {
      clipboardText += '\n\n' + desc;
    }
    if (tagsNormalized) {
      clipboardText += '\n\n' + tagsNormalized;
    }
  } else if (platform === 'instagram') {
    // Instagram format: Title on first line, then description, then hashtags
    clipboardText = title;
    if (desc) {
      clipboardText += '\n\n' + desc;
    }
    if (tagsNormalized) {
      clipboardText += '\n\n' + tagsNormalized;
    }
  } else if (platform === 'tiktok') {
    // TikTok format: Title + Description + Hashtags
    clipboardText = title;
    if (desc) {
      clipboardText += '\n\n' + desc;
    }
    if (tagsNormalized) {
      clipboardText += '\n\n' + tagsNormalized;
    }
  } else {
    // Fallback: full format
    clipboardText = [
      `TITLE:\n${title}`,
      '',
      `DESCRIPTION:\n${desc}`,
      '',
      `HASHTAGS:\n${tagsNormalized}`,
    ].join('\n');
  }

  // Copy to clipboard
  try {
    clipboard.writeText(clipboardText);
    log(`[auto-upload] ? Copied ${platform} metadata to clipboard`);
    log(`[auto-upload]    Title: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`);
    return true;
  } catch (e) {
    log(`[auto-upload] ??  Failed to copy to clipboard: ${e}`);
    return false;
  }
}

async function assistNextDueJob() {
  const jobs = loadJobs();
  const entries = getManualAssistDueEntries(jobs, Date.now());
  if (!entries.length) {
    refreshAssistOverlayStateFromJobs(jobs);
    return { ok: false, error: 'No due manual assist jobs' };
  }

  const entry = entries[0];
  const job = ensureJobId(entry.job);
  const platform = entry.platform;
  const alreadyOpened = job.run?.[platform]?.assistOpenedAt != null;

  if (!alreadyOpened) {
    const url = platform === 'instagram'
      ? 'https://www.instagram.com/'
      : 'https://www.tiktok.com/upload';

    copyMetadataToClipboard(platform, job.filePath);

    try {
      const openResult = shell.openExternal(url);
      if (openResult && typeof openResult.catch === 'function') {
        openResult.catch((e) => {
          log(`[auto-upload] ??  Failed to open browser: ${e}`);
        });
      }
    } catch (e) {
      log(`[auto-upload] ??  Error opening browser: ${e}`);
    }

    try {
      shell.showItemInFolder(job.filePath);
    } catch (e) {
      log(`[auto-upload] ??  Error opening Explorer: ${e}`);
    }
  } else {
    log(`[auto-upload] ?? Overlay next: job already opened (assistOpenedAt), marking done only`);
  }

  job.run = job.run || {};
  job.run[platform] = {
    done: true,
    ok: true,
    at: Date.now(),
    mode: 'manual_assist',
  };

  saveJobs(jobs);
  sendStatus({
    id: job.id,
    platform,
    status: 'Done',
    message: `Posted on ${platform}`,
  });

  const remaining = refreshAssistOverlayStateFromJobs(jobs);
  return { ok: true, jobId: job.id, platform, filePath: job.filePath, remaining };
}

// Function to re-show notifications that were closed but not used
// This helps when user accesses notifications from Windows notification history
// @param forceImmediate - if true, skip interval check (for user-initiated actions)
function reShowPendingNotifications(forceImmediate = false) {
  if (!Notification.isSupported()) return;
  
  const now = Date.now();
  const MIN_RE_SHOW_INTERVAL = 5 * 60 * 1000; // 5 minutes minimum between re-shows (increased to prevent spam)
  
  // Clean up used notifications first
  for (const [notificationId, notifData] of pendingNotifications.entries()) {
    if (notifData.used) {
      pendingNotifications.delete(notificationId);
      lastReShown.delete(notificationId);
      log(`[auto-upload] ???  Cleaned up used notification during re-show check: ${notifData.platform}`);
    }
  }
  
  let reShown = 0;
  for (const [notificationId, notifData] of pendingNotifications.entries()) {
    // Only re-show notifications that haven't been used yet
    if (!notifData.used && notifData.platform) {
      // Check if this notification was recently re-shown (skip check if forceImmediate is true)
      if (!forceImmediate) {
        const lastShown = lastReShown.get(notificationId) || 0;
        const timeSinceLastShow = now - lastShown;
        
        if (timeSinceLastShow < MIN_RE_SHOW_INTERVAL) {
          log(`[auto-upload] ??  Skipping re-show for ${notifData.platform} (ID: ${notificationId}) - was shown ${Math.round(timeSinceLastShow / 1000)}s ago`);
          continue;
        }
      } else {
        log(`[auto-upload] ?? Force re-showing ${notifData.platform} (ID: ${notificationId}) - user initiated`);
      }
      
      try {
        // Check if notification already exists and is still active
        if (notifData.notification) {
          // Notification already exists, don't create a new one
          log(`[auto-upload] ??  Notification already exists for ${notifData.platform} (ID: ${notificationId}) - skipping re-show`);
          continue;
        }
        
        const videoName = path.basename(notifData.filePath);
        const notification = new Notification({
          title: `${notifData.platform.toUpperCase()} Upload Ready`,
          body: `Video "${videoName}" is ready. Click to open upload page.`,
          tag: `yt-uploader-${notificationId}`, // Use notificationId as tag to prevent duplicates
        });

        // Re-register click handler
        const handleClick = () => {
          log(`[auto-upload] ?? Re-shown notification clicked for ${notifData.platform}`);
          
          // Mark as used and delete immediately to prevent re-showing
          notifData.used = true;
          
          // Mark job as posted in jobs.json
          try {
            const jobs = loadJobs();
            const job = jobs.find(j => j.filePath === notifData.filePath);
            if (job) {
              job.run = job.run || {};
              if (notifData.platform === 'instagram') {
                job.run.instagram = { done: true, at: Date.now(), ok: true };
              } else if (notifData.platform === 'tiktok') {
                job.run.tiktok = { done: true, at: Date.now(), ok: true };
              }
              saveJobs(jobs);
              log(`[auto-upload] ? Marked ${notifData.platform} as posted in jobs.json`);
              
              // Send status update to renderer to mark as Posted
              sendStatus({ 
                id: job.id, 
                platform: notifData.platform, 
                status: 'Done', 
                message: `Posted on ${notifData.platform}` 
              });
            }
          } catch (e) {
            log(`[auto-upload] ??  Error marking job as posted: ${e}`);
          }
          
          pendingNotifications.delete(notificationId);
          lastReShown.delete(notificationId);
          log(`[auto-upload] ???  Deleted re-shown notification immediately after use for ${notifData.platform}`);
          
          // Show and focus the main window to bring app to front
          if (mainWindow) {
            if (mainWindow.isMinimized()) {
              mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
            
            // Send message to renderer to filter and select the row
            try {
              mainWindow.webContents.send('autoupload:focusJob', {
                filePath: notifData.filePath,
                platform: notifData.platform,
              });
              log(`[auto-upload] ?? Sent focusJob message to renderer for ${notifData.platform}`);
            } catch (e) {
              log(`[auto-upload] ??  Error sending focusJob message: ${e}`);
            }
          }
          
          // Copy metadata and open browser/Explorer
          copyMetadataToClipboard(notifData.platform, notifData.filePath);
          
          try {
            const openResult = shell.openExternal(notifData.url);
            if (openResult && typeof openResult.catch === 'function') {
              openResult.catch((e) => {
                log(`[auto-upload] ??  Failed to open browser: ${e}`);
              });
            }
          } catch (e) {
            log(`[auto-upload] ??  Error opening browser: ${e}`);
          }
          
          try {
            shell.showItemInFolder(notifData.filePath);
          } catch (e) {
            log(`[auto-upload] ??  Error opening Explorer: ${e}`);
          }
        };

        notification.on('click', handleClick);
        notification.on('action', handleClick);
        notification.on('close', () => {
          log(`[auto-upload] ?? Re-shown notification closed for ${notifData.platform}`);
          // Clear notification reference when closed
          if (notifData) {
            notifData.notification = null;
          }
        });
        
        notification.show();
        notifData.notification = notification; // Update reference
        lastReShown.set(notificationId, now); // Track when it was re-shown
        reShown++;
        log(`[auto-upload] ?? Re-shown notification for ${notifData.platform} (ID: ${notificationId})`);
      } catch (e) {
        log(`[auto-upload] ??  Error re-showing notification ${notificationId}: ${e}`);
      }
    }
  }
  
  if (reShown > 0) {
    log(`[auto-upload] ? Re-shown ${reShown} pending notification(s)`);
  } else {
    log(`[auto-upload] ??  No notifications to re-show (all were recently shown or already used)`);
  }
}

async function manualAssist(platform, job, silentMode = false) {
  // Check if job is already done for this platform - don't create notification if already done
  // Also check if there's already a pending notification for this job/platform
  const notificationId = `${job.id}-${platform}`;
  const existingNotif = pendingNotifications.get(notificationId);
  
  if (job.run && job.run[platform]?.done) {
    log(`[auto-upload] ??  Skipping ${platform} manual assist - job already marked as done`);
    return 0; // Return success since it's already done
  }
  
  // If notification already exists and hasn't been used, don't create another one
  // But clean up old notifications (older than 24 hours) to prevent memory leaks
  if (existingNotif) {
    if (existingNotif.used) {
      // Clean up used notifications
      pendingNotifications.delete(notificationId);
      log(`[auto-upload] ???  Cleaned up used notification for ${platform}`);
    } else {
      // Check if notification is too old (older than 24 hours)
      const age = Date.now() - (existingNotif.createdAt || 0);
      const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
      if (age > MAX_AGE) {
        log(`[auto-upload] ???  Cleaning up old notification (${Math.round(age / 3600000)}h old) for ${platform}`);
        pendingNotifications.delete(notificationId);
        // Continue to create new notification
      } else {
        log(`[auto-upload] ??  Skipping ${platform} manual assist - notification already exists and pending`);
        return 0; // Return success to prevent duplicate
      }
    }
  }
  
  // Don't copy to clipboard immediately - wait for notification click
  // This prevents clipboard from being overwritten when multiple platforms run simultaneously

  // Prepare URL
  let url = '';
  if (platform === 'instagram') {
    url = 'https://www.instagram.com/';
  } else if (platform === 'tiktok') {
    url = 'https://www.tiktok.com/upload';
  }

  const videoName = path.basename(job.filePath);

  // Silent mode: Don't open browser/Explorer automatically
  if (silentMode) {
    log(`[auto-upload] ?? Silent mode enabled - no action taken`);
    // In silent mode, don't do anything - just return
  } else {
    log(`[auto-upload] ?? Silent mode disabled - opening browser and Explorer directly`);
    // Copy to clipboard
    copyMetadataToClipboard(platform, job.filePath);
    
    // Open browser and Explorer
    try {
      await shell.openExternal(url);
      log(`[auto-upload] ? Opened ${platform} upload page in browser`);
    } catch (e) {
      log(`[auto-upload] ??  Failed to open browser: ${e}`);
    }
    try {
      shell.showItemInFolder(job.filePath);
      log(`[auto-upload] ? Opened video file in Explorer`);
    } catch (e) {
      log(`[auto-upload] ??  Error opening Explorer: ${e}`);
    }

  }

  // Send helpful status message
  const message = platform === 'instagram'
    ? 'Ready for upload: 1) Paste metadata (Ctrl+V), 2) Drag video, 3) Click Post'
    : 'Ready for upload: 1) Paste metadata (Ctrl+V), 2) Upload video, 3) Click Post';

  sendStatus({ 
    id: job.id, 
    platform, 
    status: 'Assist', 
    message: message
  });
  
  log(`[auto-upload] ?? ${platform.toUpperCase()} manual assist ready:`);
  log(`[auto-upload]    1. Metadata copied to clipboard (paste with Ctrl+V)`);
  if (!silentMode) {
    log(`[auto-upload]    2. Video file opened in Explorer (drag & drop)`);
    log(`[auto-upload]    3. Upload page opened in browser`);
    log(`[auto-upload]    ? Just paste, upload, and click Post!`);
  } else {
    log(`[auto-upload]    2. Click notification to open browser and Explorer`);
    log(`[auto-upload]    ? Silent mode: No automatic browser/Explorer opening`);
  }
  
  return 0;
}

async function processDueJobs() {
  if (running) return;
  running = true;
  try {
    const settings = loadSettings();
    if (!settings.enabled) return;

    // Load jobs once at the start (optimization: avoid multiple file reads)
    const jobs = loadJobs();
    const now = Date.now();
    let changed = false;

    // sort by time
    jobs.sort((a, b) => (a.publishAtUtcMs || 0) - (b.publishAtUtcMs || 0));

    // Reload jobs once before loop to get latest status (in case jobs were marked as done by notification click)
    // This avoids reloading for each job individually (performance optimization)
    const freshJobs = loadJobs();
    const freshJobsMap = new Map();
    for (const fj of freshJobs) {
      const key = (fj.id && fj.id) ? fj.id : fj.filePath;
      if (key) freshJobsMap.set(key, fj);
    }

    for (const job of jobs) {
      if (!job || typeof job.publishAtUtcMs !== 'number') continue;
      if (job.publishAtUtcMs > now) continue;

      // Get fresh job data from pre-loaded map (optimization: avoid multiple file reads)
      const jobKey = (job.id && job.id) ? job.id : job.filePath;
      const freshJob = jobKey ? freshJobsMap.get(jobKey) : null;
      if (freshJob) {
        // Update job with latest data from file
        Object.assign(job, freshJob);
      }

      // one-time run guard (per platform)
      job.run = job.run || {};
      // If targets exist but all are false, use default (YouTube=true)
      // This handles the case where frontend sets all targets to false for new videos
      let targets = job.targets || { youtube: true, instagram: false, tiktok: false };
      if (targets && !targets.youtube && !targets.instagram && !targets.tiktok) {
        // All targets are false, use default
        targets = { youtube: true, instagram: false, tiktok: false };
      }
      
      // Skip job if all enabled platforms are already done
      const allDone = 
        (!targets.youtube || job.run.youtube?.done) &&
        (!targets.instagram || job.run.instagram?.done) &&
        (!targets.tiktok || job.run.tiktok?.done);
      
      if (allDone) {
        log(`[auto-upload] ??  Skipping ${job.filePath} - all platforms already done`);
        continue;
      }

      // YouTube full auto
      if (targets.youtube && !job.run.youtube?.done) {
        log(`[auto-upload] Due: ${job.filePath} ? YouTube`);
        try {
          const result = await uploadYouTube(job);
          const ok = result.code === 0;
          job.run.youtube = { done: true, at: Date.now(), ok, videoId: result.videoId || undefined };
          if (ok) {
            log(`[auto-upload] YouTube upload succeeded for ${job.filePath}${result.videoId ? ` (videoId=${result.videoId})` : ''}`);
          } else {
            job.run.youtube.error = 'Upload failed (see log)';
            log(`[auto-upload] YouTube upload failed for ${job.filePath}`);
          }
          changed = true;
        } catch (e) {
          const err = String(e);
          log(`[auto-upload] YouTube upload error: ${err}`);
          job.run.youtube = { done: true, at: Date.now(), ok: false, error: err };
          changed = true;
        }
      }

      // IG / TikTok manual assist
      if (freshJob && freshJob.run) {
        job.run = { ...job.run, ...freshJob.run };
      }
    }

    // Silent OFF: auto-start only the first due manual-assist job exactly once (no spam, no multiple opens)
    const settingsForAssist = loadSettings();
    if (settingsForAssist.enabled && !settingsForAssist.silentMode && !hasAutoStartedFirstJob) {
      const dueEntries = getManualAssistDueEntries(jobs, now);
      if (dueEntries.length > 0) {
        const first = dueEntries[0];
        const j = ensureJobId(first.job);
        const platform = first.platform;
        j.run = j.run || {};
        if (!j.run[platform]?.assistOpenedAt) {
          await manualAssist(platform, j, false);
          j.run[platform] = j.run[platform] || {};
          j.run[platform].assistOpenedAt = Date.now();
          hasAutoStartedFirstJob = true;
          changed = true;
        }
      }
    }

    refreshAssistOverlayStateFromJobs(jobs);
    if (changed) saveJobs(jobs);
  } finally {
    running = false;
  }
}

function startTimer() {
  const settings = loadSettings();
  const pollMs = Math.max(10, Number(settings.pollSeconds || 30)) * 1000;

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    processDueJobs().catch((e) => log(`[auto-upload] ERROR: ${String(e)}`));
  }, pollMs);

  // run once immediately
  processDueJobs().catch((e) => log(`[auto-upload] ERROR: ${String(e)}`));
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function setAutoUploadWindow(win) {
  mainWindow = win;
  
  // Re-show pending notifications when window gains focus
  // This helps when user accesses notifications from Windows notification history
  if (win) {
    let isUserInitiated = false;
    
    // Track when user manually shows the window (from tray or taskbar)
    win.on('show', () => {
      isUserInitiated = true;
      // Small delay to ensure window is shown
      setTimeout(() => {
        // Clean up used notifications first
        for (const [notificationId, notifData] of pendingNotifications.entries()) {
          if (notifData.used) {
            pendingNotifications.delete(notificationId);
            lastReShown.delete(notificationId);
          }
        }
        
        const unusedCount = Array.from(pendingNotifications.values()).filter(n => !n.used).length;
        if (unusedCount > 0) {
          log(`[auto-upload] ?? Window shown (user initiated) - re-showing ${unusedCount} unused notification(s)`);
          // Force re-show immediately when user opens the window
          reShowPendingNotifications(true); // Pass true to skip interval check
        }
        // Reset flag after a short delay
        setTimeout(() => { isUserInitiated = false; }, 2000);
      }, 500);
    });
    
    win.on('focus', () => {
      const now = Date.now();
      const MIN_FOCUS_CHECK_INTERVAL = 30 * 1000; // 30 seconds minimum between automatic focus checks
      
      // If user manually opened the window, allow immediate re-show
      if (isUserInitiated) {
        log(`[auto-upload] ?? Window focused (user initiated) - re-showing notifications immediately`);
        const unusedCount = Array.from(pendingNotifications.values()).filter(n => !n.used).length;
        if (unusedCount > 0) {
          reShowPendingNotifications(true); // Pass true to skip interval check
        }
        return;
      }
      
      // For automatic focus (not user-initiated), use interval protection
      if (now - lastFocusCheck < MIN_FOCUS_CHECK_INTERVAL) {
        log(`[auto-upload] ??  Skipping automatic focus check - was checked ${Math.round((now - lastFocusCheck) / 1000)}s ago`);
        return;
      }
      
      lastFocusCheck = now;
      
      // Small delay to ensure window is fully focused
      setTimeout(() => {
        const unusedCount = Array.from(pendingNotifications.values()).filter(n => !n.used).length;
        if (unusedCount > 0) {
          log(`[auto-upload] ?? Window focused (automatic) - checking ${unusedCount} unused notification(s) for re-show`);
          reShowPendingNotifications();
        } else {
          log(`[auto-upload] ??  Window focused - no unused notifications to re-show`);
        }
      }, 500);
    });
  }
}

export function setAssistOverlayWindow(win) {
  assistOverlayWindow = win;
  try {
    refreshAssistOverlayStateFromJobs(loadJobs());
  } catch {
    // ignore
  }
}

export function refreshAssistOverlayState() {
  try {
    refreshAssistOverlayStateFromJobs(loadJobs());
  } catch {
    // ignore
  }
}

export function initAutoUpload(ipcMain, opts = {}) {
  if (typeof opts.getOutputsDir === 'function') {
    getOutputsDir = opts.getOutputsDir;
  }
  // storage API
  // Remove existing handlers if they exist (from fallback handlers)
  // removeHandler is safe to call even if handler doesn't exist
  ipcMain.removeHandler('jobs:save');
  ipcMain.removeHandler('jobs:load');
  
  ipcMain.handle('jobs:save', (_e, jobs) => {
    saveJobs(Array.isArray(jobs) ? jobs : []);
    return true;
  });
  ipcMain.handle('jobs:load', () => {
    try {
      const jobs = loadJobs();
      return jobs;
    } catch (e) {
      console.error('[autoupload] Error loading jobs:', e);
      return [];
    }
  });
  
  console.log('[autoupload] IPC handlers registered: jobs:save, jobs:load');

  // Remove existing autoupload handlers if they exist (from fallback handlers)
  // removeHandler is safe to call even if handler doesn't exist
  ipcMain.removeHandler('autoupload:setEnabled');
  ipcMain.removeHandler('autoupload:getEnabled');
  ipcMain.removeHandler('autoupload:setSilentMode');
  ipcMain.removeHandler('autoupload:getSilentMode');
  ipcMain.removeHandler('autoupload:triggerNotification');
  ipcMain.removeHandler('autoupload:getPendingNotifications');
  ipcMain.removeHandler('autoupload:reShowPendingNotifications');
  ipcMain.removeHandler('autoupload:authYouTube');
  ipcMain.removeHandler('autoupload:triggerAssist');
  ipcMain.removeHandler('autoupload:markAsPosted');
  ipcMain.removeHandler('assistoverlay:next');
  ipcMain.removeHandler('assistoverlay:getCount');

  ipcMain.handle('autoupload:setEnabled', (_e, enabled) => {
    const settings = loadSettings();
    settings.enabled = !!enabled;
    saveSettings(settings);
    if (settings.enabled) {
      startTimer();
    } else {
      stopTimer();
      setAssistOverlayVisible(false);
    }
    log(`[auto-upload] enabled=${settings.enabled}`);
    return settings.enabled;
  });

  ipcMain.handle('autoupload:getEnabled', () => {
    const settings = loadSettings();
    return settings.enabled || false;
  });

  ipcMain.handle('autoupload:setSilentMode', (_e, silent) => {
    const settings = loadSettings();
    settings.silentMode = !!silent;
    saveSettings(settings);
    refreshAssistOverlayStateFromJobs(loadJobs());
    log(`[auto-upload] silentMode=${settings.silentMode}`);
    return settings.silentMode;
  });

  ipcMain.handle('autoupload:getSilentMode', () => {
    const settings = loadSettings();
    return settings.silentMode || false;
  });

  // Handler to manually trigger notification action (fallback for Windows)
  ipcMain.handle('autoupload:triggerNotification', (_e, notificationId) => {
    const notif = pendingNotifications.get(notificationId);
    if (notif) {
      log(`[auto-upload] ?? Manually triggering notification action (ID: ${notificationId})`);
      
      // Mark as used and delete immediately to prevent re-showing
      notif.used = true;
      
      // Mark job as posted in jobs.json
      try {
        const jobs = loadJobs();
        const job = jobs.find(j => j.filePath === notif.filePath);
        if (job) {
          job.run = job.run || {};
          if (notif.platform === 'instagram') {
            job.run.instagram = { done: true, at: Date.now(), ok: true };
          } else if (notif.platform === 'tiktok') {
            job.run.tiktok = { done: true, at: Date.now(), ok: true };
          }
          saveJobs(jobs);
          log(`[auto-upload] ? Marked ${notif.platform} as posted in jobs.json`);
          
          // Send status update to renderer to mark as Posted
          sendStatus({ 
            id: job.id, 
            platform: notif.platform, 
            status: 'Done', 
            message: `Posted on ${notif.platform}` 
          });
        }
      } catch (e) {
        log(`[auto-upload] ??  Error marking job as posted: ${e}`);
      }
      
      pendingNotifications.delete(notificationId);
      lastReShown.delete(notificationId);
      log(`[auto-upload] ???  Deleted manually triggered notification immediately after use for ${notif.platform}`);
      
      // Show and focus the main window to bring app to front
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        
        // Send message to renderer to filter and select the row
        try {
          mainWindow.webContents.send('autoupload:focusJob', {
            filePath: notif.filePath,
            platform: notif.platform,
          });
          log(`[auto-upload] ?? Sent focusJob message to renderer for ${notif.platform}`);
        } catch (e) {
          log(`[auto-upload] ??  Error sending focusJob message: ${e}`);
        }
      }
      
      // Copy metadata to clipboard for the correct platform
      copyMetadataToClipboard(notif.platform, notif.filePath);
      
      try {
        const openResult = shell.openExternal(notif.url);
        if (openResult && typeof openResult.catch === 'function') {
          openResult.catch((e) => {
            log(`[auto-upload] ??  Failed to open browser: ${e}`);
          });
        }
      } catch (e) {
        log(`[auto-upload] ??  Error opening browser: ${e}`);
      }
      try {
        shell.showItemInFolder(notif.filePath);
      } catch (e) {
        log(`[auto-upload] ??  Error opening Explorer: ${e}`);
      }
      
      return { ok: true };
    }
    return { ok: false, error: 'Notification not found' };
  });

  // Handler to get list of pending notifications (for debugging/manual access)
  ipcMain.handle('autoupload:getPendingNotifications', () => {
    const notifications = [];
    for (const [id, notif] of pendingNotifications.entries()) {
      notifications.push({
        id,
        platform: notif.platform,
        filePath: notif.filePath,
        url: notif.url,
        used: notif.used || false,
      });
    }
    return notifications;
  });

  // Handler to re-show all pending notifications that haven't been used
  // Useful when user accesses notifications from Windows notification history
  ipcMain.handle('autoupload:reShowPendingNotifications', (_e, forceImmediate = true) => {
    log(`[auto-upload] ?? Re-showing all pending notifications (forceImmediate=${forceImmediate})...`);
    reShowPendingNotifications(forceImmediate);
    return { ok: true };
  });

  ipcMain.handle('autoupload:authYouTube', async () => {
    log('[auto-upload] Starting YouTube auth...');
    const code = await authYouTube();
    log(`[auto-upload] YouTube auth finished (exit=${code})`);
    return code;
  });

  // Trigger assist now for a specific job and platform (direct action, no notification)
  ipcMain.handle('autoupload:triggerAssist', async (_e, { filePath, platform }) => {
    try {
      const jobs = loadJobs();
      const job = jobs.find(j => j.filePath === filePath);
      if (!job) {
        log(`[auto-upload] ??  Job not found for file: ${filePath}`);
        return { ok: false, error: 'Job not found' };
      }
      
      // Check if job is already done for this platform
      if (job.run && job.run[platform]?.done) {
        log(`[auto-upload] ??  Skipping ${platform} assist - job already marked as done`);
        return { ok: true, message: `Already posted on ${platform}` };
      }
      
      log(`[auto-upload] ?? User triggered assist now (direct) for ${platform}: ${filePath}`);
      
      // Prepare URL
      let url = '';
      if (platform === 'youtube') {
        url = 'https://www.youtube.com/upload';
      } else if (platform === 'instagram') {
        url = 'https://www.instagram.com/';
      } else if (platform === 'tiktok') {
        url = 'https://www.tiktok.com/upload';
      }
      
      // Copy metadata to clipboard immediately
      const clipboardCopied = copyMetadataToClipboard(platform, filePath);
      if (!clipboardCopied) {
        log(`[auto-upload] ??  Failed to copy metadata to clipboard`);
      }
      
      // Open browser immediately
      try {
        const openResult = shell.openExternal(url);
        if (openResult && typeof openResult.catch === 'function') {
          openResult.catch((e) => {
            log(`[auto-upload] ??  Failed to open browser: ${e}`);
          });
        }
        log(`[auto-upload] ?? Opened ${platform} upload page in browser`);
      } catch (e) {
        log(`[auto-upload] ??  Error opening browser: ${e}`);
      }
      
      // Open File Explorer immediately
      try {
        shell.showItemInFolder(filePath);
        log(`[auto-upload] ?? Opened file in Explorer`);
      } catch (e) {
        log(`[auto-upload] ??  Error opening Explorer: ${e}`);
      }
      
      // Send assist status update to renderer (do not mark as posted)
      const message = platform === 'instagram'
        ? 'Ready for upload: 1) Paste metadata (Ctrl+V), 2) Drag video, 3) Click Post'
        : platform === 'tiktok'
          ? 'Ready for upload: 1) Paste metadata (Ctrl+V), 2) Upload video, 3) Click Post'
          : 'Ready for upload: 1) Paste metadata (Ctrl+V), 2) Upload video, 3) Click Post';
      sendStatus({ 
        id: job.id, 
        platform, 
        status: 'Assist', 
        message,
      });
      
      // Show and focus the main window
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
      
      return { ok: true, message: `Assist completed for ${platform}` };
    } catch (e) {
      log(`[auto-upload] ??  Error triggering assist: ${e}`);
      return { ok: false, error: String(e) };
    }
  });

  // Mark job as posted for a specific platform
  ipcMain.handle('autoupload:markAsPosted', async (_e, { filePath, platform }) => {
    try {
      const jobs = loadJobs();
      let job = jobs.find(j => j.filePath === filePath);
      
      // Create job if it doesn't exist
      if (!job) {
        const newJobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        job = {
          id: newJobId,
          filePath: filePath,
          publishAtUtcMs: Date.now(),
          targets: {
            youtube: platform === 'youtube',
            instagram: platform === 'instagram',
            tiktok: platform === 'tiktok',
          },
          visibility: 'private',
          createdAt: Date.now(),
        };
        jobs.push(job);
        log(`[auto-upload] ?? Created new job for file: ${filePath}`);
      }
      
      job.run = job.run || {};
      if (platform === 'instagram') {
        job.run.instagram = { done: true, at: Date.now(), ok: true, mode: 'manual_assist' };
      } else if (platform === 'tiktok') {
        job.run.tiktok = { done: true, at: Date.now(), ok: true, mode: 'manual_assist' };
      } else if (platform === 'youtube') {
        job.run.youtube = { done: true, at: Date.now(), ok: true };
      } else {
        return { ok: false, error: 'Invalid platform' };
      }
      
      // Ensure target is enabled for this platform
      job.targets = job.targets || { youtube: false, instagram: false, tiktok: false };
      job.targets[platform] = true;
      
      saveJobs(jobs);
      log(`[auto-upload] ? Marked ${platform} as posted for: ${filePath}`);
      
      // Clean up any pending notifications for this job/platform
      const notificationId = `${job.id}-${platform}`;
      pendingNotifications.delete(notificationId);
      lastReShown.delete(notificationId);
      
      // Send status update to renderer to update UI immediately
      sendStatus({ 
        id: job.id, 
        platform, 
        status: 'Done', 
        message: `Marked as posted` 
      });

      refreshAssistOverlayStateFromJobs(jobs);
      
      return { ok: true, message: `Marked ${platform} as posted` };
    } catch (e) {
      log(`[auto-upload] ??  Error marking as posted: ${e}`);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('assistoverlay:getCount', () => {
    const jobs = loadJobs();
    const count = getManualAssistDueEntries(jobs).length;
    return { ok: true, count };
  });

  ipcMain.handle('assistoverlay:next', async () => {
    try {
      return await assistNextDueJob();
    } catch (e) {
      log(`[auto-upload] ??  Error running assist overlay: ${e}`);
      return { ok: false, error: String(e) };
    }
  });

  // start with current setting
  const settings = loadSettings();
  if (settings.enabled) startTimer();
}
