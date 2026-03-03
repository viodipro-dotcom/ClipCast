import { contextBridge, ipcRenderer } from "electron";

export type PipelineMode = "files" | "folder";

export type PipelinePayload =
  | { mode: "files"; files: string[] }
  | { mode: "folder"; folder: string };

export type RunResult =
  | { ok: true; runId: string }
  | { ok: false; error: string };

export type PipelineLogEvent = { runId: string; stream: "stdout" | "stderr"; text: string };
export type PipelineExitEvent = { runId: string; code: number };
export type PipelineFileDoneEvent = { runId: string; filePath: string; status?: 'Done' | 'Error' | string; action?: string; at?: number };

export interface Api {
  openFiles(): Promise<string[]>;
  openFolder(): Promise<string | null>;

  runPipeline(payload: PipelinePayload): Promise<RunResult>;
  cancelPipeline(): Promise<{ ok: true } | { ok: false; error: string }>;

  onPipelineLog(cb: (e: PipelineLogEvent) => void): () => void;
  onPipelineExit(cb: (e: PipelineExitEvent) => void): () => void;
  onPipelineFileDone?(cb: (e: PipelineFileDoneEvent) => void): () => void;

  // backward compat
  runRunPipeline?(payload: PipelinePayload): Promise<RunResult>;
}

// (этот файл TS не должен реально исполняться в Electron,
// runtime = preload.cjs)
const api: Api = {
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:runPipeline", payload),
  cancelPipeline: () => ipcRenderer.invoke("pipeline:cancel"),
  onPipelineLog: (cb) => {
    const h = (_: unknown, data: any) => cb(data);
    ipcRenderer.on("pipeline:log", h);
    return () => ipcRenderer.removeListener("pipeline:log", h);
  },
  onPipelineExit: (cb) => {
    const h = (_: unknown, data: any) => cb(data);
    ipcRenderer.on("pipeline:exit", h);
    return () => ipcRenderer.removeListener("pipeline:exit", h);
  },
  onPipelineFileDone: (cb) => {
    const h = (_: unknown, data: any) => cb(data);
    ipcRenderer.on("pipeline:fileDone", h);
    return () => ipcRenderer.removeListener("pipeline:fileDone", h);
  },
  runRunPipeline: (payload) => ipcRenderer.invoke("pipeline:runPipeline", payload),
};

contextBridge.exposeInMainWorld("api", api);
