import electron from 'electron';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import {
  getBundledGoogleOAuthClient,
  getGoogleOAuthClientWithFallback,
  getYouTubeTokens,
  redactSecrets,
  setYouTubeTokens,
} from './secrets.mjs';

const { app, shell } = electron;

function appendLine(p, line) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line, 'utf-8');
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

function parseTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((t) => String(t)).filter(Boolean);
  const s = String(input);
  return s
    .split(/[,\n\r\t ]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith('#') ? x.slice(1) : x))
    .filter(Boolean);
}

let cachedTokens = null;
let tokensLoaded = false;

const OAUTH_CLIENT_MISSING_CODE = 'OAUTH_CLIENT_MISSING';

async function loadTokensFromKeytar() {
  if (tokensLoaded) return cachedTokens;
  cachedTokens = await getYouTubeTokens();
  tokensLoaded = true;
  return cachedTokens;
}

function setCachedTokens(tokens) {
  cachedTokens = tokens;
  tokensLoaded = true;
}

export function clearYouTubeTokensCache() {
  cachedTokens = null;
  tokensLoaded = false;
}

export async function loadClientCredentials() {
  const fromEnv = {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.YT_GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.YT_GOOGLE_CLIENT_SECRET || '',
  };
  if (fromEnv.clientId && fromEnv.clientSecret) {
    // Basic validation
    if (!fromEnv.clientId.includes('.apps.googleusercontent.com') && !fromEnv.clientId.includes('@')) {
      throw new Error(
        'Invalid Client ID format. Expected format: numbers-letters.apps.googleusercontent.com',
      );
    }
    return { ...fromEnv, source: 'env' };
  }

  // TODO: migrate to PKCE installed-app flow to drop clientSecret requirement.
  const stored = await getGoogleOAuthClientWithFallback();
  const clientId = stored?.clientId || '';
  const clientSecret = stored?.clientSecret || '';
  if (clientId && clientSecret) {
    // Basic validation
    if (!clientId.includes('.apps.googleusercontent.com') && !clientId.includes('@')) {
      throw new Error(
        `Invalid Client ID format. Expected format: numbers-letters.apps.googleusercontent.com. Got: ${clientId.slice(0, 50)}...`,
      );
    }
    return { clientId, clientSecret, source: stored?.source || 'keytar' };
  }
  if (clientId && !clientSecret) {
    throw new Error('Missing Google OAuth client secret. Re-enter credentials in app settings.');
  }

  const bundled = await getBundledGoogleOAuthClient();
  if (bundled?.clientId && bundled?.clientSecret) {
    if (!bundled.clientId.includes('.apps.googleusercontent.com') && !bundled.clientId.includes('@')) {
      throw new Error(
        `Invalid Client ID format. Expected format: numbers-letters.apps.googleusercontent.com. Got: ${bundled.clientId.slice(0, 50)}...`,
      );
    }
    return { clientId: bundled.clientId, clientSecret: bundled.clientSecret, source: 'bundled' };
  }

  throw new Error(OAUTH_CLIENT_MISSING_CODE);
}

export async function isConnected() {
  const tokens = await loadTokensFromKeytar();
  return Boolean(tokens && (tokens.refresh_token || tokens.access_token));
}

