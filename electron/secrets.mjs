import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import keytar from 'keytar';

const { app } = electron;

const SERVICE_NAME = app?.isPackaged ? 'ClipCast' : 'ClipCast-Dev';
const ACCOUNT_YOUTUBE_TOKENS = 'youtube_tokens';
const ACCOUNT_GOOGLE_OAUTH = 'google_oauth_client';
const ACCOUNT_OPENAI_API_KEY = 'openai_api_key';

const REDACTED_VALUE = '[redacted]';

const SECRET_FIELDS = new Set([
  'apiKey',
  'api_key',
  'OPENAI_API_KEY',
  'access_token',
  'refresh_token',
  'clientSecret',
  'client_secret',
]);

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/g,
  /ya29\.[A-Za-z0-9\-_]+/g,
  /1\/\/[A-Za-z0-9\-_]+/g,
];

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

function redactString(value) {
  let s = String(value ?? '');
  for (const pattern of TOKEN_PATTERNS) {
    s = s.replace(pattern, REDACTED_VALUE);
  }
  s = s.replace(
    /(access_token|refresh_token|clientSecret|client_secret|apiKey|api_key|OPENAI_API_KEY)\s*[:=]\s*("?)[^"'\s,}]+/gi,
    (_m, key, quote) => `${key}${quote ? '":"' : '='}${REDACTED_VALUE}${quote ? '"' : ''}`,
  );
  return s;
}

function redactObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_FIELDS.has(k)) {
      out[k] = REDACTED_VALUE;
      continue;
    }
    if (typeof v === 'string') {
      out[k] = redactString(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function redactSecrets(value) {
  if (typeof value === 'string') return redactString(value);
  if (value && typeof value === 'object') return redactObject(value);
  return value;
}

function ensureNonEmptyString(label, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

async function setPassword(account, value) {
  const trimmed = ensureNonEmptyString('Secret value', value);
  await keytar.setPassword(SERVICE_NAME, account, trimmed);
}

async function getPassword(account) {
  const value = await keytar.getPassword(SERVICE_NAME, account);
  return value || null;
}

async function clearPassword(account) {
  try {
    await keytar.deletePassword(SERVICE_NAME, account);
  } catch {
    // ignore
  }
}

export async function setYouTubeTokens(tokensJson) {
  if (!tokensJson || typeof tokensJson !== 'object') {
    throw new Error('YouTube tokens must be an object');
  }
  await setPassword(ACCOUNT_YOUTUBE_TOKENS, JSON.stringify(tokensJson));
}

export async function getYouTubeTokens() {
  const raw = await getPassword(ACCOUNT_YOUTUBE_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearYouTubeTokens() {
  await clearPassword(ACCOUNT_YOUTUBE_TOKENS);
}

export async function setGoogleOAuthClient(clientId, clientSecret) {
  const safeClientId = ensureNonEmptyString('clientId', clientId);
  const trimmedSecret = typeof clientSecret === 'string' && clientSecret.trim() ? clientSecret.trim() : '';
  const existing = (await getGoogleOAuthClient()) || null;
  const nextSecret = trimmedSecret || (existing?.clientSecret && existing?.clientId === safeClientId ? existing.clientSecret : undefined);
  const payload = {
    clientId: safeClientId,
    ...(nextSecret ? { clientSecret: nextSecret } : {}),
  };
  await setPassword(ACCOUNT_GOOGLE_OAUTH, JSON.stringify(payload));
}

export async function getGoogleOAuthClient() {
  const raw = await getPassword(ACCOUNT_GOOGLE_OAUTH);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId : '';
    const clientSecret = typeof parsed.clientSecret === 'string' ? parsed.clientSecret : undefined;
    if (!clientId) return null;
    return { clientId, ...(clientSecret ? { clientSecret } : {}) };
  } catch {
    return null;
  }
}

export async function clearGoogleOAuthClient() {
  await clearPassword(ACCOUNT_GOOGLE_OAUTH);
}

/** Store user OpenAI API key (BYOK). Main process / pipeline only — never send to renderer. */
export async function setOpenAIApiKey(key) {
  await setPassword(ACCOUNT_OPENAI_API_KEY, key);
}

export async function getOpenAIApiKey() {
  return await getPassword(ACCOUNT_OPENAI_API_KEY);
}

export async function clearOpenAIApiKey() {
  await clearPassword(ACCOUNT_OPENAI_API_KEY);
}

/** Safe for IPC: no full key, only whether configured and a short suffix hint. */
export async function getOpenAIApiKeyStatus() {
  const key = await getPassword(ACCOUNT_OPENAI_API_KEY);
  if (!key) return { configured: false };
  const hint = key.length >= 4 ? `…${key.slice(-4)}` : '…*';
  return { configured: true, hint };
}

function buildRedactedFileMeta() {
  return { migratedToKeytar: true, redacted: true, redactedAt: new Date().toISOString() };
}

function extractLegacyGoogleOAuthClient(data) {
  if (!data || typeof data !== 'object') return null;
  const clientId = data?.clientId || data?.installed?.client_id || '';
  const clientSecret = data?.clientSecret || data?.installed?.client_secret || '';
  if (!clientId) return null;
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}

function buildBundledGoogleOAuthClientPathCandidates() {
  const candidates = [];
  if (app?.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'assets', 'oauth', 'google_oauth_client.json'));
    candidates.push(path.join(process.resourcesPath, 'oauth', 'google_oauth_client.json'));
  }
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : '';
  if (appPath) {
    candidates.push(path.join(appPath, 'assets', 'oauth', 'google_oauth_client.json'));
  }
  candidates.push(path.join(process.cwd(), 'assets', 'oauth', 'google_oauth_client.json'));
  return candidates.filter(Boolean);
}

function resolveBundledGoogleOAuthClientPath() {
  const candidates = buildBundledGoogleOAuthClientPathCandidates();
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function getBundledGoogleOAuthClientPathCandidates() {
  return buildBundledGoogleOAuthClientPathCandidates();
}

export async function getBundledGoogleOAuthClient({ log } = {}) {
  const logger = typeof log === 'function' ? log : null;
  const filePath = resolveBundledGoogleOAuthClientPath();
  if (!filePath) return null;
  const data = safeReadJson(filePath, null);
  const parsed = extractLegacyGoogleOAuthClient(data);
  if (!parsed?.clientId) return null;
  if (logger) logger('[secrets] loaded bundled Google OAuth client');
  return { ...parsed, source: 'bundled', filePath };
}

async function migrateLegacyGoogleOAuthClient({ log } = {}) {
  const logger = typeof log === 'function' ? log : console.log;
  const userDataDir = app.getPath('userData');
  const googleClientPath = path.join(userDataDir, 'google_oauth_client.json');
  if (!fs.existsSync(googleClientPath)) return null;

  const data = safeReadJson(googleClientPath, null);
  const parsed = extractLegacyGoogleOAuthClient(data);
  if (!parsed) return null;

  const existing = await getGoogleOAuthClient();
  if (!existing) {
    try {
      await setGoogleOAuthClient(parsed.clientId, parsed.clientSecret);
    } catch {
      return parsed;
    }
  }

  if (!data?.migratedToKeytar) {
    const redacted = {
      clientId: parsed.clientId || REDACTED_VALUE,
      ...buildRedactedFileMeta(),
    };
    safeWriteJson(googleClientPath, redacted);
    logger('[secrets] migrated google_oauth_client.json -> keytar');
  }

  return existing || parsed;
}

export async function migrateLegacySecrets({ log } = {}) {
  const logger = typeof log === 'function' ? log : console.log;
  const userDataDir = app.getPath('userData');
  const openAiPath = path.join(userDataDir, 'openai_config.json');
  const youtubeTokensPath = path.join(userDataDir, 'youtube_tokens.json');

  if (fs.existsSync(openAiPath)) {
    const data = safeReadJson(openAiPath, null);
    if (!data?.migratedToKeytar) {
      safeWriteJson(openAiPath, { apiKey: REDACTED_VALUE, ...buildRedactedFileMeta() });
      logger('[secrets] redacted openai_config.json (no local storage)');
    }
  }

  if (fs.existsSync(youtubeTokensPath)) {
    const tokens = safeReadJson(youtubeTokensPath, null);
    if (!tokens?.migratedToKeytar) {
      const existing = await getYouTubeTokens();
      if (!existing && tokens) {
        await setYouTubeTokens(tokens);
      }
      safeWriteJson(youtubeTokensPath, buildRedactedFileMeta());
      logger('[secrets] migrated youtube_tokens.json -> keytar');
    }
  }

  await migrateLegacyGoogleOAuthClient({ log });
}

export async function getGoogleOAuthClientWithFallback({ log } = {}) {
  const existing = await getGoogleOAuthClient();
  if (existing) return { ...existing, source: 'keytar' };
  const legacy = await migrateLegacyGoogleOAuthClient({ log });
  if (legacy) return { ...legacy, source: 'legacy' };
  return null;
}

export const SECRET_ACCOUNTS = {
  SERVICE_NAME,
  ACCOUNT_YOUTUBE_TOKENS,
  ACCOUNT_GOOGLE_OAUTH,
};
