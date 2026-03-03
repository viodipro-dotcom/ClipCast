export type JobStatus = 'Ready' | 'Processing' | 'Done' | 'Error' | 'Assist' | 'Info';
export type Visibility = 'private' | 'unlisted' | 'public';
export type PublishMode = 'now' | 'schedule';
export type PublishSource = 'auto' | 'manual';
export type MetaPlatform = 'youtube' | 'instagram' | 'tiktok';
export type MetaSource = 'exports' | 'metadata' | 'none';
export type CustomAiPlatformMap = { all: string; youtube: string; instagram: string; tiktok: string };

export type AutoUploadStatusMsg = {
  id: string;
  platform: MetaPlatform;
  status: JobStatus;
  message?: string;
};

export type JobRow = {
  id: string;
  filePath: string;
  filename: string;
  status: JobStatus;
  visibility: Visibility;
  selfDeclaredMadeForKids?: boolean;
  publishMode: PublishMode;
  publishAt?: number | null; // epoch ms UTC
  publishSource: PublishSource;
  log: string;
  createdAt?: number; // File creation date (timestamp in ms)
  addedAt: number; // When the file was added to the list (timestamp in ms)
  // Loaded from yt_pipeline/outputs after the pipeline finishes
  meta?: {
    byPlatform?: Partial<Record<MetaPlatform, { title?: string; description?: string; hashtags?: string; source?: MetaSource; dir?: string }>>;
    raw?: any;
  };

  // Auto-upload targets (used by background scheduler)
  targets?: { youtube: boolean; instagram: boolean; tiktok: boolean };
  // Upload status per platform (optional UI feedback)
  upload?: Partial<Record<MetaPlatform, { status?: JobStatus; message?: string; updatedAt?: number }>>;

  // Data retention (app-only): row hidden from main list when set; does not delete files or uploads
  archivedAt?: number | null;
};

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export type MetadataTemplate = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  platforms: Partial<Record<MetaPlatform, { title?: string; description?: string; hashtags?: string }>>;
};

export type CustomAiPreset = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  instructions: CustomAiPlatformMap;
  descriptionTemplate: CustomAiPlatformMap;
  blocks: {
    cta: CustomAiPlatformMap;
    links: CustomAiPlatformMap;
    disclaimer: CustomAiPlatformMap;
  };
};

export type CustomAiSettings = {
  customInstructions: CustomAiPlatformMap;
  descriptionTemplate: CustomAiPlatformMap;
  blocks: {
    cta: CustomAiPlatformMap;
    links: CustomAiPlatformMap;
    disclaimer: CustomAiPlatformMap;
  };
};

export type CustomAiPresetSummary = {
  id: string;
  name: string;
  updatedAt: number;
};
