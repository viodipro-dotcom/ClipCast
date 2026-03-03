import electron from 'electron';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const { app, shell } = electron;

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

export function loadClientCredentials() {
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
    return fromEnv;
  }

  // Optional convenience: user can drop credentials into userData for local dev.
  // File shape: { "clientId": "...", "clientSecret": "..." }
  const p = path.join(app.getPath('userData'), 'google_oauth_client.json');
  const j = safeReadJson(p, null);
  const clientId = j?.clientId || j?.installed?.client_id || '';
  const clientSecret = j?.clientSecret || j?.installed?.client_secret || '';
  if (clientId && clientSecret) {
    // Basic validation
    if (!clientId.includes('.apps.googleusercontent.com') && !clientId.includes('@')) {
      throw new Error(
        `Invalid Client ID format in ${p}. Expected format: numbers-letters.apps.googleusercontent.com. Got: ${clientId.slice(0, 50)}...`,
      );
    }
    return { clientId, clientSecret };
  }

  throw new Error(
    'Missing Google OAuth credentials. Set env GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or create userData/google_oauth_client.json',
  );
}

export function getTokensPath() {
  return path.join(app.getPath('userData'), 'youtube_tokens.json');
}

export function isConnected() {
  const p = getTokensPath();
  const tokens = safeReadJson(p, null);
  return Boolean(tokens && (tokens.refresh_token || tokens.access_token));
}

function createOAuthClient(redirectUri) {
  const { clientId, clientSecret } = loadClientCredentials();
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
            errorMsg = `OAuth error: ${err}. ${errorDescription || 'Invalid or missing OAuth credentials. Check your clientId and clientSecret in google_oauth_client.json'}`;
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
    const creds = loadClientCredentials();
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
    const oauth2Client = createOAuthClient(redirectUri);
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
    const oauth2Client = createOAuthClient(redirectUri);
    writeLog('Exchanging code for tokens...');
    try {
      const { tokens } = await oauth2Client.getToken(code);
      safeWriteJson(getTokensPath(), { ...tokens, obtainedAt: Date.now() });
      writeLog('Tokens saved to userData/youtube_tokens.json');
      return { ok: true };
    } catch (e) {
      const errMsg = String(e?.message || e || 'Unknown error');
      if (errMsg.includes('invalid_client') || errMsg.includes('401')) {
        throw new Error(
          'Invalid OAuth credentials (401: invalid_client). Please check:\n' +
            '1. Client ID and Client Secret are correct in google_oauth_client.json\n' +
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

  const tokensPath = getTokensPath();
  const tokens = safeReadJson(tokensPath, null);
  if (!tokens) throw new Error('Not connected: youtube_tokens.json not found');

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
  const { clientId, clientSecret } = loadClientCredentials();
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials(tokens);

  // Force token refresh if needed and persist updated credentials
  try {
    await oauth2Client.getAccessToken();
  } catch (e) {
    writeLog(`Token refresh failed: ${String(e)}`);
    throw e;
  }
  safeWriteJson(tokensPath, { ...oauth2Client.credentials, updatedAt: Date.now() });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  writeLog(`Uploading: ${path.basename(filePath)}`);
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
}

