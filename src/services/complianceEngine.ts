import {
  ComplianceRulesConfig,
  ComplianceState,
  OrderPreFlightValidation,
  ValidationCheckResult,
} from '../types/compliance';
import { DhanOrderRequest } from '../types/dhan';
import { StorageService } from './storage';

export class ComplianceEngine {
  static async validateOrder(params: {
    order: DhanOrderRequest;
    lotSize: number;
    entryPrice: number;
    stopLossPrice?: number;
    targetPrice?: number;
  }): Promise<OrderPreFlightValidation> {
    const config: ComplianceRulesConfig = await StorageService.getComplianceConfig();
    const state: ComplianceState = await StorageService.getComplianceState();

    const checks: ValidationCheckResult[] = [];
    const reasons: string[] = [];
    const warnings: string[] = [];

    const { order, lotSize, entryPrice, stopLossPrice, targetPrice } = params;
    const totalQty = order.quantity;
    const lots = Math.max(1, Math.round(totalQty / lotSize));
    const now = new Date();

    // 1. Daily Loss Hard Limit
    if (config.maxDailyLossEnabled) {
      const currentLoss = -(state.todayRealizedPnl + state.todayUnrealizedPnl);
      const isLocked = state.isDailyLossLocked || currentLoss >= config.maxDailyLossAmount;

      if (isLocked) {
        checks.push({
          ruleId: 'DAILY_LOSS_LIMIT',
          ruleName: 'Max Daily Loss Lockout',
          passed: false,
          severity: 'BLOCK',
          message: `Daily loss of ₹${currentLoss.toFixed(0)} hit your limit of ₹${config.maxDailyLossAmount}. Trading is locked for today.`,
        });
        reasons.push(`Daily loss limit reached (₹${config.maxDailyLossAmount}). Trading disabled for today.`);

        if (!state.isDailyLossLocked) {
          state.isDailyLossLocked = true;
          await StorageService.saveComplianceState(state);
        }
      } else {
        checks.push({
          ruleId: 'DAILY_LOSS_LIMIT',
          ruleName: 'Max Daily Loss Lockout',
          passed: true,
          severity: 'BLOCK',
          message: `Current daily MTM: ₹${(state.todayRealizedPnl + state.todayUnrealizedPnl).toFixed(0)} / Max Loss ₹${config.maxDailyLossAmount}`,
        });
      }
    }

    // 2. Revenge Trading Cooldown
    if (config.revengeCooldownEnabled && state.cooldownUntil) {
      const remainingMs = state.cooldownUntil - Date.now();
      if (remainingMs > 0) {
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        checks.push({
          ruleId: 'REVENGE_COOLDOWN',
          ruleName: 'Revenge Trading Cooldown',
          passed: false,
          severity: 'BLOCK',
          message: `Cooldown active for another ${remainingMinutes} min after previous loss. Take a breath!`,
        });
        reasons.push(`Revenge trading cooldown active (${remainingMinutes} mins left).`);
      }
    }

    // 3. Max Lots per Order
    if (config.maxLotsPerTradeEnabled) {
      if (lots > config.maxLotsPerTrade) {
        checks.push({
          ruleId: 'MAX_LOTS',
          ruleName: 'Max Lots Per Trade',
          passed: false,
          severity: 'BLOCK',
          message: `Selected ${lots} lots exceeds your max limit of ${config.maxLotsPerTrade} lots.`,
        });
        reasons.push(`Cannot place ${lots} lots. Your limit is ${config.maxLotsPerTrade} lots.`);
      } else {
        checks.push({
          ruleId: 'MAX_LOTS',
          ruleName: 'Max Lots Per Trade',
          passed: true,
          severity: 'BLOCK',
          message: `Lot size ${lots} is within ${config.maxLotsPerTrade} lots limit.`,
        });
      }
    }

    // 4. Max Trades Per Day
    if (config.maxTradesPerDayEnabled) {
      if (state.todayTradeCount >= config.maxTradesPerDay) {
        checks.push({
          ruleId: 'MAX_TRADES',
          ruleName: 'Max Daily Trades',
          passed: false,
          severity: 'BLOCK',
          message: `You have reached your limit of ${config.maxTradesPerDay} trades today.`,
        });
        reasons.push(`Overtrading protection: ${config.maxTradesPerDay} trades completed today.`);
      } else {
        checks.push({
          ruleId: 'MAX_TRADES',
          ruleName: 'Max Daily Trades',
          passed: true,
          severity: 'BLOCK',
          message: `Trades today: ${state.todayTradeCount} / ${config.maxTradesPerDay}`,
        });
      }
    }

    // 5. Mandatory Stop Loss
    if (config.mandatoryStopLoss) {
      if (!stopLossPrice || stopLossPrice <= 0) {
        checks.push({
          ruleId: 'MANDATORY_SL',
          ruleName: 'Mandatory Stop Loss',
          passed: false,
          severity: 'BLOCK',
          message: 'Stop Loss is mandatory! Position your SL line on the chart before placing order.',
        });
        reasons.push('Stop Loss is mandatory. Set SL line on chart.');
      } else if (order.transactionType === 'BUY' && stopLossPrice >= entryPrice) {
        checks.push({
          ruleId: 'MANDATORY_SL',
          ruleName: 'Mandatory Stop Loss',
          passed: false,
          severity: 'BLOCK',
          message: 'For BUY order, Stop Loss must be strictly below Entry price.',
        });
        reasons.push('Stop Loss must be below Entry price.');
      } else if (order.transactionType === 'SELL' && stopLossPrice <= entryPrice) {
        checks.push({
          ruleId: 'MANDATORY_SL',
          ruleName: 'Mandatory Stop Loss',
          passed: false,
          severity: 'BLOCK',
          message: 'For SELL order, Stop Loss must be strictly above Entry price.',
        });
        reasons.push('For SELL order, drag Stop Loss above Entry price.');
      } else {
        checks.push({
          ruleId: 'MANDATORY_SL',
          ruleName: 'Mandatory Stop Loss',
          passed: true,
          severity: 'BLOCK',
          message: `Stop Loss defined at ₹${stopLossPrice.toFixed(2)}`,
        });
      }
    }

    // 6. Max Risk Per Trade (₹)
    if (config.maxRiskPerTradeEnabled && stopLossPrice && stopLossPrice > 0) {
      const riskPerShare = Math.abs(entryPrice - stopLossPrice);
      const totalTradeRisk = riskPerShare * totalQty;

      if (totalTradeRisk > config.maxRiskPerTradeAmount) {
        checks.push({
          ruleId: 'MAX_TRADE_RISK',
          ruleName: 'Max Risk Per Trade',
          passed: false,
          severity: 'BLOCK',
          message: `Trade risk ₹${totalTradeRisk.toFixed(0)} exceeds your limit of ₹${config.maxRiskPerTradeAmount}. Reduce lots or tighten SL.`,
        });
        reasons.push(`Total trade risk ₹${totalTradeRisk.toFixed(0)} exceeds limit of ₹${config.maxRiskPerTradeAmount}.`);
      } else {
        checks.push({
          ruleId: 'MAX_TRADE_RISK',
          ruleName: 'Max Risk Per Trade',
          passed: true,
          severity: 'BLOCK',
          message: `Trade risk ₹${totalTradeRisk.toFixed(0)} is within ₹${config.maxRiskPerTradeAmount} limit.`,
        });
      }
    }

    // 7. Minimum Risk-to-Reward Ratio
    if (config.minRiskRewardEnabled && stopLossPrice && targetPrice && stopLossPrice > 0 && targetPrice > 0) {
      const risk = Math.abs(entryPrice - stopLossPrice);
      const reward = Math.abs(targetPrice - entryPrice);
      const rrRatio = risk > 0 ? reward / risk : 0;

      if (rrRatio < config.minRiskRewardRatio) {
        checks.push({
          ruleId: 'MIN_RR',
          ruleName: 'Risk-to-Reward Ratio',
          passed: false,
          severity: 'WARNING',
          message: `R:R ratio is 1:${rrRatio.toFixed(2)}, below your target of 1:${config.minRiskRewardRatio}.`,
        });
        warnings.push(`Low Risk:Reward ratio (1:${rrRatio.toFixed(2)} vs target 1:${config.minRiskRewardRatio}).`);
      } else {
        checks.push({
          ruleId: 'MIN_RR',
          ruleName: 'Risk-to-Reward Ratio',
          passed: true,
          severity: 'WARNING',
          message: `Good R:R ratio (1:${rrRatio.toFixed(2)})`,
        });
      }
    }

    // 8. Time Filters (IST Time: UTC + 5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const hours = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes();
    const timeNum = hours * 100 + minutes;

    if (config.blockOpeningVolatility && timeNum >= 915 && timeNum < 920) {
      checks.push({
        ruleId: 'OPENING_VOLATILITY',
        ruleName: 'Opening Volatility Filter',
        passed: false,
        severity: 'BLOCK',
        message: 'No trading during the first 5 minutes (09:15 - 09:20 AM) to avoid opening volatility.',
      });
      reasons.push('Opening volatility protection active (09:15 - 09:20 AM).');
    }

    if (config.blockMarketClose && timeNum >= 1520 && timeNum <= 1530) {
      checks.push({
        ruleId: 'MARKET_CLOSE',
        ruleName: 'Market Close Filter',
        passed: false,
        severity: 'BLOCK',
        message: 'Trading restricted in closing minutes (15:20 - 15:30 PM).',
      });
      reasons.push('Market close restriction active (15:20 - 15:30 PM).');
    }

    const allowed = reasons.length === 0;

    return {
      allowed,
      reasons,
      warnings,
      checks,
    };
  }

  // Call after a closed trade
  static async recordTradeResult(pnl: number): Promise<void> {
    const config = await StorageService.getComplianceConfig();
    const state = await StorageService.getComplianceState();

    state.todayTradeCount += 1;
    state.todayRealizedPnl += pnl;

    if (pnl < 0) {
      state.consecutiveLossCount += 1;

      // Trigger cooldown if threshold met
      if (
        config.revengeCooldownEnabled &&
        state.consecutiveLossCount >= config.triggerConsecutiveLosses
      ) {
        state.cooldownUntil = Date.now() + config.revengeCooldownMinutes * 60 * 1000;
      }

      // Check if daily loss limit exceeded
      if (
        config.maxDailyLossEnabled &&
        -(state.todayRealizedPnl + state.todayUnrealizedPnl) >= config.maxDailyLossAmount
      ) {
        state.isDailyLossLocked = true;
      }
    } else {
      // Winning trade resets consecutive loss counter
      state.consecutiveLossCount = 0;
    }

    await StorageService.saveComplianceState(state);
  }
}
