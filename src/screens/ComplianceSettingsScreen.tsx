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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService } from '../services/storage';
import { AutoSquareOffEngine, WatchdogStatus } from '../services/autoSquareOffEngine';
import { ComplianceRulesConfig, ComplianceState } from '../types/compliance';

const CUSTOM_RULES_STORAGE_KEY = 'custom_trader_rules_v1';

export interface CustomTraderRule {
  id: string;
  text: string;
  active: boolean;
  createdAt: number;
}

const DEFAULT_CUSTOM_RULES: CustomTraderRule[] = [
  {
    id: 'starter_vwap_ema9',
    text: 'Only enter on pullback to VWAP/EMA9',
    active: true,
    createdAt: 1,
  },
  {
    id: 'starter_no_avg_down',
    text: 'No averaging down losing options',
    active: true,
    createdAt: 2,
  },
  {
    id: 'starter_candle_close',
    text: 'Wait for candle close confirmation before entry',
    active: true,
    createdAt: 3,
  },
];

function formatHeartbeatTime(timestamp: number | null): string {
  if (!timestamp) return 'Waiting...';
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return new Date(timestamp).toISOString().slice(11, 19);
  }
}

export const ComplianceSettingsScreen: React.FC = () => {
  const [config, setConfig] = useState<ComplianceRulesConfig | null>(null);
  const [state, setState] = useState<ComplianceState | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  const [customRules, setCustomRules] = useState<CustomTraderRule[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [watchdogStatus, setWatchdogStatus] = useState<WatchdogStatus>(() =>
    AutoSquareOffEngine.getLastStatus()
  );

  useEffect(() => {
    loadData();

    const heartbeatInterval = setInterval(() => {
      setWatchdogStatus(AutoSquareOffEngine.getLastStatus());
    }, 2000);

    return () => clearInterval(heartbeatInterval);
  }, []);

  const loadData = async () => {
    const [loadedConfig, loadedState, loadedCustomRules] = await Promise.all([
      StorageService.getComplianceConfig(),
      StorageService.getComplianceState(),
      loadCustomRules(),
    ]);
    setConfig(loadedConfig);
    setState(loadedState);
    setCustomRules(loadedCustomRules);
    setWatchdogStatus(AutoSquareOffEngine.getLastStatus());
  };

  const loadCustomRules = async (): Promise<CustomTraderRule[]> => {
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_RULES_STORAGE_KEY);
      if (raw === null) {
        await AsyncStorage.setItem(
          CUSTOM_RULES_STORAGE_KEY,
          JSON.stringify(DEFAULT_CUSTOM_RULES)
        );
        return DEFAULT_CUSTOM_RULES;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is CustomTraderRule =>
            item &&
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            typeof item.active === 'boolean'
        );
      }
      return DEFAULT_CUSTOM_RULES;
    } catch {
      return DEFAULT_CUSTOM_RULES;
    }
  };

  const persistCustomRules = async (nextRules: CustomTraderRule[]) => {
    setCustomRules(nextRules);
    try {
      await AsyncStorage.setItem(CUSTOM_RULES_STORAGE_KEY, JSON.stringify(nextRules));
    } catch (err) {
      console.warn('Failed to persist custom trader rules:', err);
    }
  };

  const handleAddCustomRule = async () => {
    const trimmed = newRuleText.trim();
    if (!trimmed) return;

    const newRule: CustomTraderRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      active: true,
      createdAt: Date.now(),
    };

    const nextRules = [newRule, ...customRules];
    setNewRuleText('');
    await persistCustomRules(nextRules);
  };

  const handleToggleCustomRule = async (id: string) => {
    const nextRules = customRules.map((rule) =>
      rule.id === id ? { ...rule, active: !rule.active } : rule
    );
    await persistCustomRules(nextRules);
  };

  const handleDeleteCustomRule = async (id: string) => {
    const nextRules = customRules.filter((rule) => rule.id !== id);
    await persistCustomRules(nextRules);
  };

  const handleRestoreStarterRules = async () => {
    await persistCustomRules(DEFAULT_CUSTOM_RULES);
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

  const activeCustomRulesCount = customRules.filter((r) => r.active).length;

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
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Auto-Exit Watchdog:</Text>
          <Text
            style={[
              styles.statusValue,
              watchdogStatus.lastError
                ? styles.textAmber
                : watchdogStatus.isMonitoring
                  ? styles.textGreen
                  : styles.textMuted,
            ]}
          >
            {watchdogStatus.isMonitoring
              ? `● Live (${formatHeartbeatTime(watchdogStatus.lastHeartbeatAt)})`
              : '○ Standby'}
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
        <View style={[styles.ruleCard, config.maxDailyLossEnabled && styles.killSwitchRuleCard]}>
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

          {/* Auto-Exit Kill Switch Highlight Badge & Explanation */}
          <View style={styles.killSwitchBox}>
            <View style={styles.killSwitchBadgeRow}>
              <View style={styles.killSwitchBadge}>
                <Text style={styles.killSwitchBadgeText}>⚡ AUTO-EXIT KILL SWITCH</Text>
              </View>
              <View
                style={[
                  styles.killSwitchStatePill,
                  config.maxDailyLossEnabled
                    ? styles.killSwitchArmedPill
                    : styles.killSwitchDisarmedPill,
                ]}
              >
                <Text
                  style={[
                    styles.killSwitchStateText,
                    config.maxDailyLossEnabled
                      ? styles.killSwitchArmedText
                      : styles.killSwitchDisarmedText,
                  ]}
                >
                  {config.maxDailyLossEnabled ? 'ARMED' : 'OFF'}
                </Text>
              </View>
            </View>
            <Text style={styles.killSwitchExplain}>
              ⚡ Auto-Exit Kill Switch: Automatically cancels all pending orders & squares off ALL open positions via Dhan API the instant Max Daily Loss is breached.
            </Text>
            <Text style={styles.killSwitchHeartbeat}>
              Watchdog heartbeat: {formatHeartbeatTime(watchdogStatus.lastHeartbeatAt)}
              {watchdogStatus.isMonitoring ? ' • Monitoring active' : ' • Not running'}
            </Text>
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

      {/* Custom Trader Rules / Pre-Trade Checklist */}
      <View style={styles.customSection}>
        <View style={styles.customHeaderRow}>
          <Text style={styles.sectionHeader}>CUSTOM TRADER RULES / PRE-TRADE CHECKLIST</Text>
          <View style={styles.customCountPill}>
            <Text style={styles.customCountText}>
              {activeCustomRulesCount}/{customRules.length} Active
            </Text>
          </View>
        </View>
        <Text style={styles.customSubtext}>
          Add your own playbook rules to review before every entry. Changes save automatically on this device.
        </Text>

        {/* Add Custom Rule Input */}
        <View style={styles.addRuleRow}>
          <TextInput
            style={styles.addRuleInput}
            placeholder="e.g. Only enter on pullback to VWAP/EMA9"
            placeholderTextColor="#64748B"
            value={newRuleText}
            onChangeText={setNewRuleText}
            onSubmitEditing={handleAddCustomRule}
            returnKeyType="done"
          />
          <TouchableOpacity
            style={[
              styles.addRuleBtn,
              !newRuleText.trim() && styles.addRuleBtnDisabled,
            ]}
            onPress={handleAddCustomRule}
            disabled={!newRuleText.trim()}
          >
            <Text style={styles.addRuleBtnText}>+ Add Rule</Text>
          </TouchableOpacity>
        </View>

        {/* Custom Rules List */}
        {customRules.length === 0 ? (
          <View style={styles.emptyRulesCard}>
            <Text style={styles.emptyRulesText}>
              No custom rules yet. Add a personal discipline rule above or load starter rules.
            </Text>
            <TouchableOpacity
              style={styles.restoreBtn}
              onPress={handleRestoreStarterRules}
            >
              <Text style={styles.restoreBtnText}>↺ Restore Starter Rules</Text>
            </TouchableOpacity>
          </View>
        ) : (
          customRules.map((rule) => (
            <View
              key={rule.id}
              style={[
                styles.customRuleItem,
                !rule.active && styles.customRuleItemInactive,
              ]}
            >
              <Switch
                value={rule.active}
                onValueChange={() => handleToggleCustomRule(rule.id)}
                thumbColor={rule.active ? '#10B981' : '#64748B'}
              />
              <TouchableOpacity
                style={styles.customRuleTextWrap}
                onPress={() => handleToggleCustomRule(rule.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.customRuleText,
                    !rule.active && styles.customRuleTextInactive,
                  ]}
                >
                  {rule.text}
                </Text>
                <Text style={styles.customRuleMeta}>
                  {rule.active ? 'Active pre-trade check' : 'Paused'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteRuleBtn}
                onPress={() => handleDeleteCustomRule(rule.id)}
                accessibilityLabel="Delete rule"
              >
                <Text style={styles.deleteRuleText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
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
  textAmber: {
    color: '#F59E0B',
  },
  textMuted: {
    color: '#64748B',
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
  killSwitchRuleCard: {
    borderColor: '#DC2626',
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
  killSwitchBox: {
    marginTop: 10,
    backgroundColor: 'rgba(127, 29, 29, 0.35)',
    borderWidth: 1,
    borderColor: '#B91C1C',
    borderRadius: 8,
    padding: 10,
  },
  killSwitchBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  killSwitchBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  killSwitchBadgeText: {
    color: '#FEF2F2',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  killSwitchStatePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  killSwitchArmedPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  killSwitchDisarmedPill: {
    backgroundColor: 'rgba(100, 116, 139, 0.2)',
    borderColor: '#64748B',
  },
  killSwitchStateText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  killSwitchArmedText: {
    color: '#34D399',
  },
  killSwitchDisarmedText: {
    color: '#94A3B8',
  },
  killSwitchExplain: {
    color: '#FECACA',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  killSwitchHeartbeat: {
    color: '#FCA5A5',
    fontSize: 10,
    marginTop: 6,
    opacity: 0.85,
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
  customSection: {
    marginTop: 22,
  },
  customHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  customCountPill: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginBottom: 10,
  },
  customCountText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  customSubtext: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
  },
  addRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  addRuleInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    fontSize: 12,
  },
  addRuleBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRuleBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.7,
  },
  addRuleBtnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 12,
  },
  emptyRulesCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  emptyRulesText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  restoreBtn: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  restoreBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  customRuleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  customRuleItemInactive: {
    opacity: 0.65,
    borderColor: '#1E293B',
  },
  customRuleTextWrap: {
    flex: 1,
  },
  customRuleText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  customRuleTextInactive: {
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  customRuleMeta: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
  },
  deleteRuleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  deleteRuleText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '800',
  },
});
