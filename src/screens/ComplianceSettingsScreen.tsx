import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { StorageService } from '../services/storage';
import { ComplianceRulesConfig, ComplianceState } from '../types/compliance';

export const ComplianceSettingsScreen: React.FC = () => {
  const [config, setConfig] = useState<ComplianceRulesConfig | null>(null);
  const [state, setState] = useState<ComplianceState | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const loadedConfig = await StorageService.getComplianceConfig();
    const loadedState = await StorageService.getComplianceState();
    setConfig(loadedConfig);
    setState(loadedState);
  };

  const handleSave = async () => {
    if (!config) return;
    await StorageService.saveComplianceConfig(config);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2500);
  };

  const handleResetDay = async () => {
    Alert.alert(
      'Reset Daily Risk Stats?',
      'This will reset your trade count, cooldown timer, and loss lock for today.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const freshState: ComplianceState = {
              todayRealizedPnl: 0,
              todayUnrealizedPnl: 0,
              todayTradeCount: 0,
              consecutiveLossCount: 0,
              cooldownUntil: null,
              isDailyLossLocked: false,
              lockedAtDate: todayStr,
            };
            await StorageService.saveComplianceState(freshState);
            setState(freshState);
            Alert.alert('Reset Complete', 'Daily risk statistics have been cleared.');
          },
        },
      ]
    );
  };

  if (!config || !state) return null;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Risk & Compliance Engine</Text>
        <Text style={styles.headerDesc}>
          Set your personal guardrails to protect capital and prevent emotional revenge trading.
        </Text>
      </View>

      {/* Live Status Card */}
      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Today's Psychological State</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Daily Trades:</Text>
          <Text style={styles.statusValue}>{state.todayTradeCount}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Consecutive Losses:</Text>
          <Text style={styles.statusValue}>{state.consecutiveLossCount}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Cooldown Status:</Text>
          <Text
            style={[
              styles.statusValue,
              state.cooldownUntil && state.cooldownUntil > Date.now()
                ? styles.textRed
                : styles.textGreen,
            ]}
          >
            {state.cooldownUntil && state.cooldownUntil > Date.now()
              ? `Active (${Math.ceil((state.cooldownUntil - Date.now()) / 60000)} min left)`
              : 'Clear'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Daily Loss Locked:</Text>
          <Text
            style={[
              styles.statusValue,
              state.isDailyLossLocked ? styles.textRed : styles.textGreen,
            ]}
          >
            {state.isDailyLossLocked ? 'LOCKED' : 'Unlocked'}
          </Text>
        </View>

        <TouchableOpacity style={styles.resetBtn} onPress={handleResetDay}>
          <Text style={styles.resetBtnText}>↺ Reset Today's Stats</Text>
        </TouchableOpacity>
      </View>

      {/* Rules Config List */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>PERSONAL TRADING RULES</Text>

        {/* Rule 1: Max Daily Loss */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>1. Max Daily Loss Hard-Stop</Text>
              <Text style={styles.ruleDesc}>
                Locks app from placing any new orders when today's loss reaches this amount.
              </Text>
            </View>
            <Switch
              value={config.maxDailyLossEnabled}
              onValueChange={(val) =>
                setConfig({ ...config, maxDailyLossEnabled: val })
              }
              thumbColor={config.maxDailyLossEnabled ? '#38BDF8' : '#64748B'}
            />
          </View>
          {config.maxDailyLossEnabled && (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>Max Loss (₹):</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={String(config.maxDailyLossAmount)}
                onChangeText={(text) =>
                  setConfig({
                    ...config,
                    maxDailyLossAmount: Number(text) || 0,
                  })
                }
              />
            </View>
          )}
        </View>

        {/* Rule 2: Max Risk Per Trade */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>2. Max Risk Per Trade</Text>
              <Text style={styles.ruleDesc}>
                Blocks order if (Entry - SL) × Quantity exceeds this ₹ limit.
              </Text>
            </View>
            <Switch
              value={config.maxRiskPerTradeEnabled}
              onValueChange={(val) =>
                setConfig({ ...config, maxRiskPerTradeEnabled: val })
              }
              thumbColor={config.maxRiskPerTradeEnabled ? '#38BDF8' : '#64748B'}
            />
          </View>
          {config.maxRiskPerTradeEnabled && (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>Max Risk (₹):</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={String(config.maxRiskPerTradeAmount)}
                onChangeText={(text) =>
                  setConfig({
                    ...config,
                    maxRiskPerTradeAmount: Number(text) || 0,
                  })
                }
              />
            </View>
          )}
        </View>

        {/* Rule 3: Max Lots per Trade */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>3. Max Lots Cap</Text>
              <Text style={styles.ruleDesc}>
                Prevents oversized revenge bets by capping maximum lots per trade.
              </Text>
            </View>
            <Switch
              value={config.maxLotsPerTradeEnabled}
              onValueChange={(val) =>
                setConfig({ ...config, maxLotsPerTradeEnabled: val })
              }
              thumbColor={config.maxLotsPerTradeEnabled ? '#38BDF8' : '#64748B'}
            />
          </View>
          {config.maxLotsPerTradeEnabled && (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>Max Lots:</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={String(config.maxLotsPerTrade)}
                onChangeText={(text) =>
                  setConfig({
                    ...config,
                    maxLotsPerTrade: Number(text) || 1,
                  })
                }
              />
            </View>
          )}
        </View>

        {/* Rule 4: Mandatory Stop Loss */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>4. Mandatory Stop Loss</Text>
              <Text style={styles.ruleDesc}>
                Order button is strictly disabled unless an SL line is set on the chart.
              </Text>
            </View>
            <Switch
              value={config.mandatoryStopLoss}
              onValueChange={(val) =>
                setConfig({ ...config, mandatoryStopLoss: val })
              }
              thumbColor={config.mandatoryStopLoss ? '#38BDF8' : '#64748B'}
            />
          </View>
        </View>

        {/* Rule 5: Min Risk to Reward */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>5. Minimum Risk-to-Reward (R:R)</Text>
              <Text style={styles.ruleDesc}>
                Warns if Target vs SL ratio is below target threshold (e.g. 1:1.5).
              </Text>
            </View>
            <Switch
              value={config.minRiskRewardEnabled}
              onValueChange={(val) =>
                setConfig({ ...config, minRiskRewardEnabled: val })
              }
              thumbColor={config.minRiskRewardEnabled ? '#38BDF8' : '#64748B'}
            />
          </View>
          {config.minRiskRewardEnabled && (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>Target R:R Ratio (1:X):</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={String(config.minRiskRewardRatio)}
                onChangeText={(text) =>
                  setConfig({
                    ...config,
                    minRiskRewardRatio: Number(text) || 1.5,
                  })
                }
              />
            </View>
          )}
        </View>

        {/* Rule 6: Revenge Trading Cooldown */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>6. Revenge Trading Cooldown</Text>
              <Text style={styles.ruleDesc}>
                Enforces a temporary freeze after a losing trade so you can reset mentally.
              </Text>
            </View>
            <Switch
              value={config.revengeCooldownEnabled}
              onValueChange={(val) =>
                setConfig({ ...config, revengeCooldownEnabled: val })
              }
              thumbColor={config.revengeCooldownEnabled ? '#38BDF8' : '#64748B'}
            />
          </View>
          {config.revengeCooldownEnabled && (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>Freeze Duration (mins):</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={String(config.revengeCooldownMinutes)}
                onChangeText={(text) =>
                  setConfig({
                    ...config,
                    revengeCooldownMinutes: Number(text) || 15,
                  })
                }
              />
            </View>
          )}
        </View>

        {/* Rule 7: Opening Volatility Filter */}
        <View style={styles.ruleCard}>
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleBox}>
              <Text style={styles.ruleTitle}>7. Opening Volatility Filter (9:15-9:20)</Text>
              <Text style={styles.ruleDesc}>
                Blocks new orders during the volatile first 5 minutes of market open.
              </Text>
            </View>
            <Switch
              value={config.blockOpeningVolatility}
              onValueChange={(val) =>
                setConfig({ ...config, blockOpeningVolatility: val })
              }
              thumbColor={config.blockOpeningVolatility ? '#38BDF8' : '#64748B'}
            />
          </View>
        </View>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>
          {savedMessage ? '✓ RULES SAVED' : 'SAVE RISK RULES'}
        </Text>
      </TouchableOpacity>
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
  statusCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusTitle: {
    color: '#38BDF8',
    fontWeight: '800',
    fontSize: 13,
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  statusLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  statusValue: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  textGreen: {
    color: '#10B981',
  },
  textRed: {
    color: '#EF4444',
  },
  resetBtn: {
    marginTop: 10,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 6,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  ruleCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ruleTitleBox: {
    flex: 1,
    paddingRight: 10,
  },
  ruleTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  ruleDesc: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 3,
    lineHeight: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputPrefix: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
    width: 100,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
