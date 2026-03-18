/// <reference types="vite/client" />
import type { CustomAiPreset, CustomAiPresetSummary, CustomAiPlatformMap, CustomAiSettings, JobRow } from './types';

export {};

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

export type PipelinePayload = {
  mode: 'files' | 'folder';
  paths: string[];
  variant?: string;
  auth?: { accessToken?: string; functionsUrl?: string };
};

export type PipelineRunResult = { runId: string; code: number };

export type PipelineLogMsg = { runId: string; line: string };
export type PipelineFileDoneMsg = {
  runId: string;
  filePath: string;
  status?: 'Done' | 'Error' | string;
  action?: string;
  at?: number;
};

declare global {
  interface Window {
    clipcast?: {
      openExternal: (url: string) => Promise<{ ok?: boolean; error?: string }>;
      onAuthCallback: (cb: (url: string) => void) => () => void;
      removeAuthCallbackListener?: (unsubscribe: () => void) => void;
    };
    api?: {
      // recommended
      pickVideos: () => Promise<string[]>;

      // legacy
      openFiles: () => Promise<string[]>;
      openFolder: () => Promise<string>;

      runPipeline: (payload: PipelinePayload & { platforms?: ('youtube' | 'instagram' | 'tiktok')[] }) => Promise<PipelineRunResult>;
      onPipelineLog: (cb: (msg: PipelineLogMsg) => void) => () => void;
      onPipelineFileDone: (cb: (msg: PipelineFileDoneMsg) => void) => () => void;

      // outputs / exports
      readOutputsForPath: (filePath: string) => Promise<any>;
      openExportsForPath: (platform: 'youtube' | 'instagram' | 'tiktok', filePath: string) => Promise<{ ok: boolean; openedFolder?: boolean; error?: string; dir?: string }>;
      getExportPathsForRow: (filePath: string) => Promise<{
        ok: boolean;
        platforms?: Record<'youtube' | 'instagram' | 'tiktok', { folder: string; primary: string; allFiles: string[]; hasExport: boolean }>;
        error?: string;
      }>;
      openOutputsRoot: () => Promise<any>;
      deleteMetadataForPlatform: (payload: { filePath: string; platform: 'youtube' | 'instagram' | 'tiktok' }) => Promise<{ ok: boolean; error?: string }>;
      unmarkDeletedMetadata: (payload: { filePath: string; platform: 'youtube' | 'instagram' | 'tiktok' }) => Promise<{ ok: boolean; error?: string }>;
      updatePlatformMetadata: (payload: { filePath: string; platform: 'youtube' | 'instagram' | 'tiktok'; title: string; description: string; hashtags: string }) => Promise<{ ok: boolean; error?: string }>;

      // misc
      copyText: (text: string) => Promise<any>;
      scanVideos: (folderPath: string) => Promise<any>;
      getFileStats: (filePath: string) => Promise<{ ok: boolean; birthtimeMs?: number; mtimeMs?: number; size?: number; error?: string }>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      showItemInFolder: (filePath: string) => Promise<{ ok: boolean; error?: string; notFound?: boolean }>;

      // Jobs & Auto-upload
      jobsLoad: () => Promise<any>;
      jobsSave: (jobs: any) => Promise<any>;
      // library (full file list)
      libraryLoad: () => Promise<{ version?: number; updatedAt?: number; rows?: JobRow[] } | JobRow[]>;
      librarySave: (payload: { version?: number; updatedAt?: number; rows: JobRow[] } | JobRow[]) => Promise<any>;
      autouploadSetEnabled: (enabled: boolean) => Promise<any>;
      autouploadGetEnabled: () => Promise<any>;
      autouploadSetSilentMode: (silent: boolean) => Promise<any>;
      autouploadGetSilentMode: () => Promise<any>;
      autouploadAuthYouTube: () => Promise<any>;
      autouploadTriggerAssist: (payload: { filePath: string; platform: 'youtube' | 'instagram' | 'tiktok' }) => Promise<any>;
      autouploadMarkAsPosted: (payload: { filePath: string; platform: 'youtube' | 'instagram' | 'tiktok' }) => Promise<any>;
      onAutoUploadStatus: (cb: (msg: any) => void) => () => void;

      // Assist Overlay
      assistOverlayNext: () => Promise<{ ok: boolean; error?: string; jobId?: string; platform?: 'instagram' | 'tiktok'; filePath?: string; remaining?: number }>;
      assistOverlayGetCount: () => Promise<{ ok: boolean; count: number; error?: string }>;
      onAssistOverlayCount: (cb: (data: { count: number }) => void) => () => void;

      // Assist Center
      assistCenterGetDueJobs: () => Promise<{ dueNow: any[]; dueSoon: any[]; error?: string }>;
      assistCenterAssistJob: (payload: { jobId: string; platform: 'instagram' | 'tiktok' }) => Promise<{ ok: boolean; error?: string }>;
      assistCenterMarkDone: (payload: { jobId: string; platform: 'instagram' | 'tiktok' }) => Promise<{ ok: boolean; error?: string }>;
      assistCenterSkipJob: (payload: { jobId: string; platform: 'instagram' | 'tiktok' }) => Promise<{ ok: boolean; error?: string; newPublishAtUtcMs?: number }>;

      // templates
      templatesLoad: () => Promise<any[]>;
      templatesSave: (template: any) => Promise<{ ok: boolean; template?: any; error?: string }>;
      templatesDelete: (templateId: string) => Promise<{ ok: boolean; error?: string }>;
      onFocusJob: (cb: (data: { filePath: string; platform: string }) => void) => () => void;

      // metadata settings
      metadataGetCustomInstructions: () => Promise<CustomAiPlatformMap>;
      metadataSetCustomInstructions: (instructions: CustomAiPlatformMap | string) => Promise<CustomAiPlatformMap>;
      metadataGetCustomAiSettings: () => Promise<CustomAiSettings>;
      metadataSetCustomAiSettings: (settings: CustomAiSettings) => Promise<CustomAiSettings>;

      // ui settings
      settingsGet: () => Promise<{ uiLanguage: string; uiLanguageLabel?: string }>;
      settingsSet: (payload: { uiLanguage?: string; uiLanguageLabel?: string }) => Promise<{ uiLanguage: string; uiLanguageLabel?: string }>;

      // secrets (keytar-backed)
      secretsGetYouTubeTokens: () => Promise<{ ok: boolean; tokens: { redacted: true } | null }>;
      secretsSetYouTubeTokens: (tokens: Record<string, unknown>) => Promise<{ ok: boolean }>;
      secretsClearYouTubeTokens: () => Promise<{ ok: boolean }>;
      secretsGetGoogleOAuthClient: () => Promise<{ ok: boolean; clientId: string | null; hasClientSecret: boolean }>;
      secretsSetGoogleOAuthClient: (clientId: string, clientSecret?: string) => Promise<{ ok: boolean }>;
      secretsClearGoogleOAuthClient: () => Promise<{ ok: boolean }>;

      // auth
      authSetSupabaseAccessToken: (token: string, functionsUrl?: string) => Promise<{ ok: boolean }>;

      // outputs folder (Developer Mode)
      getOutputsDir: () => Promise<{ ok: boolean; path: string }>;
      getDefaultOutputsDir: () => Promise<{ ok: boolean; path: string }>;
      pickOutputsDir: () => Promise<{ ok: boolean; path: string | null }>;
      pickPythonPath: () => Promise<{ ok: boolean; path: string | null }>;
      setOutputsDir: (path: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      resetOutputsDir: () => Promise<{ ok: boolean; path: string }>;
      moveOutputsToNewDir: (payload: { fromDir: string; toDir: string; deleteAfterCopy?: boolean }) => Promise<{
        ok: boolean;
        copiedCount?: number;
        copiedBytes?: number;
        deletedCount?: number;
        deleteFailedCount?: number;
        deleteFailedPaths?: string[];
        message?: string;
        error?: string;
      }>;
      getDeveloperOptions: () => Promise<{
        autoCleanupOutputReports: boolean;
        debugMode: boolean;
        autoArchivePosted?: boolean;
        archiveAfterDays?: number;
        autoDeleteArchived?: boolean;
        deleteArchivedAfterDays?: number;
        autoCleanOutputArtifacts?: boolean;
        artifactRetentionDays?: number;
        computeBackendPreference?: 'auto' | 'prefer_gpu' | 'force_cpu';
        pythonPath?: string;
      }>;
      setDeveloperOptions: (payload: {
        autoCleanupOutputReports?: boolean;
        debugMode?: boolean;
        autoArchivePosted?: boolean;
        archiveAfterDays?: number;
        autoDeleteArchived?: boolean;
        deleteArchivedAfterDays?: number;
        autoCleanOutputArtifacts?: boolean;
        artifactRetentionDays?: number;
        computeBackendPreference?: 'auto' | 'prefer_gpu' | 'force_cpu';
        pythonPath?: string;
      }) => Promise<unknown>;
      getComputeBackend: () => Promise<{
        availableGpu: boolean;
        details: {
          python?: string;
          platform?: string;
          torch_installed?: boolean;
          torch_version?: string | null;
          cuda_available?: boolean;
          cuda_version?: string | null;
          gpu_count?: number;
          gpu_name?: string | null;
          vram_total_mb?: number;
          error?: string | null;
        };
        error?: string | null;
        pythonPath?: string;
      }>;
      refreshComputeBackend: () => Promise<{
        availableGpu: boolean;
        details: {
          python?: string;
          platform?: string;
          torch_installed?: boolean;
          torch_version?: string | null;
          cuda_available?: boolean;
          cuda_version?: string | null;
          gpu_count?: number;
          gpu_name?: string | null;
          vram_total_mb?: number;
          error?: string | null;
        };
        error?: string | null;
        pythonPath?: string;
      }>;
      retentionRun: () => Promise<void>;

      // custom ai presets
      presetsList: () => Promise<{ activePresetId: string | null; presets: CustomAiPresetSummary[] }>;
      presetsGet: (id: string) => Promise<CustomAiPreset | null>;
      presetsSave: (preset: Partial<CustomAiPreset>) => Promise<{ ok: boolean; preset?: CustomAiPreset; error?: string }>;
      presetsDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      presetsSetActive: (id: string | null) => Promise<{ ok: boolean; activePresetId?: string | null; error?: string }>;
      presetsApplyToOutputs: (payload: { paths: string[]; platforms?: ('youtube' | 'instagram' | 'tiktok')[] }) => Promise<{ ok: boolean; applied?: boolean; updatedFiles?: number; reason?: string; error?: string }>;

      // YouTube (Node-only googleapis in main process)
      youtubeConnect: () => Promise<any>;
      youtubeIsConnected: () => Promise<{ ok: true; connected: boolean }>;
      youtubeUpload: (payload: {
        filePath: string;
        title: string;
        description?: string;
        tags?: string[] | string;
        publishAt?: number | string | null;
        privacyStatus?: 'private' | 'unlisted' | 'public';
      }) => Promise<any>;
      youtubeOpenUserData: () => Promise<any>;
      youtubeValidateCredentials: () => Promise<any>;

      // app update (electron-updater)
      updateCheck: () => Promise<void>;
      updateDownload: () => Promise<void>;
      updateInstall: () => Promise<void>;
      updateGetStatus: () => Promise<UpdateStatus>;
      updateDismiss: () => Promise<{ ok: boolean; nextPromptAtMs?: number } | { disabled: true; reason?: string }>;
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
    };
  }
}

export type UpdateStatus = {
  state?: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error';
  info?: { version?: string; releaseDate?: string; releaseNotes?: string } | null;
  progress?: { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number } | null;
  error?: string | null;
  disabled?: boolean;
  reason?: string;
};
