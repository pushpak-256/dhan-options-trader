import { DhanApiService, SquareOffSummary } from './dhanApi';
import { StorageService } from './storage';

export interface KillSwitchEvent {
  triggeredAt: number;
  maxLossLimit: number;
  actualLoss: number;
  summary: SquareOffSummary;
}

type KillSwitchListener = (event: KillSwitchEvent) => void;
type PnlListener = (totalDayPnl: number, realized: number, unrealized: number) => void;

export class AutoSquareOffEngine {
  private static intervalId: any = null;
  private static isExecutingKillSwitch = false;
  private static killSwitchListeners: Set<KillSwitchListener> = new Set();
  private static pnlListeners: Set<PnlListener> = new Set();

  static startMonitoring(pollIntervalMs: number = 3000): void {
    if (this.intervalId) return;

    // Immediate initial check
    this.checkAndEnforce();

    this.intervalId = setInterval(() => {
      this.checkAndEnforce();
    }, pollIntervalMs);
  }

  static stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  static onKillSwitchTriggered(listener: KillSwitchListener): () => void {
    this.killSwitchListeners.add(listener);
    return () => this.killSwitchListeners.delete(listener);
  }

  static onPnlUpdate(listener: PnlListener): () => void {
    this.pnlListeners.add(listener);
    return () => this.pnlListeners.delete(listener);
  }

  static async checkAndEnforce(): Promise<KillSwitchEvent | null> {
    if (this.isExecutingKillSwitch) return null;

    try {
      const config = await StorageService.getComplianceConfig();
      const state = await StorageService.getComplianceState();
      const positions = await DhanApiService.getPositions();

      const realized = positions.reduce((sum, p) => sum + (p.realizedProfit || 0), 0);
      const unrealized = positions.reduce((sum, p) => sum + (p.unrealizedProfit || 0), 0);
      const totalDayPnl = realized + unrealized;
      const hasOpenPositions = positions.some((p) => p.netQty !== 0);

      // Update stored state with live MTM
      state.todayRealizedPnl = realized;
      state.todayUnrealizedPnl = unrealized;
      await StorageService.saveComplianceState(state);

      // Broadcast live P&L to Header & screens
      this.pnlListeners.forEach((fn) => fn(totalDayPnl, realized, unrealized));

      // Check Max Daily Loss Breach
      const currentLoss = -totalDayPnl;
      if (
        config.maxDailyLossEnabled &&
        config.maxDailyLossAmount > 0 &&
        currentLoss >= config.maxDailyLossAmount
      ) {
        // Trigger auto-exit if there are open positions OR if not yet locked
        if (hasOpenPositions || !state.isDailyLossLocked) {
          this.isExecutingKillSwitch = true;

          try {
            // 1. Fire Dhan API square-off for all open positions & cancel pending orders
            const summary = await DhanApiService.squareOffAllPositions();

            // 2. Lock account for remainder of the day
            state.isDailyLossLocked = true;
            state.todayRealizedPnl = totalDayPnl;
            state.todayUnrealizedPnl = 0;
            await StorageService.saveComplianceState(state);

            // Update P&L listeners after square-off
            this.pnlListeners.forEach((fn) => fn(totalDayPnl, totalDayPnl, 0));

            const event: KillSwitchEvent = {
              triggeredAt: Date.now(),
              maxLossLimit: config.maxDailyLossAmount,
              actualLoss: currentLoss,
              summary,
            };

            // 3. Notify UI
            this.killSwitchListeners.forEach((fn) => fn(event));
            return event;
          } finally {
            this.isExecutingKillSwitch = false;
          }
        }
      }
    } catch (err) {
      console.warn('AutoSquareOffEngine poll error:', err);
    }

    return null;
  }
}
