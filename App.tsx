import React, { useState, useEffect } from 'react';
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
import { StorageService } from './src/services/storage';
import { OptionContract } from './src/types/dhan';
import { UpdateInfo } from './src/types/updater';
import { generateMockOptionChain } from './src/services/mockData';

type Tab = 'CHART' | 'CHAIN' | 'POSITIONS' | 'COMPLIANCE' | 'SETTINGS';

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

  // Initialize and check for update on app startup
  useEffect(() => {
    refreshAccountState();
    checkAppUpdates();
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
});
