import { DhanApiService, SquareOffSummary } from './dhanApi';
import { StorageService } from './storage';

export interface KillSwitchEvent {
  triggeredAt: number;
  maxLossLimit: number;
  actualLoss: number;
  summary: SquareOffSummary;
}

export interface WatchdogStatus {
  isMonitoring: boolean;
  isChecking: boolean;
  isExecutingKillSwitch: boolean;
  lastHeartbeatAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  lastTotalDayPnl: number;
  lastRealizedPnl: number;
  lastUnrealizedPnl: number;
  openPositionsCount: number;
  isDailyLossLocked: boolean;
  lastKillSwitchEvent: KillSwitchEvent | null;
  pollCount: number;
}

type KillSwitchListener = (event: KillSwitchEvent) => void;
type PnlListener = (totalDayPnl: number, realized: number, unrealized: number) => void;

const KILL_SWITCH_RETRY_COOLDOWN_MS = 10_000;

export class AutoSquareOffEngine {
  private static intervalId: ReturnType<typeof setInterval> | null = null;
  private static isChecking = false;
  private static isExecutingKillSwitch = false;
  private static lastKillSwitchAttemptAt = 0;
  private static lastHeartbeatAt: number | null = null;
  private static lastError: string | null = null;
  private static lastErrorAt: number | null = null;
  private static lastTotalDayPnl = 0;
  private static lastRealizedPnl = 0;
  private static lastUnrealizedPnl = 0;
  private static openPositionsCount = 0;
  private static isDailyLossLocked = false;
  private static lastKillSwitchEvent: KillSwitchEvent | null = null;
  private static pollCount = 0;

  private static killSwitchListeners: Set<KillSwitchListener> = new Set();
  private static pnlListeners: Set<PnlListener> = new Set();

  static startMonitoring(pollIntervalMs: number = 3000): void {
    if (this.intervalId) return;

    const safeInterval = Math.max(1000, pollIntervalMs);

    // Immediate initial check
    void this.checkAndEnforce();

    this.intervalId = setInterval(() => {
      void this.checkAndEnforce();
    }, safeInterval);
  }

  static stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  static getLastStatus(): WatchdogStatus {
    return {
      isMonitoring: this.intervalId !== null,
      isChecking: this.isChecking,
      isExecutingKillSwitch: this.isExecutingKillSwitch,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastTotalDayPnl: this.lastTotalDayPnl,
      lastRealizedPnl: this.lastRealizedPnl,
      lastUnrealizedPnl: this.lastUnrealizedPnl,
      openPositionsCount: this.openPositionsCount,
      isDailyLossLocked: this.isDailyLossLocked,
      lastKillSwitchEvent: this.lastKillSwitchEvent,
      pollCount: this.pollCount,
    };
  }

  static onKillSwitchTriggered(listener: KillSwitchListener): () => void {
    this.killSwitchListeners.add(listener);
    return () => this.killSwitchListeners.delete(listener);
  }

  static onPnlUpdate(listener: PnlListener): () => void {
    this.pnlListeners.add(listener);
    return () => this.pnlListeners.delete(listener);
  }

  private static notifyPnlListeners(totalDayPnl: number, realized: number, unrealized: number): void {
    this.pnlListeners.forEach((fn) => {
      try {
        fn(totalDayPnl, realized, unrealized);
      } catch (err) {
        console.warn('AutoSquareOffEngine pnl listener error:', err);
      }
    });
  }

