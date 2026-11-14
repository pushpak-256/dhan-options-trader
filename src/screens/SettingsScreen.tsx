import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { StorageService } from '../services/storage';
import { DhanApiService } from '../services/dhanApi';
import { GitHubUpdaterService } from '../services/githubUpdater';
import { DhanCredentials, DhanProfile, DhanFundLimit } from '../types/dhan';
import { UpdateInfo } from '../types/updater';

interface SettingsScreenProps {
  onCredentialsUpdated: () => void;
  onOpenUpdateModal: (info: UpdateInfo) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onCredentialsUpdated,
  onOpenUpdateModal,
}) => {
  const [clientId, setClientId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [profile, setProfile] = useState<DhanProfile | null>(null);
  const [funds, setFunds] = useState<DhanFundLimit | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const creds = await StorageService.getCredentials();
    const repo = await StorageService.getGitHubRepo();
    setGithubRepo(repo);

    if (creds) {
      setClientId(creds.clientId || '');
      setAccessToken(creds.accessToken || '');
      setIsDemoMode(creds.isDemoMode ?? false);
    }

    try {
      const prof = await DhanApiService.getProfile();
      const f = await DhanApiService.getFundLimits();
      setProfile(prof);
      setFunds(f);
    } catch {}
  };

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !accessToken.trim()) {
      Alert.alert('Missing Fields', 'Please provide both Dhan Client ID and Access Token.');
      return;
    }

    try {
      setLoading(true);
      const newCreds: DhanCredentials = {
        clientId: clientId.trim(),
        accessToken: accessToken.trim(),
        isDemoMode: false,
      };

      await StorageService.saveCredentials(newCreds);

      // Verify with profile API
      const prof = await DhanApiService.getProfile();
      const f = await DhanApiService.getFundLimits();
      setProfile(prof);
      setFunds(f);
      setIsDemoMode(false);

      Alert.alert(
        'Connected Successfully!',
        `Welcome ${prof.clientName}!\nClient ID: ${prof.dhanClientId}`
      );
      onCredentialsUpdated();
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'Check your Client ID and Access Token.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchToDemo = async () => {
    await StorageService.saveCredentials({
      clientId: 'DEMO_USER',
      accessToken: '',
      isDemoMode: true,
    });
    setIsDemoMode(true);
    setProfile(null);
    setFunds(null);
    Alert.alert('Demo Mode Active', 'You are now in simulation mode.');
    onCredentialsUpdated();
  };

  const handleSaveRepo = async () => {
    if (!githubRepo.trim()) return;
    await StorageService.saveGitHubRepo(githubRepo);
    Alert.alert('Saved', `GitHub Releases repo updated to ${githubRepo.trim()}`);
  };

  const handleCheckUpdate = async () => {
    try {
      setCheckingUpdate(true);
      const info = await GitHubUpdaterService.checkForUpdates();
      if (info.hasUpdate) {
        onOpenUpdateModal(info);
      } else {
        Alert.alert(
          'App is Up to Date!',
          `You are running the latest version (v${info.currentVersion}).`
        );
      }
    } catch {
      Alert.alert('Check Failed', 'Could not reach GitHub Releases API.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account & Settings</Text>
        <Text style={styles.headerDesc}>
          BYOK (Bring Your Own Key) architecture: Your credentials are encrypted and stored solely on your device.
        </Text>
      </View>

      {/* Account Status Card */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.cardTitle}>Dhan Connection</Text>
          <View
            style={[
              styles.badge,
              isDemoMode ? styles.badgeDemo : styles.badgeLive,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                isDemoMode ? styles.textAmber : styles.textGreen,
              ]}
            >
              {isDemoMode ? 'SIMULATED DEMO' : 'LIVE CONNECTED'}
            </Text>
          </View>
        </View>

        {profile && !isDemoMode && (
          <View style={styles.profileDetails}>
            <Text style={styles.clientName}>{profile.clientName}</Text>
            <Text style={styles.clientId}>ID: {profile.dhanClientId}</Text>
            {funds && (
              <View style={styles.fundsRow}>
                <View>
                  <Text style={styles.fundLabel}>Avail Margin</Text>
                  <Text style={styles.fundVal}>
                    ₹{funds.availMargin.toLocaleString('en-IN')}
                  </Text>
                </View>
                <View>
                  <Text style={styles.fundLabel}>Cash Balance</Text>
                  <Text style={styles.fundVal}>
                    ₹{funds.cashBalance.toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* BYOK Inputs */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dhan API Credentials</Text>
        <Text style={styles.inputHelp}>
          Log in to web.dhan.co ➔ Profile ➔ DhanHQ APIs & Access Token ➔ Generate 30-day token.
        </Text>

        <Text style={styles.label}>Dhan Client ID</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 1000123456"
          placeholderTextColor="#64748B"
          value={clientId}
          onChangeText={setClientId}
        />

        <Text style={styles.label}>Access Token (JWT)</Text>
        <TextInput
          style={[styles.input, styles.tokenInput]}
          placeholder="Paste access token here..."
          placeholderTextColor="#64748B"
          value={accessToken}
          onChangeText={setAccessToken}
          secureTextEntry
        />

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSaveCredentials}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text style={styles.saveBtnText}>Connect Live Account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.demoBtn}
            onPress={handleSwitchToDemo}
          >
            <Text style={styles.demoBtnText}>Use Demo Mode</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* GitHub In-App Auto-Updater */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>GitHub Releases APK Updater</Text>
        <Text style={styles.inputHelp}>
          Friends get one-tap in-app updates whenever a new APK is published on your GitHub repository.
        </Text>

        <Text style={styles.label}>GitHub Repo (owner/repo)</Text>
        <View style={styles.repoInputRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="owner/repo"
            placeholderTextColor="#64748B"
            value={githubRepo}
            onChangeText={setGithubRepo}
          />
          <TouchableOpacity style={styles.repoSaveBtn} onPress={handleSaveRepo}>
            <Text style={styles.repoSaveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.updateCheckBtn}
          onPress={handleCheckUpdate}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.updateCheckBtnText}>
              Check for Updates (Current v{GitHubUpdaterService.getCurrentVersion()})
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 14,
  },
  header: {
    marginBottom: 14,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontWeight: '900',
    fontSize: 18,
  },
  headerDesc: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeLive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeDemo: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  textGreen: {
    color: '#10B981',
  },
  textAmber: {
    color: '#F59E0B',
  },
  profileDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  clientName: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  clientId: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  fundsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 10,
  },
  fundLabel: {
    color: '#94A3B8',
    fontSize: 10,
  },
  fundVal: {
    color: '#38BDF8',
    fontWeight: '800',
    fontSize: 14,
    marginTop: 1,
  },
  inputHelp: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
  },
  label: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
    fontSize: 13,
  },
  tokenInput: {
    fontSize: 12,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  saveBtn: {
    flex: 2,
    backgroundColor: '#38BDF8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
  demoBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoBtnText: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 12,
  },
  repoInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  repoSaveBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
  },
  repoSaveBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  updateCheckBtn: {
    marginTop: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  updateCheckBtnText: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 12,
  },
});
