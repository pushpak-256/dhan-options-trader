import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { UpdateInfo } from '../types/updater';
import { GitHubUpdaterService } from '../services/githubUpdater';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  updateInfo,
  onClose,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!updateInfo) return null;

  const handleStartUpdate = async () => {
    if (!updateInfo.downloadUrl) {
      setErrorMessage('No APK file found in this GitHub Release.');
      return;
    }

    try {
      setDownloading(true);
      setErrorMessage(null);

      await GitHubUpdaterService.downloadAndInstall(
        updateInfo.downloadUrl,
        (percent) => {
          setProgressPercent(percent);
        }
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Update failed to download.');
      setDownloading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>🚀 New Update Available</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>{updateInfo.latestVersion}</Text>
            </View>
          </View>

          <Text style={styles.currentVerText}>
            Current: v{updateInfo.currentVersion} → Latest: {updateInfo.latestVersion}
          </Text>

          <Text style={styles.sectionTitle}>What's New:</Text>
          <ScrollView style={styles.notesContainer}>
            <Text style={styles.notesText}>{updateInfo.releaseNotes}</Text>
          </ScrollView>

          {downloading && (
            <View style={styles.progressSection}>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${progressPercent}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                Downloading APK: {progressPercent}%
              </Text>
            </View>
          )}

          {errorMessage && (
            <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
          )}

          <View style={styles.btnRow}>
            {!downloading && (
              <TouchableOpacity style={styles.laterBtn} onPress={onClose}>
                <Text style={styles.laterBtnText}>Later</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.updateBtn, downloading && styles.btnDisabled]}
              onPress={handleStartUpdate}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator color="#0F172A" size="small" />
              ) : (
                <Text style={styles.updateBtnText}>Update Now</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 16,
  },
  versionBadge: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  versionBadgeText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 11,
  },
  currentVerText: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#CBD5E1',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  notesContainer: {
    maxHeight: 120,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  notesText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  progressSection: {
    marginBottom: 16,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
  },
  progressText: {
    color: '#38BDF8',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginBottom: 12,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  laterBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  laterBtnText: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 13,
  },
  updateBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  updateBtnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },
});