async function createOAuthClient(redirectUri) {
  const { clientId, clientSecret } = await loadClientCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function withLocalCallbackServer(onReady) {
  return await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url || '/', `http://${req.headers.host}`);
        if (u.pathname !== '/callback') {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
          return;
        }

        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        const errorDescription = u.searchParams.get('error_description') || '';
        if (err) {
          let errorMsg = `OAuth error: ${err}`;
          if (err === 'invalid_client' || err === 'access_denied') {
            errorMsg = `OAuth error: ${err}. ${errorDescription || 'Invalid or missing OAuth credentials. Configure the Google OAuth client in Settings.'}`;
          }
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end(errorMsg);
          server.close();
          reject(new Error(errorMsg));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('Missing code');
          server.close();
          reject(new Error('OAuth callback missing code'));
          return;
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<h3>YouTube connected.</h3><p>You can close this tab and return to the app.</p>');
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({ code, port, close: () => server.close() });
      } catch (e) {
        try {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('Internal error');
        } catch {
          // ignore
        }
        server.close();
        reject(e);
      }
    });

    server.listen(0, '127.0.0.1', async () => {
      try {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        if (!port) throw new Error('Failed to bind local OAuth callback server');
        await onReady({ port });
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
}

export async function connect({ log, outputsDir } = {}) {
  const baseDir = outputsDir || path.join(app.getAppPath(), '..', 'yt_pipeline', 'outputs');
  const uploadLogPath = path.join(baseDir, 'Reports', 'upload_last.log');
  const writeLog = (line) => {
    const msg = `[youtube] ${line}`;
    if (typeof log === 'function') log(`${msg}\n`);
    appendLine(uploadLogPath, `${nowIso()} ${msg}\n`);
  };

  writeLog('Starting OAuth connect...');
  
  // Validate credentials before starting OAuth flow
  try {
    const creds = await loadClientCredentials();
    writeLog(`Using Client ID: ${creds.clientId.slice(0, 30)}...`);
    if (!creds.clientId.includes('.apps.googleusercontent.com')) {
      throw new Error('Client ID format invalid. Must end with .apps.googleusercontent.com');
    }
  } catch (e) {
    const errMsg = String(e?.message || e);
    writeLog(`Credential validation failed: ${errMsg}`);
    throw e;
  }

  const { code, port, close } = await withLocalCallbackServer(async ({ port }) => {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const oauth2Client = await createOAuthClient(redirectUri);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.upload'],
      prompt: 'consent',
      state,
    });

    writeLog(`Opening system browser for consent (redirectUri=${redirectUri})`);
    await shell.openExternal(authUrl);
  });

  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const oauth2Client = await createOAuthClient(redirectUri);
    writeLog('Exchanging code for tokens...');
    try {
      const { tokens } = await oauth2Client.getToken(code);
      const nextTokens = { ...tokens, obtainedAt: Date.now() };
      await setYouTubeTokens(nextTokens);
      setCachedTokens(nextTokens);
      writeLog('Tokens saved to OS keychain');
      return { ok: true };
    } catch (e) {
      const errMsg = redactSecrets(String(e?.message || e || 'Unknown error'));
      if (errMsg.includes('invalid_client') || errMsg.includes('401')) {
        throw new Error(
          'Invalid OAuth credentials (401: invalid_client). Please check:\n' +
            '1. Client ID and Client Secret are correct in app settings (stored in OS keychain) or environment\n' +
            '2. OAuth client type is "Desktop app" or "Other" (not Web application)\n' +
            '3. YouTube Data API v3 is enabled in Google Cloud Console\n' +
            '4. OAuth consent screen is configured and published (or you are added as a test user)',
        );
      }
      throw e;
    }
  } finally {
    close?.();
  }
}

