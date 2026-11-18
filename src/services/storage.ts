import AsyncStorage from '@react-native-async-storage/async-storage';
import { DhanAppConfig, DhanCredentials } from '../types/dhan';
import { ComplianceRulesConfig, ComplianceState } from '../types/compliance';

const KEYS = {
  CREDENTIALS: 'dhan_credentials',
  APP_CONFIG: 'dhan_app_config_v1',
  COMPLIANCE_CONFIG: 'compliance_config_v1',
  COMPLIANCE_STATE: 'compliance_state_v1',
  GITHUB_REPO: 'github_updater_repo',
};

export const DEFAULT_COMPLIANCE_CONFIG: ComplianceRulesConfig = {
  maxDailyLossEnabled: true,
  maxDailyLossAmount: 5000,

  maxRiskPerTradeEnabled: true,
  maxRiskPerTradeAmount: 1500,

  maxLotsPerTradeEnabled: true,
  maxLotsPerTrade: 2,

  maxTradesPerDayEnabled: true,
  maxTradesPerDay: 5,

  mandatoryStopLoss: true,

  minRiskRewardEnabled: true,
  minRiskRewardRatio: 1.5,

  revengeCooldownEnabled: true,
  revengeCooldownMinutes: 15,
  triggerConsecutiveLosses: 1,

  blockOpeningVolatility: true,
  blockMarketClose: false,
};

export const DEFAULT_COMPLIANCE_STATE: ComplianceState = {
  todayRealizedPnl: 0,
  todayUnrealizedPnl: 0,
  todayTradeCount: 0,
  consecutiveLossCount: 0,
  cooldownUntil: null,
  isDailyLossLocked: false,
};

export class StorageService {
  // Dhan Credentials
  static async getCredentials(): Promise<DhanCredentials | null> {
    try {
      const data = await AsyncStorage.getItem(KEYS.CREDENTIALS);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to load credentials', e);
      return null;
    }
  }

  static async saveCredentials(creds: DhanCredentials): Promise<void> {
    await AsyncStorage.setItem(KEYS.CREDENTIALS, JSON.stringify(creds));
  }

  static async clearCredentials(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.CREDENTIALS);
  }

  // Dhan OAuth App Config (Client ID + API Key / App ID + API Secret / App Secret)
  static async getAppConfig(): Promise<DhanAppConfig | null> {
    try {
      const data = await AsyncStorage.getItem(KEYS.APP_CONFIG);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to load Dhan app config', e);
      return null;
    }
  }

  static async saveAppConfig(config: DhanAppConfig): Promise<void> {
    const cleaned: DhanAppConfig = {
      clientId: (config.clientId || '').trim(),
      appId: (config.appId || '').trim(),
      appSecret: (config.appSecret || '').trim(),
    };
    await AsyncStorage.setItem(KEYS.APP_CONFIG, JSON.stringify(cleaned));
  }

  static async clearAppConfig(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.APP_CONFIG);
  }

  // Compliance Rules Config
  static async getComplianceConfig(): Promise<ComplianceRulesConfig> {
    try {
      const data = await AsyncStorage.getItem(KEYS.COMPLIANCE_CONFIG);
      if (!data) return DEFAULT_COMPLIANCE_CONFIG;
      return { ...DEFAULT_COMPLIANCE_CONFIG, ...JSON.parse(data) };
    } catch {
      return DEFAULT_COMPLIANCE_CONFIG;
    }
  }

  static async saveComplianceConfig(config: ComplianceRulesConfig): Promise<void> {
    await AsyncStorage.setItem(KEYS.COMPLIANCE_CONFIG, JSON.stringify(config));
  }

  // Compliance Runtime State
  static async getComplianceState(): Promise<ComplianceState> {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const data = await AsyncStorage.getItem(KEYS.COMPLIANCE_STATE);
      if (!data) return { ...DEFAULT_COMPLIANCE_STATE, lockedAtDate: todayStr };

      const state: ComplianceState = JSON.parse(data);
      // Auto reset if new day
      if (state.lockedAtDate && state.lockedAtDate !== todayStr) {
        const freshState: ComplianceState = {
          ...DEFAULT_COMPLIANCE_STATE,
          lockedAtDate: todayStr,
        };
        await this.saveComplianceState(freshState);
        return freshState;
      }
      return state;
    } catch {
      return DEFAULT_COMPLIANCE_STATE;
    }
  }

  static async saveComplianceState(state: ComplianceState): Promise<void> {
    const todayStr = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem(
      KEYS.COMPLIANCE_STATE,
      JSON.stringify({ ...state, lockedAtDate: todayStr })
    );
  }

  // GitHub Repo (e.g. "pushpak-256/dhan-options-trader")
  static async getGitHubRepo(): Promise<string> {
    try {
      return (await AsyncStorage.getItem(KEYS.GITHUB_REPO)) || 'pushpak-256/dhan-options-trader';
    } catch {
      return 'pushpak-256/dhan-options-trader';
    }
  }

  static async saveGitHubRepo(repo: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.GITHUB_REPO, repo.trim());
  }
}
