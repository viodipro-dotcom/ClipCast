import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = "http://localhost:5173"
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;
let currentProc: ReturnType<typeof spawn> | null = null;

// --- Your pipeline paths
const PIPELINE_DIR = "D:\\Programs\\yt_pipeline";
const RUN_PIPELINE_SCRIPT = path.join(PIPELINE_DIR, "run_pipeline.py");

// Exports folder
const EXPORTS_YT_DIR = path.join(PIPELINE_DIR, "outputs", "Exports", "YouTube");

// JSON DB file (inside project folder)
const DB_PATH = path.join(PIPELINE_DIR, "outputs", "yt_uploader_state.json");

// Prefer direct python from env
const PYTHON_EXE = "C:\\Users\\tribo\\miniconda3\\envs\\yt-gpu\\python.exe";
// Fallback conda
const CONDA_BAT = "C:\\Users\\tribo\\miniconda3\\condabin\\conda.bat";

type JobStatus = "Queued" | "Processing" | "Done" | "Error";
type JobType = "file" | "folder";

type Job = {
  id: number;
  type: JobType;

  filename: string;
  fullPath: string;

  duration: string;
  variant: string;
  status: JobStatus;

  ytPublishAtUk: string;

  platforms: { yt: boolean; ig: boolean; tt: boolean };

  ytTitle?: string;
  ytDescription?: string;
  ytHashtags?: string;

  createdAt: number;
  updatedAt: number;
};

type DbState = {
  version: number;
  nextId: number;
  jobs: Job[];
};

function ensureOutputsDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function loadDb(): DbState {
  ensureOutputsDir();
  if (!fs.existsSync(DB_PATH)) {
    const empty: DbState = { version: 1, nextId: 1, jobs: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const txt = fs.readFileSync(DB_PATH, "utf-8");
    const parsed = JSON.parse(txt) as DbState;
    if (!parsed?.jobs) throw new Error("Bad DB format");
    parsed.version ??= 1;
    parsed.nextId ??= 1;
    return parsed;
  } catch {
    const backup = DB_PATH.replace(/\.json$/i, `.broken_${Date.now()}.json`);
    try {
      fs.copyFileSync(DB_PATH, backup);
    } catch {}
    const empty: DbState = { version: 1, nextId: 1, jobs: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}

function saveDb(state: DbState) {
  ensureOutputsDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function upsertJobFile(state: DbState, fp: string) {
  const fullPath = fp;
  const exists = state.jobs.find((j) => j.fullPath === fullPath);
  if (exists) return;

  const now = Date.now();
  const job: Job = {
    id: state.nextId++,
    type: "file",
    filename: path.basename(fp),
    fullPath,
    duration: "-",
    variant: "-",
    status: "Queued",
    ytPublishAtUk: "",
    platforms: { yt: true, ig: true, tt: true },
    createdAt: now,
    updatedAt: now,
  };
  state.jobs.push(job);
}

function upsertJobFolder(state: DbState, folder: string) {
  const fullPath = folder;
  const exists = state.jobs.find((j) => j.fullPath === fullPath);
  if (exists) return;

  const now = Date.now();
  const job: Job = {
    id: state.nextId++,
    type: "folder",
    filename: `[Folder] ${folder}`,
    fullPath,
    duration: "-",
    variant: "-",
    status: "Queued",
    ytPublishAtUk: "",
    platforms: { yt: true, ig: true, tt: true },
    createdAt: now,
    updatedAt: now,
  };
  state.jobs.push(job);
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// -------------------- dialogs --------------------
ipcMain.handle("dialog:openFiles", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm"] }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

// -------------------- exports read --------------------
ipcMain.handle("exports:readYouTube", async (_evt, payload: { base: string }) => {
  const base = (payload?.base || "").trim();
  if (!base) return { ok: false, error: "Missing base" };

  const jsonPath = path.join(EXPORTS_YT_DIR, `${base}.json`);
  const titlePath = path.join(EXPORTS_YT_DIR, `${base}.title.txt`);
  const descPath = path.join(EXPORTS_YT_DIR, `${base}.description.txt`);
  const tagsPath = path.join(EXPORTS_YT_DIR, `${base}.hashtags.txt`);

  try {
    const readIfExists = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "");

    const jsonText = readIfExists(jsonPath);
    const title = readIfExists(titlePath).trim();
    const description = readIfExists(descPath).trim();
    const hashtags = readIfExists(tagsPath).trim();

    let json: any = null;
    if (jsonText) {
      try {
        json = JSON.parse(jsonText);
      } catch {
        json = null;
      }
    }

    return { ok: true, title, description, hashtags, json };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// -------------------- DB IPC (JSON) --------------------
ipcMain.handle("db:listJobs", async () => {
  try {
    const state = loadDb();
    const rows = [...state.jobs].sort((a, b) => (a.createdAt - b.createdAt) || (a.id - b.id));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("db:addFiles", async (_evt, payload: { files: string[] }) => {
  try {
    const files = (payload?.files || []).filter(Boolean);
    const state = loadDb();
    for (const fp of files) upsertJobFile(state, fp);
    saveDb(state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("db:addFolder", async (_evt, payload: { folder: string }) => {
  try {
    const folder = (payload?.folder || "").trim();
    if (!folder) return { ok: false, error: "Missing folder" };
    const state = loadDb();
    upsertJobFolder(state, folder);
    saveDb(state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("db:updateJob", async (_evt, payload: { id: number; patch: Record<string, any> }) => {
  try {
    const id = Number(payload?.id);
    const patch = payload?.patch || {};
    if (!id) return { ok: false, error: "Missing id" };

    const state = loadDb();
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return { ok: false, error: "Job not found" };

    const allowed = new Set([
      "status",
      "duration",
      "variant",
      "ytPublishAtUk",
      "ytTitle",
      "ytDescription",
      "ytHashtags",
      "platforms",
    ]);

    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue;
      (job as any)[k] = v;
    }

    job.updatedAt = Date.now();
    saveDb(state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("db:deleteJob", async (_evt, payload: { id: number }) => {
  try {
    const id = Number(payload?.id);
    if (!id) return { ok: false, error: "Missing id" };
    const state = loadDb();
    state.jobs = state.jobs.filter((j) => j.id !== id);
    saveDb(state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// -------------------- pipeline --------------------
ipcMain.handle("pipeline:runRunPipeline", async (_evt, payload: { files?: string[]; folder?: string }) => {
  if (!win) throw new Error("Window not ready");
  if (currentProc) return { ok: false, error: "Pipeline is already running" };

  const runId = `${Date.now()}`;

  const sendLog = (stream: "stdout" | "stderr", text: string) => {
    win?.webContents.send("pipeline:log", { runId, stream, text });
  };
  const sendExit = (code: number | null) => {
    win?.webContents.send("pipeline:exit", { runId, code });
  };

  const childEnv = {
    ...process.env,
    KMP_DUPLICATE_LIB_OK: "TRUE",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  };

  const attach = (p: ReturnType<typeof spawn>) => {
    p.stdout?.on("data", (d) => sendLog("stdout", d.toString()));
    p.stderr?.on("data", (d) => sendLog("stderr", d.toString()));
    p.on("close", (code) => {
      currentProc = null;
      sendExit(code ?? -1);
    });
    p.on("error", (err) => {
      sendLog("stderr", `[spawn error] ${String(err)}\n`);
      currentProc = null;
      sendExit(-1);
    });
  };

  const files = (payload?.files || []).filter(Boolean);
  const folder = payload?.folder || "";

  const pyArgs: string[] = ["-u", RUN_PIPELINE_SCRIPT];

  if (files.length > 0) {
    sendLog("stdout", `[runner] mode=files count=${files.length}\n`);
    for (const f of files) pyArgs.push("--video-file", f);
  } else if (folder) {
    sendLog("stdout", `[runner] mode=folder folder=${folder}\n`);
    pyArgs.push("--videos-dir", folder);
  } else {
    return { ok: false, error: "No files or folder provided from UI" };
  }

  if (fs.existsSync(PYTHON_EXE)) {
    sendLog("stdout", `[runner] using env python: ${PYTHON_EXE}\n`);
    const p = spawn(PYTHON_EXE, pyArgs, {
      cwd: PIPELINE_DIR,
      env: childEnv,
      windowsHide: true,
      shell: false,
    });
    currentProc = p;
    attach(p);
    return { ok: true, runId };
  }

  sendLog("stdout", `[runner] env python not found, fallback conda: ${CONDA_BAT}\n`);
  const condaArgs = ["run", "-n", "yt-gpu", "python", ...pyArgs];
  const p = spawn(CONDA_BAT, condaArgs, {
    cwd: PIPELINE_DIR,
    env: childEnv,
    windowsHide: true,
    shell: true,
  });
  currentProc = p;
  attach(p);

  return { ok: true, runId };
});

ipcMain.handle("pipeline:cancel", async () => {
  if (!currentProc) return { ok: true, canceled: false };
  try {
    currentProc.kill();
    currentProc = null;
    return { ok: true, canceled: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

app.whenReady().then(() => {
  createWindow();
});