  private static notifyKillSwitchListeners(event: KillSwitchEvent): void {
    this.killSwitchListeners.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        console.warn('AutoSquareOffEngine kill-switch listener error:', err);
      }
    });
  }

  static async checkAndEnforce(): Promise<KillSwitchEvent | null> {
    // Prevent concurrent/rapid overlapping checks or re-entry while square-off is running
    if (this.isChecking || this.isExecutingKillSwitch) return null;

    this.isChecking = true;

    try {
      const [config, initialState, positions] = await Promise.all([
        StorageService.getComplianceConfig(),
        StorageService.getComplianceState(),
        DhanApiService.getPositions(),
      ]);

      const safePositions = Array.isArray(positions) ? positions : [];
      const realized = safePositions.reduce((sum, p) => sum + (Number(p.realizedProfit) || 0), 0);
      const unrealized = safePositions.reduce((sum, p) => sum + (Number(p.unrealizedProfit) || 0), 0);
      const totalDayPnl = realized + unrealized;
      const openPositions = safePositions.filter((p) => Number(p.netQty) !== 0);
      const hasOpenPositions = openPositions.length > 0;

      // Update live watchdog telemetry
      this.lastRealizedPnl = realized;
      this.lastUnrealizedPnl = unrealized;
      this.lastTotalDayPnl = totalDayPnl;
      this.openPositionsCount = openPositions.length;
      this.isDailyLossLocked = initialState.isDailyLossLocked;
      this.lastHeartbeatAt = Date.now();
      this.lastError = null;
      this.pollCount += 1;

      // Only persist MTM changes if values actually shifted (avoids stomping concurrent state updates)
      if (
        initialState.todayRealizedPnl !== realized ||
        initialState.todayUnrealizedPnl !== unrealized
      ) {
        const latestState = await StorageService.getComplianceState();
        latestState.todayRealizedPnl = realized;
        latestState.todayUnrealizedPnl = unrealized;
        await StorageService.saveComplianceState(latestState);
      }

      // Broadcast live P&L to Header & screens
      this.notifyPnlListeners(totalDayPnl, realized, unrealized);

      // Check Max Daily Loss Breach
      const currentLoss = -totalDayPnl;
      const isBreached =
        config.maxDailyLossEnabled &&
        config.maxDailyLossAmount > 0 &&
        currentLoss >= config.maxDailyLossAmount;

      if (!isBreached) {
        // Clear retry throttle once account is back within daily loss threshold
        this.lastKillSwitchAttemptAt = 0;
        return null;
      }

      // Re-read fresh lock state to avoid double-firing after an already completed lock
      const freshState = await StorageService.getComplianceState();
      this.isDailyLossLocked = freshState.isDailyLossLocked;

      // Already locked AND zero open positions => nothing left to square off, prevent double-firing
      if (freshState.isDailyLossLocked && !hasOpenPositions) {
        return null;
      }

      // Gracefully throttle rapid retries while broker position book settles
      const now = Date.now();
      if (now - this.lastKillSwitchAttemptAt < KILL_SWITCH_RETRY_COOLDOWN_MS) {
        return null;
      }

      this.isExecutingKillSwitch = true;
      this.lastKillSwitchAttemptAt = now;

      try {
        // 1. Fire Dhan API square-off for all open positions & cancel pending orders
        const summary = await DhanApiService.squareOffAllPositions();

        // 2. Lock account for remainder of the day (merge into latest persisted state)
        const stateToLock = await StorageService.getComplianceState();
        stateToLock.isDailyLossLocked = true;
        stateToLock.todayRealizedPnl = totalDayPnl;
        stateToLock.todayUnrealizedPnl = 0;
        await StorageService.saveComplianceState(stateToLock);

        this.isDailyLossLocked = true;
        this.lastRealizedPnl = totalDayPnl;
        this.lastUnrealizedPnl = 0;
        this.openPositionsCount = 0;
        this.lastHeartbeatAt = Date.now();

        // Update P&L listeners after square-off
        this.notifyPnlListeners(totalDayPnl, totalDayPnl, 0);

        const event: KillSwitchEvent = {
          triggeredAt: Date.now(),
          maxLossLimit: config.maxDailyLossAmount,
          actualLoss: currentLoss,
          summary,
        };

        this.lastKillSwitchEvent = event;

        // 3. Notify UI
        this.notifyKillSwitchListeners(event);
        return event;
      } finally {
        this.isExecutingKillSwitch = false;
      }
    } catch (err: any) {
      this.lastError = err?.message || 'Watchdog poll failed';
      this.lastErrorAt = Date.now();
      console.warn('AutoSquareOffEngine poll error:', err);
      return null;
    } finally {
      this.isChecking = false;
    }
  }
}
