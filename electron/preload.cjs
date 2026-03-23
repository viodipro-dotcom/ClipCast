const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // recommended: one button (file or folder)
  pickVideos: () => ipcRenderer.invoke('dialog:pickVideos'),

  // legacy (keep so nothing breaks)
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  scanVideos: (folder) => ipcRenderer.invoke('fs:scanVideos', folder),

  // pipeline
  runPipeline: (payload) => ipcRenderer.invoke('pipeline:runPipeline', payload),

  // outputs / exports
  readOutputsForPath: (filePath) => ipcRenderer.invoke('outputs:readForPath', filePath),
  openExportsForPath: (platform, filePath) =>
    ipcRenderer.invoke('outputs:openExportsForPath', { platform, filePath }),
  getExportPathsForRow: (filePath) => ipcRenderer.invoke('outputs:getExportPathsForRow', filePath),
  openOutputsRoot: () => ipcRenderer.invoke('outputs:openRoot'),
  deleteMetadataForPlatform: (payload) => ipcRenderer.invoke('outputs:deletePlatform', payload),
  unmarkDeletedMetadata: (payload) => ipcRenderer.invoke('outputs:unmarkDeleted', payload),
  updatePlatformMetadata: (payload) => ipcRenderer.invoke('outputs:updatePlatformMetadata', payload),

  // misc
  copyText: async (text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  },
      getFileStats: (filePath) => ipcRenderer.invoke('fs:getFileStats', filePath),
      openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
      showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  // YouTube (Node-only googleapis in main)
  youtubeConnect: () => ipcRenderer.invoke('youtube:connect'),
  youtubeIsConnected: () => ipcRenderer.invoke('youtube:isConnected'),
  youtubeUpload: (payload) => ipcRenderer.invoke('youtube:upload', payload),
  youtubeOpenUserData: () => ipcRenderer.invoke('youtube:openUserData'),
  youtubeValidateCredentials: () => ipcRenderer.invoke('youtube:validateCredentials'),

  // auto-upload
  jobsSave: (jobs) => ipcRenderer.invoke('jobs:save', jobs),
  jobsLoad: () => ipcRenderer.invoke('jobs:load'),
  autouploadSetEnabled: (enabled) => ipcRenderer.invoke('autoupload:setEnabled', enabled),
  autouploadGetEnabled: () => ipcRenderer.invoke('autoupload:getEnabled'),
  autouploadSetSilentMode: (silent) => ipcRenderer.invoke('autoupload:setSilentMode', silent),
  autouploadGetSilentMode: () => ipcRenderer.invoke('autoupload:getSilentMode'),
  autouploadAuthYouTube: () => ipcRenderer.invoke('autoupload:authYouTube'),
  autouploadTriggerAssist: (payload) => ipcRenderer.invoke('autoupload:triggerAssist', payload),
  autouploadMarkAsPosted: (payload) => ipcRenderer.invoke('autoupload:markAsPosted', payload),

  // assist overlay
  assistOverlayNext: () => ipcRenderer.invoke('assistoverlay:next'),
  assistOverlayGetCount: () => ipcRenderer.invoke('assistoverlay:getCount'),
  onAssistOverlayCount: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('assistoverlay:count', handler);
    return () => ipcRenderer.removeListener('assistoverlay:count', handler);
  },

  // templates
  templatesLoad: () => ipcRenderer.invoke('templates:load'),
  templatesSave: (template) => ipcRenderer.invoke('templates:save', template),
  templatesDelete: (templateId) => ipcRenderer.invoke('templates:delete', templateId),

  // metadata settings
  metadataGetCustomInstructions: () => ipcRenderer.invoke('metadata:getCustomInstructions'),
  metadataSetCustomInstructions: (instructions) => ipcRenderer.invoke('metadata:setCustomInstructions', instructions),
  metadataGetCustomAiSettings: () => ipcRenderer.invoke('metadata:getCustomAiSettings'),
  metadataSetCustomAiSettings: (settings) => ipcRenderer.invoke('metadata:setCustomAiSettings', settings),

  // ui settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (payload) => ipcRenderer.invoke('settings:set', payload),

  // secrets (keytar-backed)
  secretsGetYouTubeTokens: () => ipcRenderer.invoke('secrets:getYouTubeTokens'),
  secretsSetYouTubeTokens: (tokens) => ipcRenderer.invoke('secrets:setYouTubeTokens', tokens),
  secretsClearYouTubeTokens: () => ipcRenderer.invoke('secrets:clearYouTubeTokens'),
  secretsGetGoogleOAuthClient: () => ipcRenderer.invoke('secrets:getGoogleOAuthClient'),
  secretsSetGoogleOAuthClient: (clientId, clientSecret) =>
    ipcRenderer.invoke('secrets:setGoogleOAuthClient', clientId, clientSecret),
  secretsClearGoogleOAuthClient: () => ipcRenderer.invoke('secrets:clearGoogleOAuthClient'),

  // auth
  authSetSupabaseAccessToken: (token, functionsUrl) =>
    ipcRenderer.invoke('auth:setSupabaseAccessToken', token, functionsUrl),
  logRendererError: (payload) => ipcRenderer.invoke('renderer:logError', payload),

  // outputs folder (Developer Mode)
  getOutputsDir: () => ipcRenderer.invoke('settings:getOutputsDir'),
  getDefaultOutputsDir: () => ipcRenderer.invoke('settings:getDefaultOutputsDir'),
  pickOutputsDir: () => ipcRenderer.invoke('settings:pickOutputsDir'),
  pickPythonPath: () => ipcRenderer.invoke('settings:pickPythonPath'),
  setOutputsDir: (path) => ipcRenderer.invoke('settings:setOutputsDir', path),
  resetOutputsDir: () => ipcRenderer.invoke('settings:resetOutputsDir'),
  moveOutputsToNewDir: (payload) => ipcRenderer.invoke('settings:moveOutputsToNewDir', payload),
  getDeveloperOptions: () => ipcRenderer.invoke('settings:getDeveloperOptions'),
  setDeveloperOptions: (payload) => ipcRenderer.invoke('settings:setDeveloperOptions', payload),
  getComputeBackend: () => ipcRenderer.invoke('settings:getComputeBackend'),
  refreshComputeBackend: () => ipcRenderer.invoke('settings:refreshComputeBackend'),
  retentionRun: () => ipcRenderer.invoke('retention:run'),

  // custom ai presets
  presetsList: () => ipcRenderer.invoke('customai:presets:list'),
  presetsGet: (id) => ipcRenderer.invoke('customai:presets:get', id),
  presetsSave: (preset) => ipcRenderer.invoke('customai:presets:save', preset),
  presetsDelete: (id) => ipcRenderer.invoke('customai:presets:delete', id),
  presetsSetActive: (id) => ipcRenderer.invoke('customai:presets:setActive', id),
  presetsApplyToOutputs: (payload) => ipcRenderer.invoke('customai:presets:applyToOutputs', payload),

  // row prefs (targets/visibility without creating jobs)
  rowPrefsLoad: () => ipcRenderer.invoke('rowprefs:load'),
  rowPrefsSave: (prefs) => ipcRenderer.invoke('rowprefs:save', prefs),
  // library (full file list)
  libraryLoad: () => ipcRenderer.invoke('library:load'),
  librarySave: (payload) => ipcRenderer.invoke('library:save', payload),

  onAutoUploadStatus: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('autoupload:status', handler);
    return () => ipcRenderer.removeListener('autoupload:status', handler);
  },

  onFocusJob: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('autoupload:focusJob', handler);
    return () => ipcRenderer.removeListener('autoupload:focusJob', handler);
  },

  // logs
  onPipelineLog: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('pipeline:log', handler);
    return () => ipcRenderer.removeListener('pipeline:log', handler);
  },
  onPipelineFileDone: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('pipeline:fileDone', handler);
    return () => ipcRenderer.removeListener('pipeline:fileDone', handler);
  },

  // assist center
  assistCenterGetDueJobs: () => ipcRenderer.invoke('assistcenter:getDueJobs'),
  assistCenterAssistJob: (payload) => ipcRenderer.invoke('assistcenter:assistJob', payload),
  assistCenterMarkDone: (payload) => ipcRenderer.invoke('assistcenter:markDone', payload),
  assistCenterSkipJob: (payload) => ipcRenderer.invoke('assistcenter:skipJob', payload),
  onAssistCenterRefresh: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('assistcenter:refresh', handler);
    return () => ipcRenderer.removeListener('assistcenter:refresh', handler);
  },

  // deep link (clipcast://auth/callback) for browser login flow — channel: "auth:deep-link"
  onAuthDeepLink: (cb) => {
    const handler = (_event, url) => cb(url);
    ipcRenderer.on('auth:deep-link', handler);
    return () => ipcRenderer.removeListener('auth:deep-link', handler);
  },

  // app update (electron-updater)
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateGetStatus: () => ipcRenderer.invoke('update:getStatus'),
  updateDismiss: () => ipcRenderer.invoke('update:dismiss'),
  diagnosticsExportSupportBundle: (authSnapshot) =>
    ipcRenderer.invoke('diagnostics:exportSupportBundle', authSnapshot),
  pathsOpen: (targetPath) => ipcRenderer.invoke('paths:open', targetPath),
  onUpdateStatus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
});

// Auth / OAuth: open external URL + receive deep link callback (channel: auth:callback)
contextBridge.exposeInMainWorld('clipcast', {
  openExternal: (url) => ipcRenderer.invoke('auth:openExternal', url),
  onAuthCallback: (cb) => {
    const handler = (_event, url) => cb(url);
    ipcRenderer.on('auth:callback', handler);
    return () => ipcRenderer.removeListener('auth:callback', handler);
  },
  removeAuthCallbackListener: (unsubscribe) => {
    if (typeof unsubscribe === 'function') unsubscribe();
  },
});
