import { spawn } from 'node:child_process';

async function isLikelyVite(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes('/@vite/client') || text.toLowerCase().includes('vite');
  } catch {
    return false;
  }
}

async function waitReady(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await isLikelyVite(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  return p;
}

const basePort = Number(process.env.VITE_PORT ?? 5173);
const maxPortsToTry = Number(process.env.VITE_PORT_TRIES ?? 10);

let viteUrl = '';
let viteProc = null;

for (let i = 0; i < maxPortsToTry; i++) {
  const port = basePort + i;
  const url = `http://localhost:${port}`;

  // Reuse existing Vite instance if present.
  if (await isLikelyVite(url)) {
    viteUrl = url;
    break;
  }

  console.log(`[dev] Starting Vite on port ${port}...`);
  viteProc = run('npx', ['vite', '--port', String(port), '--strictPort']);

  const ready = await waitReady(url, 30);
  if (ready) {
    viteUrl = url;
    break;
  }

  console.log(`[dev] Vite not ready on port ${port}, trying next port...`);
  try {
    viteProc.kill();
  } catch {
    // ignore
  }
  viteProc = null;
}

if (!viteUrl) {
  console.error('[dev] Failed to start Vite (no free port found).');
  process.exit(1);
}

console.log(`[dev] Using Vite at ${viteUrl}`);

const electronProc = run(
  'npx',
  ['electron', '.'],
  {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl,
    },
  },
);

const shutdown = () => {
  try { electronProc?.kill(); } catch {}
  try { viteProc?.kill(); } catch {}
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
electronProc.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});

