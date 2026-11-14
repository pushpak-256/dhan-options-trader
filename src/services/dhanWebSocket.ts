import { StorageService } from './storage';
import { DhanApiService } from './dhanApi';

export interface MarketTick {
  securityId: string;
  exchangeSegment: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  oi?: number;
  timestamp?: number;
}

export type TickListener = (tick: MarketTick) => void;

export class DhanWebSocketService {
  private static ws: WebSocket | null = null;
  private static listeners: Map<string, Set<TickListener>> = new Map();
  private static simulatedInterval: any = null;
  private static isConnected: boolean = false;
  private static subscribedSecurities: Set<string> = new Set();

  static async connect(): Promise<void> {
    const isDemo = await DhanApiService.isDemoMode();

    if (isDemo) {
      this.startSimulatedFeed();
      return;
    }

    const creds = await StorageService.getCredentials();
    if (!creds || !creds.accessToken || !creds.clientId) {
      this.startSimulatedFeed();
      return;
    }

    try {
      // Dhan Live Market Feed WebSocket
      const wsUrl = `wss://api-feed.dhan.co?version=2&token=${creds.accessToken}&clientId=${creds.clientId}&authType=2`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        // Resubscribe to existing registered instruments
        if (this.subscribedSecurities.size > 0) {
          this.sendSubscriptionPayload();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.securityId && data.ltp) {
            this.broadcastTick({
              securityId: String(data.securityId),
              exchangeSegment: data.exchangeSegment || 'NSE_FNO',
              ltp: Number(data.ltp),
              volume: data.volume,
              oi: data.oi,
              timestamp: Date.now(),
            });
          }
        } catch {
          // Binary packets or heartbeat
        }
      };

      this.ws.onerror = () => {
        this.startSimulatedFeed();
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        // Auto reconnect after 5s or fall back to simulation
        setTimeout(() => this.connect(), 5000);
      };
    } catch {
      this.startSimulatedFeed();
    }
  }

  static subscribe(securityId: string, listener: TickListener): () => void {
    this.subscribedSecurities.add(securityId);

    if (!this.listeners.has(securityId)) {
      this.listeners.set(securityId, new Set());
    }
    this.listeners.get(securityId)!.add(listener);

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionPayload();
    }

    // Return unsubscribe function
    return () => {
      const set = this.listeners.get(securityId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(securityId);
          this.subscribedSecurities.delete(securityId);
        }
      }
    };
  }

  private static broadcastTick(tick: MarketTick): void {
    const set = this.listeners.get(tick.securityId);
    if (set) {
      set.forEach((fn) => fn(tick));
    }
  }

  private static sendSubscriptionPayload(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const instruments = Array.from(this.subscribedSecurities).map((secId) => ({
      ExchangeSegment: 'NSE_FNO',
      SecurityId: secId,
    }));

    const payload = {
      RequestCode: 21, // Ticker feed code
      InstrumentCount: instruments.length,
      InstrumentList: instruments,
    };

    this.ws.send(JSON.stringify(payload));
  }

  // Realistic simulation tick engine when offline / demo mode
  private static startSimulatedFeed(): void {
    if (this.simulatedInterval) return;

    this.simulatedInterval = setInterval(() => {
      this.subscribedSecurities.forEach((secId) => {
        // Micro fluctuation (random -0.25 to +0.25)
        const delta = (Math.random() - 0.49) * 0.5;
        this.broadcastTick({
          securityId: secId,
          exchangeSegment: 'NSE_FNO',
          ltp: Number((150 + delta).toFixed(2)),
          timestamp: Date.now(),
        });
      });
    }, 1000);
  }

  static disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.simulatedInterval) {
      clearInterval(this.simulatedInterval);
      this.simulatedInterval = null;
    }
    this.isConnected = false;
  }
}
