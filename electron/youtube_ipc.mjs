import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { connect, isConnected, uploadVideo, loadClientCredentials } from './youtube.mjs';
import { getBundledGoogleOAuthClientPathCandidates, redactSecrets } from './secrets.mjs';

const { app, shell } = electron;

let mainWindow = null;

export function setYouTubeWindow(win) {
  mainWindow = win;
}

function appendLine(p, line) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line, 'utf-8');
  } catch {
    // ignore
  }
}

export function initYouTubeIpc(ipcMain, { appRoot, getOutputsDir, logToPipeline } = {}) {
  try {
    const outputsDir = typeof getOutputsDir === 'function' ? getOutputsDir() : path.join(appRoot || path.join(app.getAppPath(), '..'), 'yt_pipeline', 'outputs');
    const uploadLogPath = path.join(outputsDir, 'Reports', 'upload_last.log');

    const log = (line) => {
      const s = String(line || '');
      const withNl = s.endsWith('\n') ? s : `${s}\n`;
      try {
        if (typeof logToPipeline === 'function') logToPipeline(withNl);
        else mainWindow?.webContents?.send?.('pipeline:log', { runId: 'youtube', line: withNl });
      } catch {
        // ignore
      }
      appendLine(uploadLogPath, `${new Date().toISOString()} ${withNl}`);
    };

    console.log('[youtube-ipc] Registering handlers...');

    ipcMain.handle('youtube:connect', async () => {
      return await connect({ log, outputsDir });
    });
    console.log('[youtube-ipc] Registered: youtube:connect');

    ipcMain.handle('youtube:isConnected', async () => {
      return { ok: true, connected: await isConnected() };
    });
    console.log('[youtube-ipc] Registered: youtube:isConnected');

    ipcMain.handle('youtube:upload', async (_e, payload) => {
      try {
        const res = await uploadVideo(payload, { log, appRoot, outputsDir });
        return res;
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    });
    console.log('[youtube-ipc] Registered: youtube:upload');

    ipcMain.handle('youtube:openUserData', async () => {
      try {
        const userDataPath = app.getPath('userData');
        await shell.openPath(userDataPath);
        return { ok: true, path: userDataPath };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });
    console.log('[youtube-ipc] Registered: youtube:openUserData');

    ipcMain.handle('youtube:validateCredentials', async () => {
      try {
        const creds = await loadClientCredentials();
        const userDataPath = app.getPath('userData');
        const credsPath = path.join(userDataPath, 'google_oauth_client.json');
        const fileExists = fs.existsSync(credsPath);
        const sourceLabel =
          creds?.source === 'env'
            ? 'local override (environment variables)'
            : creds?.source === 'legacy'
              ? 'legacy file (migrated to OS keychain)'
              : creds?.source === 'bundled'
                ? 'bundled app client'
                : 'OS keychain';
        
        return {
          ok: true,
          hasCredentials: true,
          source: creds?.source || null,
          clientIdPrefix: creds.clientId.slice(0, 30) + '...',
          clientIdValid: creds.clientId.includes('.apps.googleusercontent.com'),
          filePath: credsPath,
          fileExists,
          message: fileExists
            ? `Credentials loaded from ${sourceLabel} (legacy file exists but is redacted)`
            : `Credentials loaded from ${sourceLabel}`,
        };
      } catch (e) {
        const userDataPath = app.getPath('userData');
        const credsPath = path.join(userDataPath, 'google_oauth_client.json');
        const fileExists = fs.existsSync(credsPath);
        
        const errorMessage = redactSecrets(String(e?.message || e));
        const missingMessage =
          'YouTube connection is not available yet on this device. Please try again or contact support.';
        const bundledCandidates = getBundledGoogleOAuthClientPathCandidates();
        const expectedBundledPath = bundledCandidates.length ? bundledCandidates[0] : '';
        const isMissingClient = errorMessage.includes('OAUTH_CLIENT_MISSING');

        return {
          ok: false,
          hasCredentials: false,
          error: errorMessage,
          filePath: credsPath,
          fileExists,
          expectedBundledPath,
          message: fileExists
            ? `Credentials found but invalid: ${errorMessage}`
            : (isMissingClient
              ? `Bundled OAuth client missing. Expected file at: ${expectedBundledPath || 'resources/assets/oauth/google_oauth_client.json'}`
              : (errorMessage || missingMessage)),
        };
      }
    });
    console.log('[youtube-ipc] Registered: youtube:validateCredentials');
    console.log('[youtube-ipc] All handlers registered successfully');
  } catch (e) {
    console.error('[youtube-ipc] Failed to register handlers:', e);
    throw e;
  }
}

