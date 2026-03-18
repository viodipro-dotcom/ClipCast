/**
 * Update service: wires electron-updater to IPC and main window status events.
 * Only active when app.isPackaged; in dev all methods no-op and getStatus returns disabled.
 */
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;
import log from 'electron-log';

let getMainWindow = () => null;
let isPackaged = false;

const state = {
  state: 'idle',
  info: null,
  progress: null,
  error: null,
};

function isNoPublishedVersionsError(err) {
  const msg = String(err?.message ?? err ?? '');
  return msg.toLowerCase().includes('no published versions on github');
}

function isNoPublishedVersionsLogEntry(args) {
  const combined = (Array.isArray(args) ? args : [])
    .map((arg) => String(arg?.message ?? arg ?? ''))
    .join(' ');
  return isNoPublishedVersionsError(combined);
}

function sendStatus(payload) {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed() && win.webContents) {
    try {
      win.webContents.send('update:status', { ...state, ...payload });
    } catch {
      // ignore
    }
  }
  Object.assign(state, payload);
}

function init(autoUpdaterConfig) {
  const { getWindow, packaged } = autoUpdaterConfig ?? {};
  getMainWindow = typeof getWindow === 'function' ? getWindow : () => null;
  isPackaged = Boolean(packaged);

  if (!isPackaged) {
    return;
  }

  autoUpdater.logger = {
    info: (...args) => log.info?.(...args),
    warn: (...args) => log.warn?.(...args),
    error: (...args) => {
      if (isNoPublishedVersionsLogEntry(args)) return;
      log.error?.(...args);
    },
    debug: (...args) => log.debug?.(...args),
  };
  if (log.transports?.file) {
    log.transports.file.level = 'info';
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking', info: null, progress: null, error: null });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({
      state: 'available',
      info: info ? { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes } : null,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'none', info: null, progress: null, error: null });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      state: 'downloading',
      progress: progress
        ? {
            percent: progress.percent,
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
          }
        : null,
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    sendStatus({ state: 'ready', progress: null, error: null });
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message ?? String(err);
    log.warn?.('[updater] error', msg);
    sendStatus({
      state: 'error',
      error: msg,
      progress: null,
    });
  });
}

function check() {
  if (!isPackaged) return;
  try {
    const maybePromise = autoUpdater.checkForUpdates();
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.catch((e) => {
        const msg = e?.message ?? String(e);
        log.warn?.('[updater] checkForUpdates failed', msg);
        sendStatus({ state: 'error', error: msg });
      });
    }
  } catch (e) {
    const msg = e?.message ?? String(e);
    log.warn?.('[updater] checkForUpdates threw', msg);
    sendStatus({ state: 'error', error: msg });
  }
}

function download() {
  if (!isPackaged) return;
  try {
    autoUpdater.downloadUpdate();
  } catch (e) {
    sendStatus({ state: 'error', error: e?.message ?? String(e) });
  }
}

function install() {
  if (!isPackaged) return;
  try {
    autoUpdater.quitAndInstall();
  } catch (e) {
    sendStatus({ state: 'error', error: e?.message ?? String(e) });
  }
}

function getStatus() {
  if (!isPackaged) {
    return { disabled: true, reason: 'dev' };
  }
  return { ...state };
}

export { init, check, download, install, getStatus };
