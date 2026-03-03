export type PlatformFlags = {
  yt: boolean;
  ig: boolean;
  tt: boolean;
};

export type JobStatus = "Queued" | "Processing" | "Done" | "Error";
export type JobType = "file" | "folder";

export type JobRow = {
  id: number; // from SQLite
  type: JobType;

  filename: string;
  fullPath: string;

  duration: string;
  variant: string;
  status: JobStatus;

  platforms: PlatformFlags;

  ytPublishAtUk: string;

  ytTitle?: string;
  ytDescription?: string;
  ytHashtags?: string;

  createdAt: number;
  updatedAt: number;
};

export const defaultPlatforms: PlatformFlags = { yt: true, ig: true, tt: true };