export async function uploadVideo(payload, { log, appRoot, outputsDir } = {}) {
  const baseDir = outputsDir || path.join(appRoot || path.join(app.getAppPath(), '..'), 'yt_pipeline', 'outputs');
  const uploadLogPath = path.join(baseDir, 'Reports', 'upload_last.log');
  const writeLog = (line) => {
    const msg = `[youtube] ${line}`;
    if (typeof log === 'function') log(`${msg}\n`);
    appendLine(uploadLogPath, `${nowIso()} ${msg}\n`);
  };

  const tokens = await loadTokensFromKeytar();
  if (!tokens) throw new Error('Not connected: YouTube tokens not found');

  const filePath = String(payload?.filePath || '');
  const title = String(payload?.title || '').trim();
  const description = String(payload?.description || '');
  const tags = parseTags(payload?.tags);
  const privacyStatus = String(payload?.privacyStatus || 'private');
  const selfDeclaredMadeForKids = Boolean(payload?.selfDeclaredMadeForKids);
  const publishAt = payload?.publishAt;

  if (!filePath) throw new Error('Missing filePath');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!title) throw new Error('Missing title');

  // For manual scheduling: if publishAt is provided, YouTube requires privacyStatus=private + publishAt.
  let status = { privacyStatus, selfDeclaredMadeForKids };
  if (publishAt != null) {
    const ms = typeof publishAt === 'number' ? publishAt : new Date(String(publishAt)).getTime();
    if (!Number.isFinite(ms)) throw new Error('Invalid publishAt');
    const publishAtIso = new Date(ms).toISOString();
    writeLog(`Scheduling publish at: ${publishAtIso} (UTC timestamp: ${ms})`);
    status = { privacyStatus: 'private', publishAt: publishAtIso, selfDeclaredMadeForKids };
  }

  // Use the stored redirectUri if present; fallback to installed-app style (redirectUri not required for refresh).
  const { clientId, clientSecret } = await loadClientCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);

  // Force token refresh if needed and persist updated credentials
  try {
    await oauth2Client.getAccessToken();
  } catch (e) {
    writeLog(`Token refresh failed: ${String(e)}`);
    throw e;
  }
  const nextTokens = { ...oauth2Client.credentials, updatedAt: Date.now() };
  await setYouTubeTokens(nextTokens);
  setCachedTokens(nextTokens);

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  writeLog(`Uploading: ${path.basename(filePath)}`);
  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          tags: tags.length ? tags : undefined,
        },
        status,
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    const videoId = res?.data?.id || '';
    writeLog(`Upload done. videoId=${videoId || '(unknown)'}`);
    return { ok: true, videoId, data: res?.data || null };
  } catch (e) {
    const normalized = normalizeYouTubeUploadError(e);
    const message = normalized.message || String(e?.message ?? e);
    if (isDailyUploadLimitError(normalized)) {
      if (typeof log === 'function') {
        log(`[youtube] daily upload limit detected; not charging credits; showing user message (reason=${normalized.reason || 'unknown'}, httpStatus=${normalized.httpStatus ?? 'n/a'})\n`);
      }
      appendLine(uploadLogPath, `${nowIso()} [youtube] daily upload limit detected; not charging credits; showing user message (reason=${normalized.reason || 'unknown'}, httpStatus=${normalized.httpStatus ?? 'n/a'})\n`);
      return { ok: false, error: message, dailyUploadLimit: true };
    }
    return { ok: false, error: message };
  }
}

/**
 * Normalize YouTube API / Gaxios errors into a common shape for classification.
 * @param {unknown} e - Caught error (often GaxiosError with response.data.error)
 * @returns {{ code?: string, message: string, reason?: string, httpStatus?: number, raw?: unknown }}
 */
function normalizeYouTubeUploadError(e) {
  const out = { code: undefined, message: '', reason: undefined, httpStatus: undefined, raw: e };
  const err = e?.response?.data?.error || e?.errors?.[0] || e;
  out.code = err?.code ?? e?.response?.status ?? err?.status;
  out.httpStatus = Number(e?.response?.status ?? err?.code ?? err?.status);
  if (Number.isNaN(out.httpStatus) && typeof err?.code === 'number') out.httpStatus = err.code;
  const firstErr = Array.isArray(err?.errors) ? err.errors[0] : err;
  out.reason = firstErr?.reason ?? firstErr?.domain ?? err?.reason;
  const msg = firstErr?.message ?? err?.message ?? e?.message;
  out.message = typeof msg === 'string' ? msg : String(e ?? 'Unknown error');
  return out;
}

const DAILY_LIMIT_REASONS = new Set([
  'uploadLimitExceeded',
  'dailyLimitExceeded',
  'youtubeSignupRequired',
  'accountNotVerified',
]);

const DAILY_LIMIT_MESSAGE_SUBSTRINGS = [
  'daily upload limit',
  'upload limit',
  'verify your account',
  'phone verification',
  'youtube verification',
  'exceeded the number of videos',
  'verification required',
  'channel verification',
];

/**
 * Classify whether the error is YouTube daily upload limit / verification required.
 * Uses reason, httpStatus, and message substrings for robust matching.
 * @param {{ code?: string, message: string, reason?: string, httpStatus?: number }} normalized
 * @returns {boolean}
 */
function isDailyUploadLimitError(normalized) {
  const { reason, message, httpStatus } = normalized;
  const msg = (message || '').toLowerCase();

  if (httpStatus === 403 && DAILY_LIMIT_REASONS.has(reason)) return true;
  if (reason === 'quotaExceeded' && (msg.includes('daily') || msg.includes('upload limit') || msg.includes('verify'))) return true;

  for (const sub of DAILY_LIMIT_MESSAGE_SUBSTRINGS) {
    if (msg.includes(sub)) return true;
  }
  return false;
}

