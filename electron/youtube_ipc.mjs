import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { connect, isConnected, uploadVideo, loadClientCredentials } from './youtube.mjs';

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
      // E2E_TEST mode: return deterministic value
      if (process.env.E2E_TEST === '1') {
        return { ok: true, connected: process.env.E2E_REAL_YT === '1' ? isConnected() : false };
      }
      return { ok: true, connected: isConnected() };
    });
    console.log('[youtube-ipc] Registered: youtube:isConnected');

    ipcMain.handle('youtube:upload', async (_e, payload) => {
      // E2E_TEST mode: fake upload (log but don't call Google API)
      if (process.env.E2E_TEST === '1' && process.env.E2E_REAL_YT !== '1') {
        log(`[E2E_TEST] Fake YouTube upload for: ${payload?.filePath || 'unknown'}`);
        log(`[E2E_TEST] Title: ${payload?.title || 'N/A'}`);
        // Return fake success
        return { ok: true, videoId: `e2e-test-${Date.now()}` };
      }
      const res = await uploadVideo(payload, { log, appRoot, outputsDir });
      return res;
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
        const creds = loadClientCredentials();
        const userDataPath = app.getPath('userData');
        const credsPath = path.join(userDataPath, 'google_oauth_client.json');
        const fileExists = fs.existsSync(credsPath);
        
        return {
          ok: true,
          hasCredentials: true,
          clientIdPrefix: creds.clientId.slice(0, 30) + '...',
          clientIdValid: creds.clientId.includes('.apps.googleusercontent.com'),
          filePath: credsPath,
          fileExists,
          message: fileExists 
            ? `Credentials loaded from ${credsPath}` 
            : `Credentials loaded from environment variables`,
        };
      } catch (e) {
        const userDataPath = app.getPath('userData');
        const credsPath = path.join(userDataPath, 'google_oauth_client.json');
        const fileExists = fs.existsSync(credsPath);
        
        return {
          ok: false,
          hasCredentials: false,
          error: String(e?.message || e),
          filePath: credsPath,
          fileExists,
          message: fileExists
            ? `File exists but credentials invalid: ${String(e?.message || e)}`
            : `Credentials file not found at ${credsPath}`,
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

