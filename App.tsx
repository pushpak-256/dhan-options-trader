import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Header } from './src/components/Header';
import { ChartTradingScreen } from './src/screens/ChartTradingScreen';
import { OptionChainScreen } from './src/screens/OptionChainScreen';
import { PositionsScreen } from './src/screens/PositionsScreen';
import { ComplianceSettingsScreen } from './src/screens/ComplianceSettingsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { UpdateModal } from './src/components/UpdateModal';
import { GitHubUpdaterService } from './src/services/githubUpdater';
import { DhanApiService } from './src/services/dhanApi';
import { DhanAuthService } from './src/services/dhanAuthService';
import { StorageService } from './src/services/storage';
import { AutoSquareOffEngine, KillSwitchEvent } from './src/services/autoSquareOffEngine';
import { OptionContract } from './src/types/dhan';
import { UpdateInfo } from './src/types/updater';
import { generateMockOptionChain } from './src/services/mockData';

type Tab = 'CHART' | 'CHAIN' | 'POSITIONS' | 'COMPLIANCE' | 'SETTINGS';

interface AuthToastState {
  type: 'success' | 'warning';
  message: string;
}

function buildCleanUrlWithoutTokenId(rawHref: string): string {
  try {
    const parsed = new URL(rawHref);
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (lower === 'tokenid' || lower === 'token_id') {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((k) => parsed.searchParams.delete(k));

    if (parsed.hash && /token_?id=/i.test(parsed.hash)) {
      const hashContent = parsed.hash.replace(/^#/, '');
      const qIdx = hashContent.indexOf('?');
      if (qIdx >= 0) {
        const hashPath = hashContent.slice(0, qIdx);
        const hashParams = new URLSearchParams(hashContent.slice(qIdx + 1));
        Array.from(hashParams.keys()).forEach((k) => {
          const lower = k.toLowerCase();
          if (lower === 'tokenid' || lower === 'token_id') {
            hashParams.delete(k);
          }
        });
        const remaining = hashParams.toString();
        parsed.hash = remaining ? `#${hashPath}?${remaining}` : hashPath ? `#${hashPath}` : '';
      } else {
        const hashParams = new URLSearchParams(hashContent);
        Array.from(hashParams.keys()).forEach((k) => {
          const lower = k.toLowerCase();
          if (lower === 'tokenid' || lower === 'token_id') {
            hashParams.delete(k);
          }
        });
        const remaining = hashParams.toString();
        parsed.hash = remaining ? `#${remaining}` : '';
      }
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('CHART');
  const [selectedContract, setSelectedContract] = useState<OptionContract>(() => {
    const chain = generateMockOptionChain('NIFTY');
    // Choose ATM Call
    const atmRow = chain.strikes.find((s) => s.isATM) || chain.strikes[7];
    return atmRow.call;
  });

  const [isDemoMode, setIsDemoMode] = useState(true);
  const [todayPnl, setTodayPnl] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [killSwitchBanner, setKillSwitchBanner] = useState<KillSwitchEvent | null>(null);
  const [authToast, setAuthToast] = useState<AuthToastState | null>(null);
  const authToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAuthToast = (toast: AuthToastState, durationMs: number = 5000) => {
    if (authToastTimerRef.current) {
      clearTimeout(authToastTimerRef.current);
      authToastTimerRef.current = null;
    }
    setAuthToast(toast);
    authToastTimerRef.current = setTimeout(() => {
      setAuthToast(null);
      authToastTimerRef.current = null;
    }, durationMs);
  };

  // Initialize, handle Web OAuth callback, check updates, and start Max SL Auto-Exit Kill Switch monitor
  useEffect(() => {
    let isMounted = true;

    const handleWebOAuthRedirect = async () => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      const tokenId = DhanAuthService.extractTokenIdFromUrl(window.location.href);
      if (!tokenId) return;

      // Strip tokenId immediately so refreshing never replays an expired token
      try {
        const cleanUrl = buildCleanUrlWithoutTokenId(window.location.href);
        window.history.replaceState({}, document.title, cleanUrl);
      } catch {}

      try {
        const result = await DhanAuthService.consumeConsent(tokenId);
        if (!isMounted) return;
        await refreshAccountState();
        const label = result?.dhanClientName ? ` (${result.dhanClientName})` : '';
        showAuthToast(
          {
            type: 'success',
            message: `✓ Connected to Dhan via 1-Tap Login!${label}`,
          },
          5500
        );
      } catch (err: any) {
        if (!isMounted) return;
        const rawMsg = err?.message || '';
        const friendlyMsg = rawMsg
          ? `⚠️ Dhan 1-Tap Login incomplete: ${rawMsg}`
          : '⚠️ Dhan App Config not saved yet. Open Account tab, save API Key & Secret, and tap Login with Dhan.';
        showAuthToast({ type: 'warning', message: friendlyMsg }, 7500);
      }
    };

    refreshAccountState();
    checkAppUpdates();
    void handleWebOAuthRedirect();

    AutoSquareOffEngine.startMonitoring(3000);
    const unsubPnl = AutoSquareOffEngine.onPnlUpdate((totalPnl) => {
      setTodayPnl(totalPnl);
    });
    const unsubKill = AutoSquareOffEngine.onKillSwitchTriggered((event) => {
      setKillSwitchBanner(event);
    });

    return () => {
      isMounted = false;
      if (authToastTimerRef.current) {
        clearTimeout(authToastTimerRef.current);
        authToastTimerRef.current = null;
      }
      unsubPnl();
      unsubKill();
      AutoSquareOffEngine.stopMonitoring();
    };
  }, []);

  const refreshAccountState = async () => {
    const isDemo = await DhanApiService.isDemoMode();
    setIsDemoMode(isDemo);

    const complianceState = await StorageService.getComplianceState();
    setTodayPnl(complianceState.todayRealizedPnl + complianceState.todayUnrealizedPnl);
  };

  const checkAppUpdates = async () => {
    try {
      const info = await GitHubUpdaterService.checkForUpdates();
      if (info.hasUpdate) {
        setUpdateInfo(info);
        setShowUpdateModal(true);
      }
    } catch {}
  };

  const handleSelectStrike = (contract: OptionContract, type: 'CALL' | 'PUT') => {
    setSelectedContract(contract);
    setActiveTab('CHART');
  };

  const getScreenTitle = () => {
    switch (activeTab) {
      case 'CHART':
        return selectedContract.tradingSymbol;
      case 'CHAIN':
        return 'Option Chain';
      case 'POSITIONS':
        return 'Positions & MTM';
      case 'COMPLIANCE':
        return 'Risk Rules';
      case 'SETTINGS':
        return 'Settings & BYOK';
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {/* Top App Header */}
        <Header
          isDemoMode={isDemoMode}
          todayPnl={todayPnl}
          hasUpdate={updateInfo?.hasUpdate ?? false}
          onPressUpdate={() => setShowUpdateModal(true)}
          onPressSettings={() => setActiveTab('SETTINGS')}
          activeScreenTitle={getScreenTitle()}
        />

        {/* 1-Tap Dhan OAuth Redirect Toast Banner */}
        {authToast && (
          <View
            style={[
              styles.authToastBanner,
              authToast.type === 'success'
                ? styles.authToastSuccess
                : styles.authToastWarning,
            ]}
          >
            <Text
              style={[
                styles.authToastText,
                authToast.type === 'success'
                  ? styles.authToastSuccessText
                  : styles.authToastWarningText,
              ]}
            >
              {authToast.message}
            </Text>
            <TouchableOpacity
              style={styles.killDismissBtn}
              onPress={() => setAuthToast(null)}
            >
              <Text style={styles.killDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Max Daily SL Auto-Exit Kill Switch Banner */}
        {killSwitchBanner && (
          <View style={styles.killSwitchBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.killSwitchTitle}>
                🚨 MAX DAILY SL HIT (-₹{Math.round(killSwitchBanner.actualLoss)}) — AUTO-EXITED ALL POSITIONS
              </Text>
              <Text style={styles.killSwitchDesc}>
                Exited {killSwitchBanner.summary.exitedCount} position(s) & cancelled {killSwitchBanner.summary.cancelledOrdersCount} pending order(s) via Dhan API. Account locked for today.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.killDismissBtn}
              onPress={() => setKillSwitchBanner(null)}
            >
              <Text style={styles.killDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Active Screen View */}
        <View style={styles.content}>
          {activeTab === 'CHART' && (
            <ChartTradingScreen
              selectedContract={selectedContract}
              onOpenChain={() => setActiveTab('CHAIN')}
              onTradeExecuted={refreshAccountState}
            />
          )}

          {activeTab === 'CHAIN' && (
            <OptionChainScreen onSelectStrike={handleSelectStrike} />
          )}

          {activeTab === 'POSITIONS' && (
            <PositionsScreen onRefreshPnl={refreshAccountState} />
          )}

          {activeTab === 'COMPLIANCE' && <ComplianceSettingsScreen />}

          {activeTab === 'SETTINGS' && (
            <SettingsScreen
              onCredentialsUpdated={refreshAccountState}
              onOpenUpdateModal={(info) => {
                setUpdateInfo(info);
                setShowUpdateModal(true);
              }}
            />
          )}
        </View>

        {/* Bottom Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'CHART' && styles.tabItemActive]}
            onPress={() => setActiveTab('CHART')}
          >
            <Text style={[styles.tabIcon, activeTab === 'CHART' && styles.tabIconActive]}>
              📈
            </Text>
            <Text style={[styles.tabLabel, activeTab === 'CHART' && styles.tabLabelActive]}>
              Chart
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'CHAIN' && styles.tabItemActive]}
            onPress={() => setActiveTab('CHAIN')}
          >
            <Text style={[styles.tabIcon, activeTab === 'CHAIN' && styles.tabIconActive]}>
              ⛓️
            </Text>
            <Text style={[styles.tabLabel, activeTab === 'CHAIN' && styles.tabLabelActive]}>
              Chain
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'POSITIONS' && styles.tabItemActive]}
            onPress={() => setActiveTab('POSITIONS')}
          >
            <Text style={[styles.tabIcon, activeTab === 'POSITIONS' && styles.tabIconActive]}>
              💼
            </Text>
            <Text style={[styles.tabLabel, activeTab === 'POSITIONS' && styles.tabLabelActive]}>
              Positions
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'COMPLIANCE' && styles.tabItemActive]}
            onPress={() => setActiveTab('COMPLIANCE')}
          >
            <Text style={[styles.tabIcon, activeTab === 'COMPLIANCE' && styles.tabIconActive]}>
              🛡️
            </Text>
            <Text style={[styles.tabLabel, activeTab === 'COMPLIANCE' && styles.tabLabelActive]}>
              Rules
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'SETTINGS' && styles.tabItemActive]}
            onPress={() => setActiveTab('SETTINGS')}
          >
            <Text style={[styles.tabIcon, activeTab === 'SETTINGS' && styles.tabIconActive]}>
              ⚙️
            </Text>
            <Text style={[styles.tabLabel, activeTab === 'SETTINGS' && styles.tabLabelActive]}>
              Account
            </Text>
          </TouchableOpacity>
        </View>

        {/* GitHub In-App APK Updater Modal */}
        <UpdateModal
          visible={showUpdateModal}
          updateInfo={updateInfo}
          onClose={() => setShowUpdateModal(false)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1120',
    paddingTop: Platform.OS === 'android' ? 25 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    height: 58,
    flexDirection: 'row',
    backgroundColor: '#0B1120',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#38BDF8',
  },
  tabIcon: {
    fontSize: 18,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  tabLabelActive: {
    color: '#38BDF8',
  },
  killSwitchBanner: {
    backgroundColor: '#7F1D1D',
    borderBottomWidth: 2,
    borderBottomColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  killSwitchTitle: {
    color: '#FEF2F2',
    fontWeight: '900',
    fontSize: 11,
  },
  killSwitchDesc: {
    color: '#FECACA',
    fontSize: 10,
    marginTop: 2,
  },
  killDismissBtn: {
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 6,
  },
  killDismissText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  authToastBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottomWidth: 2,
  },
  authToastSuccess: {
    backgroundColor: '#064E3B',
    borderBottomColor: '#10B981',
  },
  authToastWarning: {
    backgroundColor: '#78350F',
    borderBottomColor: '#F59E0B',
  },
  authToastText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  authToastSuccessText: {
    color: '#D1FAE5',
  },
  authToastWarningText: {
    color: '#FEF3C7',
  },
});
