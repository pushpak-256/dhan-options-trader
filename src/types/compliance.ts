export interface ComplianceRulesConfig {
  // 1. Max Daily Loss
  maxDailyLossEnabled: boolean;
  maxDailyLossAmount: number; // e.g. 5000 INR

  // 2. Max Risk Per Trade
  maxRiskPerTradeEnabled: boolean;
  maxRiskPerTradeAmount: number; // e.g. 1500 INR

  // 3. Max Lots Per Order
  maxLotsPerTradeEnabled: boolean;
  maxLotsPerTrade: number; // e.g. 2 lots

  // 4. Max Trades Per Day
  maxTradesPerDayEnabled: boolean;
  maxTradesPerDay: number; // e.g. 4 trades

  // 5. Mandatory Stop Loss
  mandatoryStopLoss: boolean; // Order rejected if SL not placed

  // 6. Minimum Risk-to-Reward Ratio
  minRiskRewardEnabled: boolean;
  minRiskRewardRatio: number; // e.g. 1.5

  // 7. Revenge Trading Cooldown
  revengeCooldownEnabled: boolean;
  revengeCooldownMinutes: number; // e.g. 15 minutes after a losing trade
  triggerConsecutiveLosses: number; // trigger cooldown after N consecutive losses (e.g. 1 or 2)

  // 8. Time Filters
  blockOpeningVolatility: boolean; // 09:15 - 09:20 AM
  blockMarketClose: boolean; // 15:20 - 15:30 PM
}

export interface ComplianceState {
  todayRealizedPnl: number;
  todayUnrealizedPnl: number;
  todayTradeCount: number;
  consecutiveLossCount: number;
  cooldownUntil: number | null; // epoch timestamp
  isDailyLossLocked: boolean;
  lockedAtDate?: string; // YYYY-MM-DD
}

export interface ValidationCheckResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  severity: 'BLOCK' | 'WARNING';
  message: string;
}

export interface OrderPreFlightValidation {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  checks: ValidationCheckResult[];
}
