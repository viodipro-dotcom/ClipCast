/**
 * Bundled Python runtime resolution and smoke test for packaged ClipCast.
 * Tries known layout candidates and (in dev) falls back to "python" from PATH.
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { app } from 'electron';

/**
 * Candidate order for bundled Python (packaged):
 * A) resources/python/python.exe
 * B) resources/python/Scripts/python.exe
 * C) resources/python/pythonw.exe
 * D) (dev only) "python" from PATH
 */
function getBundledCandidates() {
  const base = process.resourcesPath || '';
  return [
    path.join(base, 'python', 'python.exe'),
    path.join(base, 'python', 'Scripts', 'python.exe'),
    path.join(base, 'python', 'pythonw.exe'),
  ];
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Resolve the Python executable to use for the pipeline.
 * Logs resourcesPath, chosen path, and each candidate with existence.
 * @returns {string} Absolute path to python exe, or "python" in dev if no bundle found
 * @throws {Error} In packaged mode if no candidate exists
 */
export function resolveBundledPythonExe() {
  const resourcesPath = process.resourcesPath || '';
  const candidates = getBundledCandidates();
  const results = candidates.map((p) => ({ path: p, exists: fileExists(p) }));

  console.log('[pythonRuntime] process.resourcesPath =', resourcesPath);
  results.forEach((r) => {
    console.log('[pythonRuntime] candidate', r.path, 'exists =', r.exists);
  });

  for (const r of results) {
    if (r.exists) {
      console.log('[pythonRuntime] chosen path =', r.path);
      return r.path;
    }
  }

  if (!app.isPackaged) {
    const fallback = 'python';
    console.log('[pythonRuntime] no bundle found (dev); using PATH fallback:', fallback);
    return fallback;
  }

  const tried = results.map((r) => r.path).join(', ');
  throw new Error(
    `Bundled Python not found. Tried: ${tried}. resourcesPath=${resourcesPath}`
  );
}

/**
 * Smoke test: run python -c "import sys; print(sys.executable)".
 * @returns {Promise<{ ok: boolean, error?: string, stdout?: string, stderr?: string, code?: number }>}
 */
export function runPythonSmokeTest(pythonExe) {
  return new Promise((resolve) => {
    const args = ['-c', 'import sys; print(sys.executable)'];
    const child = spawn(pythonExe, args, {
      windowsHide: true,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: String(err?.message ?? err),
        code: err?.code,
        stdout,
        stderr,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `exit code ${code}`,
          code,
          stdout,
          stderr,
        });
      } else {
        resolve({ ok: true, stdout, stderr });
      }
    });
  });
}

/**
 * Write diagnostics to userData/logs/python_runtime_diagnostics.log
 */
export function writePythonDiagnosticsLog(payload) {
  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'python_runtime_diagnostics.log');
    const lines = [
      new Date().toISOString(),
      '---',
      typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload),
      '',
    ];
    fs.appendFileSync(logPath, lines.join('\n'), 'utf8');
    return logPath;
  } catch (e) {
    console.error('[pythonRuntime] Failed to write diagnostics log', e);
    return null;
  }
}
