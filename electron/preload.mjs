/* electron/preload.mjs */
/* eslint-disable @typescript-eslint/no-var-requires */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // dialogs
  openFiles: () => ipcRenderer.invoke("dialog:openFiles"),
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),

  // pipeline
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:runPipeline", payload),
  cancelPipeline: () => ipcRenderer.invoke("pipeline:cancel"),

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
});
