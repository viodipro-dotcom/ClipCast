/// <reference types="vite/client" />
import type { CustomAiPreset, CustomAiPresetSummary, CustomAiPlatformMap, CustomAiSettings, JobRow } from './types';

export {};

interface ImportMetaEnv {
  // Intentionally empty: desktop app does not use Vite-injected cloud auth
}

export type PipelinePayload = {
  mode: 'files' | 'folder';
  paths: string[];
  variant?: string;
};

export type PipelineRunResult = { runId: string; code?: number; canceled?: boolean; error?: string };

export type PipelineLogMsg = { runId: string; line: string };
export type PipelineFileDoneMsg = {
  runId: string;
  filePath: string;
  status?: 'Done' | 'Error' | string;
  action?: string;
  at?: number;
};

export type DiagnosticsAuthSnapshot = {
  signedIn: boolean;
  userEmail?: string | null;
  plan?: string | null;
  subscriptionStatus?: string | null;
  usage?: {
    uploads_used?: number;
    metadata_used?: number;
    uploads_limit?: number | null;
    metadata_limit?: number | null;
  } | null;
};

export type RendererErrorPayload = {
  type: "errorboundary" | "window.onerror" | "unhandledrejection";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  href?: string;
  hash?: string;
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
      cancelPipeline: (payload?: { runId?: string; reason?: string }) => Promise<{ ok: boolean; canceled?: boolean; count?: number; error?: string }>;
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
      onAssistCenterRefresh: (cb: (data?: any) => void) => () => void;

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
      settingsGet: () => Promise<{
        uiLanguage: string;
        uiLanguageLabel?: string;
        runAtStartup?: boolean;
        openAiCloudTranscript?: boolean;
      }>;
      settingsSet: (payload: {
        uiLanguage?: string;
        uiLanguageLabel?: string;
        runAtStartup?: boolean;
        openAiCloudTranscript?: boolean;
      }) => Promise<{
        uiLanguage: string;
        uiLanguageLabel?: string;
        runAtStartup?: boolean;
        openAiCloudTranscript?: boolean;
      }>;

      // secrets (keytar-backed)
      secretsGetYouTubeTokens: () => Promise<{ ok: boolean; tokens: { redacted: true } | null }>;
      secretsSetYouTubeTokens: (tokens: Record<string, unknown>) => Promise<{ ok: boolean }>;
      secretsClearYouTubeTokens: () => Promise<{ ok: boolean }>;
      secretsGetOpenAIApiKeyStatus: () => Promise<{ ok: true; configured: boolean; hint?: string }>;
      secretsSetOpenAIApiKey: (key: string) => Promise<{ ok: true }>;
      secretsClearOpenAIApiKey: () => Promise<{ ok: true }>;
      secretsGetGoogleOAuthClient: () => Promise<{ ok: boolean; clientId: string | null; hasClientSecret: boolean }>;
      secretsSetGoogleOAuthClient: (clientId: string, clientSecret?: string) => Promise<{ ok: boolean }>;
      secretsClearGoogleOAuthClient: () => Promise<{ ok: boolean }>;

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
          adapters?: Array<{
            name?: string | null;
            vendor?: string | null;
            vram_mb?: number;
            pnp_device_id?: string | null;
            driver_version?: string | null;
            is_nvidia?: boolean;
          }>;
          nvidia_present?: boolean;
          nvidia_gpus?: Array<{
            name?: string | null;
            vram_total_mb?: number;
            driver_version?: string | null;
            compute_capability?: string | null;
          }>;
          cuda_smoke?: {
            ok?: boolean;
            error?: string | null;
            reason?: string | null;
            python?: string | null;
            platform?: string | null;
            ctranslate2_version?: string | null;
            cuda_device_count?: number;
            supported_compute_types?: string[];
            elapsed_ms?: number;
            inference_test?: string;
            inference_error?: string | null;
            inference_model?: string | null;
            dll_check?: {
              status?: string;
              missing?: string[];
              required?: string[];
              optional_missing?: string[];
            };
          } | null;
          cuda_smoke_raw_error?: string | null;
          python_source?: string | null;
          python_exec?: string | null;
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
          adapters?: Array<{
            name?: string | null;
            vendor?: string | null;
            vram_mb?: number;
            pnp_device_id?: string | null;
            driver_version?: string | null;
            is_nvidia?: boolean;
          }>;
          nvidia_present?: boolean;
          nvidia_gpus?: Array<{
            name?: string | null;
            vram_total_mb?: number;
            driver_version?: string | null;
            compute_capability?: string | null;
          }>;
          cuda_smoke?: {
            ok?: boolean;
            error?: string | null;
            reason?: string | null;
            python?: string | null;
            platform?: string | null;
            ctranslate2_version?: string | null;
            cuda_device_count?: number;
            supported_compute_types?: string[];
            elapsed_ms?: number;
            inference_test?: string;
            inference_error?: string | null;
            inference_model?: string | null;
            dll_check?: {
              status?: string;
              missing?: string[];
              required?: string[];
              optional_missing?: string[];
            };
          } | null;
          cuda_smoke_raw_error?: string | null;
          python_source?: string | null;
          python_exec?: string | null;
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
      logRendererError: (payload: RendererErrorPayload) => Promise<{ ok: boolean; path?: string } | { ok: false }>;
      diagnosticsExportSupportBundle: (authSnapshot: DiagnosticsAuthSnapshot) => Promise<
        { ok: true; path: string } | { ok: false; error: string }
      >;
      pathsOpen: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
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
