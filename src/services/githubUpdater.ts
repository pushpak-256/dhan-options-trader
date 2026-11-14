import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import axios from 'axios';
import { GitHubRelease, UpdateInfo, UpdateProgressCallback } from '../types/updater';
import { StorageService } from './storage';
import Constants from 'expo-constants';

export class GitHubUpdaterService {
  static getCurrentVersion(): string {
    return Constants.expoConfig?.version || '1.0.0';
  }

  static async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();
    const repo = await StorageService.getGitHubRepo();

    try {
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const response = await axios.get<GitHubRelease>(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 10000,
      });

      const release = response.data;
      const latestTag = release.tag_name.replace(/^v/, ''); // Clean "v1.0.1" -> "1.0.1"
      const hasUpdate = this.compareVersions(latestTag, currentVersion) > 0;

      // Find APK asset
      const apkAsset = release.assets.find(
        (asset) => asset.name.endsWith('.apk') || asset.content_type === 'application/vnd.android.package-archive'
      );

      return {
        hasUpdate,
        currentVersion,
        latestVersion: release.tag_name,
        releaseNotes: release.body || 'Performance enhancements and bug fixes.',
        downloadUrl: apkAsset?.browser_download_url,
        assetName: apkAsset?.name,
        fileSizeBytes: apkAsset?.size,
      };
    } catch (error) {
      console.warn('GitHub update check failed (might be offline or private repo):', error);
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseNotes: '',
      };
    }
  }

  static async downloadAndInstall(
    downloadUrl: string,
    onProgress?: UpdateProgressCallback
  ): Promise<boolean> {
    if (Platform.OS !== 'android') {
      throw new Error('Auto-update via APK is only supported on Android devices.');
    }

    try {
      const destination = `${FileSystem.cacheDirectory}update.apk`;

      // Remove existing temp apk if exists
      const fileInfo = await FileSystem.getInfoAsync(destination);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(destination);
      }

      // Download with progress callback
      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        destination,
        {},
        (downloadProgress) => {
          if (onProgress && downloadProgress.totalBytesExpectedToWrite > 0) {
            const percent = Math.round(
              (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
            );
            onProgress(
              percent,
              downloadProgress.totalBytesWritten,
              downloadProgress.totalBytesExpectedToWrite
            );
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error('Download failed: file URI was empty.');
      }

      // Get content URI for Android Package Installer
      const contentUri = await FileSystem.getContentUriAsync(result.uri);

      // Launch native Android installer
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.android.package-archive',
      });

      return true;
    } catch (err) {
      console.error('Failed to download/install APK update:', err);
      throw err;
    }
  }

  // Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
  private static compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/^v/, '').split('.').map(Number);
    const clean2 = v2.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(clean1.length, clean2.length); i++) {
      const num1 = clean1[i] || 0;
      const num2 = clean2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }
}
