export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string; // Release notes
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl?: string;
  assetName?: string;
  fileSizeBytes?: number;
}

export type UpdateProgressCallback = (percent: number, downloadedBytes: number, totalBytes: number) => void;
