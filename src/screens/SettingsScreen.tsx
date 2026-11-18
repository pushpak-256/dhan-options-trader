import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { StorageService } from '../services/storage';
import { DhanApiService } from '../services/dhanApi';
import { DhanAuthService } from '../services/dhanAuthService';
import { GitHubUpdaterService } from '../services/githubUpdater';
import { DhanLoginModal } from '../components/DhanLoginModal';
import {
  DhanCredentials,
  DhanAppConfig,
  DhanProfile,
  DhanFundLimit,
} from '../types/dhan';
import { UpdateInfo } from '../types/updater';

interface SettingsScreenProps {
  onCredentialsUpdated: () => void;
  onOpenUpdateModal: (info: UpdateInfo) => void;
}

type AuthTab = 'OAUTH' | 'MANUAL';
type BannerKind = 'success' | 'error' | 'info';

interface StatusBanner {
  kind: BannerKind;
  text: string;
}

function formatExpiryLabel(expiryTime?: string): string | null {
  if (!expiryTime) return null;
  const parsed = new Date(expiryTime);
  if (isNaN(parsed.getTime())) return expiryTime;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onCredentialsUpdated,
  onOpenUpdateModal,
}) => {
  const [authTab, setAuthTab] = useState<AuthTab>('OAUTH');

  // Shared Client ID + Manual JWT state
  const [clientId, setClientId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  // 1-Tap OAuth App Config state (saved once)
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [hasSavedAppConfig, setHasSavedAppConfig] = useState(false);
  const [showAppConfigForm, setShowAppConfigForm] = useState(true);

  // OAuth Login Modal state
  const [loginModalVisible, setLoginModalVisible] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);

  // Account & session status
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [sessionExpiry, setSessionExpiry] = useState<string | undefined>(undefined);
  const [savedClientName, setSavedClientName] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<DhanProfile | null>(null);
  const [funds, setFunds] = useState<DhanFundLimit | null>(null);

  // Manual save, updater & cross-platform inline banner
  const [githubRepo, setGithubRepo] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [banner, setBanner] = useState<StatusBanner | null>(null);

  const showBanner = useCallback((kind: BannerKind, text: string) => {
    setBanner({ kind, text });
  }, []);

  const loadSettings = useCallback(async () => {
    const [creds, appCfg, repo] = await Promise.all([
      StorageService.getCredentials(),
      StorageService.getAppConfig(),
      StorageService.getGitHubRepo(),
    ]);

    setGithubRepo(repo);

    if (appCfg && appCfg.clientId && appCfg.appId && appCfg.appSecret) {
      setClientId(appCfg.clientId);
      setAppId(appCfg.appId);
      setAppSecret(appCfg.appSecret);
      setHasSavedAppConfig(true);
      setShowAppConfigForm(false);
    }

    if (creds) {
      if (creds.clientId && creds.clientId !== 'DEMO_USER') {
        setClientId((prev) => prev || creds.clientId);
      }
      setAccessToken(creds.accessToken || '');
      setIsDemoMode(creds.isDemoMode ?? false);
      setSessionExpiry(creds.expiryTime);
      setSavedClientName(creds.clientName);
    }

    try {
      const prof = await DhanApiService.getProfile();
      const f = await DhanApiService.getFundLimits();
      setProfile(prof);
      setFunds(f);
    } catch {}
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleStartOAuthLogin = async () => {
    const cleanClientId = clientId.trim();
    const cleanAppId = appId.trim();
    const cleanAppSecret = appSecret.trim();

    if (!cleanClientId || !cleanAppId || !cleanAppSecret) {
      setShowAppConfigForm(true);
      showBanner(
        'error',
        'Please enter your Dhan Client ID, API Key (App ID), and API Secret (App Secret) once to enable 1-Tap Login.'
      );
      return;
    }

    const cfg: DhanAppConfig = {
      clientId: cleanClientId,
      appId: cleanAppId,
      appSecret: cleanAppSecret,
    };

    try {
      setOauthLoading(true);
      setBanner(null);

      await StorageService.saveAppConfig(cfg);
      setHasSavedAppConfig(true);
      setShowAppConfigForm(false);

      const consent = await DhanAuthService.generateConsent(cfg);
      setLoginUrl(consent.loginUrl);
      setLoginModalVisible(true);
    } catch (err: any) {
      showBanner(
        'error',
        err?.message ||
          'Could not initiate Dhan 1-Tap Login. Verify your Client ID, API Key, and API Secret.'
      );
    } finally {
      setOauthLoading(false);
    }
  };

  const handleTokenCaptured = async (tokenId: string) => {
    setLoginModalVisible(false);
    setLoginUrl(null);

    const cfg: DhanAppConfig | undefined =
      clientId.trim() && appId.trim() && appSecret.trim()
        ? {
            clientId: clientId.trim(),
            appId: appId.trim(),
            appSecret: appSecret.trim(),
          }
        : undefined;

    try {
      setOauthLoading(true);
      showBanner('info', 'Completing Dhan login & verifying session...');

      const session = await DhanAuthService.consumeConsent(tokenId, cfg);
      setIsDemoMode(false);
      setSessionExpiry(session.expiryTime);
      setSavedClientName(session.dhanClientName);
      setAccessToken(session.accessToken);

      let displayName = session.dhanClientName || session.dhanClientId;
      try {
        const [prof, f] = await Promise.all([
          DhanApiService.getProfile(),
          DhanApiService.getFundLimits(),
        ]);
        setProfile(prof);
        setFunds(f);
        if (prof?.clientName) displayName = prof.clientName;
      } catch {}

      onCredentialsUpdated();
      showBanner(
        'success',
        `Connected to Dhan via 1-Tap Login! Welcome ${displayName}.`
      );
    } catch (err: any) {
      showBanner(
        'error',
        err?.message ||
          'Failed to complete Dhan OAuth consent. Please tap Login with Dhan to try again.'
      );
    } finally {
      setOauthLoading(false);
    }
  };

  const handleReLogin = () => {
    setAuthTab('OAUTH');
    if (hasSavedAppConfig) {
      handleStartOAuthLogin();
    } else {
      setShowAppConfigForm(true);
      showBanner(
        'info',
        'Save your Dhan API Key & Secret once below for 1-Tap morning re-login.'
      );
    }
  };

  const handleSaveCredentials = async () => {
    if (!clientId.trim() || !accessToken.trim()) {
      showBanner(
        'error',
        'Please provide both Dhan Client ID and Access Token (JWT).'
      );
      return;
    }

    try {
      setLoading(true);
      setBanner(null);
      const newCreds: DhanCredentials = {
        clientId: clientId.trim(),
        accessToken: accessToken.trim(),
        isDemoMode: false,
      };

      await StorageService.saveCredentials(newCreds);

      const prof = await DhanApiService.getProfile();
      const f = await DhanApiService.getFundLimits();
      setProfile(prof);
      setFunds(f);
      setIsDemoMode(false);
      setSessionExpiry(undefined);
      setSavedClientName(prof.clientName);

      showBanner(
        'success',
        `Connected Live Account! Welcome ${prof.clientName} (ID: ${prof.dhanClientId}).`
      );
      onCredentialsUpdated();
    } catch (err: any) {
      showBanner(
        'error',
        err?.message || 'Verification failed. Check your Client ID and Access Token.'
      );
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
    setSessionExpiry(undefined);
    setProfile(null);
    setFunds(null);
    showBanner('info', 'Demo Mode active — simulated trading & live market feed enabled.');
    onCredentialsUpdated();
  };

  const handleSaveRepo = async () => {
    if (!githubRepo.trim()) return;
    await StorageService.saveGitHubRepo(githubRepo.trim());
    showBanner('success', `GitHub Releases repo updated to ${githubRepo.trim()}.`);
  };

  const handleCheckUpdate = async () => {
    try {
      setCheckingUpdate(true);
      const info = await GitHubUpdaterService.checkForUpdates();
      if (info.hasUpdate) {
        onOpenUpdateModal(info);
      } else {
        showBanner(
          'success',
          `App is up to date! Running latest version v${info.currentVersion}.`
        );
      }
    } catch {
      showBanner('error', 'Could not reach GitHub Releases API.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const expiryLabel = formatExpiryLabel(sessionExpiry);
  const sessionValid = sessionExpiry
    ? DhanAuthService.isSessionValid(sessionExpiry)
    : !isDemoMode;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account & Settings</Text>
        <Text style={styles.headerDesc}>
          BYOK (Bring Your Own Key) architecture: Your API keys and session tokens stay solely on your device.
        </Text>
      </View>

      {/* Cross-Platform Inline Status Banner */}
      {banner ? (
        <View
          style={[
            styles.banner,
            banner.kind === 'success'
              ? styles.bannerSuccess
              : banner.kind === 'error'
              ? styles.bannerError
              : styles.bannerInfo,
          ]}
        >
          <Text
            style={[
              styles.bannerText,
              banner.kind === 'success'
                ? styles.bannerSuccessText
                : banner.kind === 'error'
                ? styles.bannerErrorText
                : styles.bannerInfoText,
            ]}
          >
            {banner.kind === 'success'
              ? '✓ '
              : banner.kind === 'error'
              ? '⚠️ '
              : 'ℹ️ '}
            {banner.text}
          </Text>
          <TouchableOpacity
            style={styles.bannerDismiss}
            onPress={() => setBanner(null)}
          >
            <Text style={styles.bannerDismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Account Status Card */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.cardTitle}>Dhan Connection</Text>
          <View
            style={[
              styles.badge,
              isDemoMode
                ? styles.badgeDemo
                : sessionValid
                ? styles.badgeLive
                : styles.badgeDemo,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                isDemoMode
                  ? styles.textAmber
                  : sessionValid
                  ? styles.textGreen
                  : styles.textAmber,
              ]}
            >
              {isDemoMode
                ? 'SIMULATED DEMO'
                : sessionValid
                ? 'LIVE CONNECTED'
                : 'SESSION EXPIRED'}
            </Text>
          </View>
        </View>

        {!isDemoMode && (
          <View style={styles.profileDetails}>
            <View style={styles.profileTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clientName}>
                  {profile?.clientName || savedClientName || 'Dhan Live Account'}
                </Text>
                <Text style={styles.clientId}>
                  ID: {profile?.dhanClientId || clientId}
                </Text>
                {expiryLabel ? (
                  <Text
                    style={[
                      styles.expiryText,
                      !sessionValid && { color: '#F59E0B' },
                    ]}
                  >
                    {sessionValid ? 'Valid until: ' : 'Expired: '}
                    {expiryLabel}
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.reloginBtn}
                onPress={handleReLogin}
                disabled={oauthLoading}
              >
                <Text style={styles.reloginBtnText}>🔄 Re-Login</Text>
              </TouchableOpacity>
            </View>

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

      {/* Dhan Auth Card: 2-Tab Mode Switcher (1-Tap OAuth vs Manual JWT) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dhan Authentication</Text>

        <View style={styles.authTabBar}>
          <TouchableOpacity
            style={[
              styles.authTabBtn,
              authTab === 'OAUTH' && styles.authTabBtnActive,
            ]}
            onPress={() => setAuthTab('OAUTH')}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.authTabText,
                authTab === 'OAUTH' && styles.authTabTextActive,
              ]}
            >
              ⚡ 1-Tap Dhan Login
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.authTabBtn,
              authTab === 'MANUAL' && styles.authTabBtnActive,
            ]}
            onPress={() => setAuthTab('MANUAL')}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.authTabText,
                authTab === 'MANUAL' && styles.authTabTextActive,
              ]}
            >
              🔑 Manual JWT Token
            </Text>
          </TouchableOpacity>
        </View>

        {authTab === 'OAUTH' ? (
          <View>
            {/* Saved App Config Summary (Sensibull-style 1-Tap Morning Experience) */}
            {hasSavedAppConfig && !showAppConfigForm ? (
              <View style={styles.savedConfigBox}>
                <View style={styles.savedConfigRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.savedConfigTitle}>
                      ✓ Dhan App Keys Saved on Device
                    </Text>
                    <Text style={styles.savedConfigSub}>
                      Client ID: {clientId} • App ID: {appId.slice(0, 6)}••••
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.editKeysBtn}
                    onPress={() => setShowAppConfigForm(true)}
                  >
                    <Text style={styles.editKeysBtnText}>Edit Keys</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                {/* 3-Step One-Time Setup Helper */}
                <View style={styles.setupGuideBox}>
                  <Text style={styles.setupGuideTitle}>
                    One-Time Setup (Takes 30s — never paste daily tokens again!)
                  </Text>
                  <Text style={styles.setupStep}>
                    1. Open{' '}
                    <Text style={styles.setupHighlight}>
                      web.dhan.co → Profile → Access DhanHQ APIs → Create App
                    </Text>
                  </Text>
                  <Text style={styles.setupStep}>
                    2. Set Redirect URL to:{' '}
                    <Text style={styles.setupUrl}>
                      https://pushpak-256.github.io/dhan-options-trader/
                    </Text>
                  </Text>
                  <Text style={styles.setupStep}>
                    3. Paste your Client ID, API Key (App ID), and API Secret below.
                  </Text>
                </View>

                <Text style={styles.label}>Dhan Client ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 1000123456"
                  placeholderTextColor="#64748B"
                  value={clientId}
                  onChangeText={setClientId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>API Key (App ID)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Paste Dhan App ID / API Key..."
                  placeholderTextColor="#64748B"
                  value={appId}
                  onChangeText={setAppId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>API Secret (App Secret)</Text>
                <TextInput
                  style={[styles.input, styles.tokenInput]}
                  placeholder="Paste Dhan App Secret..."
                  placeholderTextColor="#64748B"
                  value={appSecret}
                  onChangeText={setAppSecret}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {hasSavedAppConfig ? (
                  <TouchableOpacity
                    style={styles.hideFormLink}
                    onPress={() => setShowAppConfigForm(false)}
                  >
                    <Text style={styles.hideFormLinkText}>
                      ▲ Collapse API Keys
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {/* Primary Bright Green 1-Tap Login CTA */}
            <TouchableOpacity
              style={[
                styles.oauthLoginBtn,
                oauthLoading && styles.disabledBtn,
              ]}
              onPress={handleStartOAuthLogin}
              disabled={oauthLoading}
            >
              {oauthLoading ? (
                <ActivityIndicator color="#052E16" />
              ) : (
                <Text style={styles.oauthLoginBtnText}>
                  ⚡ Login with Dhan (PIN / OTP)
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoFullBtn}
              onPress={handleSwitchToDemo}
            >
              <Text style={styles.demoBtnText}>Use Demo Mode</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.inputHelp}>
              Fallback: Log in to web.dhan.co ➔ Profile ➔ DhanHQ APIs & Access Token ➔ Generate Access Token.
            </Text>

            <Text style={styles.label}>Dhan Client ID</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 1000123456"
              placeholderTextColor="#64748B"
              value={clientId}
              onChangeText={setClientId}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Access Token (JWT)</Text>
            <TextInput
              style={[styles.input, styles.tokenInput]}
              placeholder="Paste access token here..."
              placeholderTextColor="#64748B"
              value={accessToken}
              onChangeText={setAccessToken}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
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
        )}
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

      {/* Embedded Dhan OAuth Login Modal (WebView on Native, Browser/Fallback on Web) */}
      <DhanLoginModal
        visible={loginModalVisible}
        loginUrl={loginUrl}
        onTokenCaptured={handleTokenCaptured}
        onClose={() => {
          setLoginModalVisible(false);
          setLoginUrl(null);
        }}
      />

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
    marginBottom: 12,
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    gap: 8,
  },
  bannerSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: '#10B981',
  },
  bannerError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
  },
  bannerInfo: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderColor: '#38BDF8',
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  bannerSuccessText: {
    color: '#34D399',
  },
  bannerErrorText: {
    color: '#FCA5A5',
  },
  bannerInfoText: {
    color: '#7DD3FC',
  },
  bannerDismiss: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bannerDismissText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '800',
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
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  clientName: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  clientId: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  expiryText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  reloginBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
  },
  reloginBtnText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
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
  authTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 3,
    marginTop: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  authTabBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authTabBtnActive: {
    backgroundColor: '#38BDF8',
  },
  authTabText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
  },
  authTabTextActive: {
    color: '#0F172A',
  },
  savedConfigBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  savedConfigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  savedConfigTitle: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
  },
  savedConfigSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  editKeysBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editKeysBtnText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  setupGuideBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 8,
  },
  setupGuideTitle: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
  },
  setupStep: {
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  setupHighlight: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  setupUrl: {
    color: '#34D399',
    fontWeight: '700',
  },
  hideFormLink: {
    alignSelf: 'flex-end',
    marginTop: 6,
  },
  hideFormLinkText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  oauthLoginBtn: {
    marginTop: 14,
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oauthLoginBtnText: {
    color: '#052E16',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  disabledBtn: {
    opacity: 0.65,
  },
  demoFullBtn: {
    marginTop: 8,
    backgroundColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputHelp: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
    marginBottom: 8,
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
    color: '#CBD5E1',
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
