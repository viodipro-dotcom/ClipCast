import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';

const require = createRequire(import.meta.url);

let viteProcess: ReturnType<typeof spawn> | null = null;

export async function launchApp(): Promise<{ app: ElectronApplication; window: Page }> {
  // Start (or reuse) a Vite dev server.
  // On Windows it's common to already have something on 5173; avoid failing tests in that case.
  const isLikelyVite = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const text = await res.text();
      return text.includes('/@vite/client') || text.toLowerCase().includes('vite');
    } catch {
      return false;
    }
  };

  const tryWaitReady = async (url: string, seconds: number): Promise<boolean> => {
    for (let i = 0; i < seconds; i++) {
      if (await isLikelyVite(url)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };

  let viteUrl = '';
  const basePort = 5173;
  const maxPortsToTry = 10;

  for (let i = 0; i < maxPortsToTry; i++) {
    const port = basePort + i;
    const url = `http://localhost:${port}`;

    // If something is already running and looks like Vite, reuse it.
    if (await isLikelyVite(url)) {
      viteUrl = url;
      break;
    }

    // Otherwise, try starting Vite on this port (strict so we know the final URL).
    console.log(`[E2E] Starting Vite dev server on port ${port}...`);
    const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      shell: true,
      stdio: 'pipe',
    });
    viteProcess = proc;

    const exitedEarly = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 500);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    if (exitedEarly) {
      // Port likely in use or Vite failed; try next port.
      viteProcess = null;
      continue;
    }

    const ready = await tryWaitReady(url, 30);
    if (ready) {
      console.log('[E2E] Vite dev server ready');
      viteUrl = url;
      break;
    }

    // Not ready; stop and try next port.
    try {
      proc.kill();
    } catch {
      // ignore
    }
    viteProcess = null;
  }

  if (!viteUrl) {
    throw new Error('Vite dev server failed to start (no free port found)');
  }

  // Launch Electron app
  const electronPath = require('electron') as string;
  const mainPath = path.join(process.cwd(), 'electron', 'main.mjs');

  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: {
      ...process.env,
      E2E_TEST: '1',
      VITE_DEV_SERVER_URL: viteUrl,
      NODE_ENV: 'test',
      // Guide screenshots: seed mode so getFileStats stubs e2e-seed paths (no OS file picker)
      ...(process.env.GENERATE_GUIDE === '1' ? { E2E_SEED: '1' } : {}),
    },
  });

  const window = await app.firstWindow();
  // Wait longer for React app to load
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(3000); // Give React time to render
  
  return { app, window };
}

export async function closeApp(app: ElectronApplication) {
  await app.close();
  if (viteProcess) {
    viteProcess.kill();
    viteProcess = null;
  }
}
