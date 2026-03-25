/* electron/preload.mjs */
/* eslint-disable @typescript-eslint/no-var-requires */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // dialogs
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),

  // pipeline
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:runPipeline", payload),
  cancelPipeline: (payload) => ipcRenderer.invoke("pipeline:cancel", payload),

  // events
  onPipelineLog: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("pipeline:log", handler);
    return () => ipcRenderer.removeListener("pipeline:log", handler);
  },

  onPipelineExit: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("pipeline:exit", handler);
    return () => ipcRenderer.removeListener("pipeline:exit", handler);
  },
  onPipelineFileDone: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("pipeline:fileDone", handler);
    return () => ipcRenderer.removeListener("pipeline:fileDone", handler);
  },

  onAuthDeepLink: (cb) => {
    const handler = (_evt, url) => cb(url);
    ipcRenderer.on("auth:deep-link", handler);
    return () => ipcRenderer.removeListener("auth:deep-link", handler);
  },
});
