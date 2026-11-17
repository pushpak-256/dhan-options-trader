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

export interface SubscribeOptions {
  exchangeSegment?: string;
  seedPrice?: number;
  requestCode?: 15 | 17 | 21;
}

export interface BatchInstrument {
  securityId: string;
  exchangeSegment: string;
  seedPrice?: number;
  requestCode?: 15 | 17 | 21;
}

export type TickListener = (tick: MarketTick) => void;

interface SubscriptionMeta {
  exchangeSegment: string;
  seedPrice: number;
  currentSimPrice: number;
  requestCode: 15 | 17 | 21;
}

export interface DecodedBinaryFrame {
  ticks: MarketTick[];
  disconnectCode?: number;
}

const MAX_INSTRUMENTS_PER_FRAME = 100;
const SIMULATED_TICK_INTERVAL_MS = 350;

const EXCHANGE_SEGMENT_BY_BYTE: Record<number, string> = {
  0: 'IDX_I',
  1: 'NSE_EQ',
  2: 'NSE_FNO',
  3: 'NSE_CURRENCY',
  4: 'BSE_EQ',
  5: 'MCX_COMM',
  7: 'BSE_CURRENCY',
  8: 'BSE_FNO',
};

const DEFAULT_FALLBACK_PACKET_LENGTH: Record<number, number> = {
  2: 16,  // Ticker packet
  4: 50,  // Quote packet
  8: 162, // Full packet
  50: 10, // Disconnect packet
};

function finitePrice(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Number(value.toFixed(2));
}

function normalizeLttToMs(ltt: number): number {
  if (!Number.isFinite(ltt) || ltt <= 0) return Date.now();
  // DhanHQ v2 LTT is Unix epoch seconds (~1.7e9); convert to ms
  if (ltt > 1e12) return Math.floor(ltt);
  if (ltt > 1e9) return Math.floor(ltt * 1000);
  return Date.now();
}

export class DhanWebSocketService {
  private static ws: WebSocket | null = null;
  private static listeners: Map<string, Set<TickListener>> = new Map();
  private static subscriptionMeta: Map<string, SubscriptionMeta> = new Map();
  private static subscribedSecurities: Set<string> = new Set();
  private static simulatedInterval: ReturnType<typeof setInterval> | null = null;
  private static reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static isConnected: boolean = false;
  private static isConnecting: boolean = false;
  private static isManualDisconnect: boolean = false;

  /**
   * Decodes one or more Little-Endian DhanHQ v2 binary Live Market Feed packets
   * from a WebSocket ArrayBuffer frame.
   *
   * Header (8 bytes):
   *  - byte 0:     responseCode (Uint8): 2=Ticker(16B), 4=Quote(50B), 8=Full(162B), 50=Disconnect
   *  - bytes 1..2: messageLength (Uint16 LE)
   *  - byte 3:     exchangeSegment byte (0=IDX_I, 1=NSE_EQ, 2=NSE_FNO, 4=BSE_EQ, 8=BSE_FNO)
   *  - bytes 4..7: securityId (Int32 LE)
   */
  static decodeBinaryFrame(buffer: ArrayBuffer): DecodedBinaryFrame {
    const ticks: MarketTick[] = [];
    let disconnectCode: number | undefined;

    if (!buffer || buffer.byteLength < 8) {
      return { ticks, disconnectCode };
    }

    const view = new DataView(buffer);
    let offset = 0;

    while (offset + 8 <= buffer.byteLength) {
      const responseCode = view.getUint8(offset);
      const declaredLen = view.getUint16(offset + 1, true);
      const exchangeByte = view.getUint8(offset + 3);
      const securityIdNum = view.getInt32(offset + 4, true);

      const fallbackLen = DEFAULT_FALLBACK_PACKET_LENGTH[responseCode] || declaredLen;
      const packetLen = declaredLen >= 8 ? declaredLen : fallbackLen;

      if (!packetLen || packetLen < 8 || offset + packetLen > buffer.byteLength) {
        if (offset === 0 && fallbackLen >= 8 && buffer.byteLength >= fallbackLen) {
          // Single packet whose declared length was 0 or mismatched
        } else {
          break;
        }
      }

      const step =
        packetLen >= 8 && offset + packetLen <= buffer.byteLength
          ? packetLen
          : buffer.byteLength - offset;

      const securityId = String(securityIdNum);
      const exchangeSegment = EXCHANGE_SEGMENT_BY_BYTE[exchangeByte] || 'NSE_FNO';

      if (responseCode === 2 && offset + 16 <= buffer.byteLength) {
        // Ticker Packet (16B): Float32 LE ltp @ 8, Int32 LE ltt @ 12
        const ltp = finitePrice(view.getFloat32(offset + 8, true));
        const ltt = view.getInt32(offset + 12, true);
        if (ltp !== undefined) {
          ticks.push({
            securityId,
            exchangeSegment,
            ltp,
            timestamp: normalizeLttToMs(ltt),
          });
        }
      } else if (responseCode === 4 && offset + 50 <= buffer.byteLength) {
        // Quote Packet (50B): ltp @ 8, ltt @ 14, volume @ 22, open/close/high/low @ 34/38/42/46
        const ltp = finitePrice(view.getFloat32(offset + 8, true));
        const ltt = view.getInt32(offset + 14, true);
        const rawVol = view.getInt32(offset + 22, true);
        const open = finitePrice(view.getFloat32(offset + 34, true));
        const close = finitePrice(view.getFloat32(offset + 38, true));
        const high = finitePrice(view.getFloat32(offset + 42, true));
        const low = finitePrice(view.getFloat32(offset + 46, true));
        if (ltp !== undefined) {
          ticks.push({
            securityId,
            exchangeSegment,
            ltp,
            volume: rawVol >= 0 ? rawVol : undefined,
            open,
            close,
            high,
            low,
            timestamp: normalizeLttToMs(ltt),
          });
        }
      } else if (responseCode === 8 && offset + 62 <= buffer.byteLength) {
        // Full Packet (162B): ltp @ 8, ltt @ 14, volume @ 22, oi @ 34, open/close/high/low @ 46/50/54/58
        const ltp = finitePrice(view.getFloat32(offset + 8, true));
        const ltt = view.getInt32(offset + 14, true);
        const rawVol = view.getInt32(offset + 22, true);
        const rawOi = view.getInt32(offset + 34, true);
        const open = finitePrice(view.getFloat32(offset + 46, true));
        const close = finitePrice(view.getFloat32(offset + 50, true));
        const high = finitePrice(view.getFloat32(offset + 54, true));
        const low = finitePrice(view.getFloat32(offset + 58, true));
        if (ltp !== undefined) {
          ticks.push({
            securityId,
            exchangeSegment,
            ltp,
            volume: rawVol >= 0 ? rawVol : undefined,
            oi: rawOi >= 0 ? rawOi : undefined,
            open,
            close,
            high,
            low,
            timestamp: normalizeLttToMs(ltt),
          });
        }
      } else if (responseCode === 50) {
        disconnectCode = offset + 10 <= buffer.byteLength ? view.getInt16(offset + 8, true) : 0;
      }

      offset += step;
    }

    return { ticks, disconnectCode };
  }

  static async connect(): Promise<void> {
    this.isManualDisconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

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

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.isConnecting) return;

    this.isConnecting = true;

    try {
      const wsUrl = `wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(
        creds.accessToken
      )}&clientId=${encodeURIComponent(creds.clientId)}&authType=2`;
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      this.ws = socket;

      socket.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        if (!this.hasMockSubscriptions()) {
          this.stopSimulatedFeed();
        }
        if (this.subscribedSecurities.size > 0) {
          this.sendSubscriptionPayload();
        }
      };

      socket.onmessage = (event) => {
        const raw = event.data;

        if (raw instanceof ArrayBuffer) {
          this.handleBinaryBuffer(raw);
          return;
        }

        if (ArrayBuffer.isView(raw)) {
          const slice = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
          if (slice instanceof ArrayBuffer) {
            this.handleBinaryBuffer(slice);
          }
          return;
        }

        if (typeof Blob !== 'undefined' && raw instanceof Blob) {
          raw
            .arrayBuffer()
            .then((buf) => this.handleBinaryBuffer(buf))
            .catch(() => {});
          return;
        }

        if (typeof raw === 'string') {
          try {
            const data = JSON.parse(raw);
            if (data && data.securityId && data.ltp) {
              const secId = String(data.securityId);
              const meta = this.subscriptionMeta.get(secId);
              this.broadcastTick({
                securityId: secId,
                exchangeSegment: data.exchangeSegment || meta?.exchangeSegment || 'NSE_FNO',
                ltp: Number(data.ltp),
                volume: data.volume,
                oi: data.oi,
                timestamp: Date.now(),
              });
            }
          } catch {
            // Non-JSON heartbeat
          }
        }
      };

      socket.onerror = () => {
        this.isConnecting = false;
        this.startSimulatedFeed();
      };

      socket.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        if (this.ws === socket) {
          this.ws = null;
        }
        if (!this.isManualDisconnect) {
          this.startSimulatedFeed();
          if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.connect();
            }, 5000);
          }
        }
      };
    } catch {
      this.isConnecting = false;
      this.startSimulatedFeed();
    }
  }

  private static handleBinaryBuffer(buffer: ArrayBuffer): void {
    const { ticks, disconnectCode } = this.decodeBinaryFrame(buffer);
    for (const tick of ticks) {
      this.broadcastTick(tick);
    }
    if (disconnectCode !== undefined) {
      console.warn(`DhanHQ WebSocket server disconnect packet received (code: ${disconnectCode})`);
    }
  }

  /**
   * Subscribe to a single instrument (backward-compatible).
   */
  static subscribe(
    securityId: string,
    listener: TickListener,
    options?: SubscribeOptions
  ): () => void {
    const secId = String(securityId);
    const existingMeta = this.subscriptionMeta.get(secId);
    const seedPrice =
      options?.seedPrice && options.seedPrice > 0
        ? options.seedPrice
        : existingMeta?.seedPrice || 150;
    const exchangeSegment =
      options?.exchangeSegment || existingMeta?.exchangeSegment || 'NSE_FNO';
    const requestCode: 15 | 17 | 21 = options?.requestCode || existingMeta?.requestCode || 17;

    this.subscribedSecurities.add(secId);
    this.subscriptionMeta.set(secId, {
      exchangeSegment,
      seedPrice,
      currentSimPrice:
        options?.seedPrice && options.seedPrice > 0
          ? options.seedPrice
          : existingMeta?.currentSimPrice || seedPrice,
      requestCode,
    });

    if (!this.listeners.has(secId)) {
      this.listeners.set(secId, new Set());
    }
    this.listeners.get(secId)!.add(listener);

    if (secId.startsWith('MOCK_')) {
      this.startSimulatedFeed();
    } else if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionPayload([secId]);
    }

    return () => {
      this.unsubscribeMany([secId], listener);
    };
  }

  /**
   * Batch-subscribe up to 100+ instruments cleanly on the single DhanHQ v2 Binary WebSocket.
   * Defaults to RequestCode 15 (Ticker) grouped by ExchangeSegment (NSE_FNO vs BSE_FNO / IDX_I).
   */
  static subscribeMany(
    instruments: BatchInstrument[],
    listener?: TickListener
  ): () => void {
    if (!instruments || instruments.length === 0) {
      return () => {};
    }

    const registeredIds: string[] = [];
    let hasMock = false;

    for (const inst of instruments) {
      if (!inst || !inst.securityId) continue;
      const secId = String(inst.securityId);
      const existingMeta = this.subscriptionMeta.get(secId);
      const seedPrice =
        inst.seedPrice && inst.seedPrice > 0
          ? inst.seedPrice
          : existingMeta?.seedPrice || 150;
      const exchangeSegment =
        inst.exchangeSegment || existingMeta?.exchangeSegment || 'NSE_FNO';
      // Preserve higher-detail requestCode (e.g. 17 Quote from active chart) if already subscribed
      const requestCode: 15 | 17 | 21 =
        existingMeta?.requestCode && existingMeta.requestCode > (inst.requestCode || 15)
          ? existingMeta.requestCode
          : inst.requestCode || 15;

      this.subscribedSecurities.add(secId);
      this.subscriptionMeta.set(secId, {
        exchangeSegment,
        seedPrice,
        currentSimPrice:
          existingMeta?.currentSimPrice && existingMeta.currentSimPrice > 0
            ? existingMeta.currentSimPrice
            : seedPrice,
        requestCode,
      });

      if (listener) {
        if (!this.listeners.has(secId)) {
          this.listeners.set(secId, new Set());
        }
        this.listeners.get(secId)!.add(listener);
      }

      if (secId.startsWith('MOCK_')) {
        hasMock = true;
      }
      registeredIds.push(secId);
    }

    if (hasMock) {
      this.startSimulatedFeed();
    }

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionPayload(registeredIds);
    }

    return () => {
      this.unsubscribeMany(registeredIds, listener);
    };
  }

  /**
   * Batch-unsubscribe instruments cleanly. Only sends broker unsubscribe frames
   * (RequestCode 16 for Ticker / 18 for Quote, grouped by ExchangeSegment) for
   * instruments with zero remaining listeners — preserving any overlapping active chart subscription.
   */
  static unsubscribeMany(securityIds: string[], listener?: TickListener): void {
    if (!securityIds || securityIds.length === 0) return;

    const toUnsubFromBroker: Array<{ securityId: string; meta: SubscriptionMeta }> = [];

    for (const rawId of securityIds) {
      const secId = String(rawId);
      const set = this.listeners.get(secId);

      if (set) {
        if (listener) {
          set.delete(listener);
        } else {
          set.clear();
        }
      }

      const remaining = this.listeners.get(secId)?.size ?? 0;
      if (remaining === 0) {
        const meta = this.subscriptionMeta.get(secId);
        this.listeners.delete(secId);
        this.subscribedSecurities.delete(secId);
        this.subscriptionMeta.delete(secId);

        if (meta && !secId.startsWith('MOCK_')) {
          toUnsubFromBroker.push({ securityId: secId, meta });
        }
      }
    }

    if (
      toUnsubFromBroker.length > 0 &&
      this.isConnected &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      this.sendBatchUnsubscribePayload(toUnsubFromBroker);
    }

    if (this.isConnected && !this.hasMockSubscriptions()) {
      this.stopSimulatedFeed();
    }
  }

  /**
   * Aligns the simulated feed anchor price for an already-subscribed instrument
   * (e.g. once historical candles finish loading so live ticks continue seamlessly from last close).
   */
  static updateSeedPrice(securityId: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const meta = this.subscriptionMeta.get(String(securityId));
    if (meta) {
      meta.seedPrice = price;
      meta.currentSimPrice = price;
    }
  }

  static getSubscribedCount(): number {
    return this.subscribedSecurities.size;
  }

  private static hasMockSubscriptions(): boolean {
    for (const secId of this.subscribedSecurities) {
      if (secId.startsWith('MOCK_')) return true;
    }
    return false;
  }

  private static broadcastTick(tick: MarketTick): void {
    const set = this.listeners.get(tick.securityId);
    if (set) {
      set.forEach((fn) => {
        try {
          fn(tick);
        } catch (err) {
          console.warn('Tick listener error:', err);
        }
      });
    }
  }

  /**
   * Sends DhanHQ v2 Subscribe payloads (RequestCode 15 Ticker / 17 Quote / 21 Full),
   * grouped cleanly by RequestCode + ExchangeSegment and chunked at 100 instruments per frame.
   */
  private static sendSubscriptionPayload(targetIds?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const ids = targetIds || Array.from(this.subscribedSecurities);
    const grouped = new Map<
      string,
      { requestCode: number; instruments: Array<{ ExchangeSegment: string; SecurityId: string }> }
    >();

    for (const secId of ids) {
      if (secId.startsWith('MOCK_')) continue;
      const meta = this.subscriptionMeta.get(secId);
      const reqCode = meta?.requestCode || 15;
      const seg = meta?.exchangeSegment || 'NSE_FNO';
      const groupKey = `${reqCode}:${seg}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { requestCode: reqCode, instruments: [] });
      }
      grouped.get(groupKey)!.instruments.push({
        ExchangeSegment: seg,
        SecurityId: secId,
      });
    }

    grouped.forEach(({ requestCode, instruments }) => {
      for (let i = 0; i < instruments.length; i += MAX_INSTRUMENTS_PER_FRAME) {
        const batch = instruments.slice(i, i + MAX_INSTRUMENTS_PER_FRAME);
        const payload = {
          RequestCode: requestCode,
          InstrumentCount: batch.length,
          InstrumentList: batch,
        };
        try {
          this.ws?.send(JSON.stringify(payload));
        } catch (err) {
          console.warn('DhanHQ WS subscribe failed:', err);
        }
      }
    });
  }

  /**
   * Sends batched DhanHQ v2 Unsubscribe payloads (RequestCode 16 for Ticker, 18 for Quote, 22 for Full),
   * grouped by UnsubscribeCode + ExchangeSegment and chunked at 100 instruments per frame.
   */
  private static sendBatchUnsubscribePayload(
    items: Array<{ securityId: string; meta: SubscriptionMeta }>
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const grouped = new Map<
      string,
      { unsubCode: number; instruments: Array<{ ExchangeSegment: string; SecurityId: string }> }
    >();

    for (const { securityId, meta } of items) {
      const unsubCode = meta.requestCode === 15 ? 16 : meta.requestCode === 21 ? 22 : 18;
      const groupKey = `${unsubCode}:${meta.exchangeSegment}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { unsubCode, instruments: [] });
      }
      grouped.get(groupKey)!.instruments.push({
        ExchangeSegment: meta.exchangeSegment,
        SecurityId: securityId,
      });
    }

    grouped.forEach(({ unsubCode, instruments }) => {
      for (let i = 0; i < instruments.length; i += MAX_INSTRUMENTS_PER_FRAME) {
        const batch = instruments.slice(i, i + MAX_INSTRUMENTS_PER_FRAME);
        const payload = {
          RequestCode: unsubCode,
          InstrumentCount: batch.length,
          InstrumentList: batch,
        };
        try {
          this.ws?.send(JSON.stringify(payload));
        } catch {
          // Ignore unsubscribe error on closing socket
        }
      }
    });
  }

  // Smooth 350ms zero-lag multi-instrument random-walk tick engine for Demo Mode / offline / MOCK_ instruments
  private static startSimulatedFeed(): void {
    if (this.simulatedInterval) return;

    this.simulatedInterval = setInterval(() => {
      const now = Date.now();

      this.subscribedSecurities.forEach((secId) => {
        // If live WS is connected, only simulate MOCK_ instruments (after-hours fallback)
        if (this.isConnected && !secId.startsWith('MOCK_')) {
          return;
        }

        const meta = this.subscriptionMeta.get(secId);
        const seg = meta?.exchangeSegment || 'NSE_FNO';
        const seed = meta?.seedPrice && meta.seedPrice > 0 ? meta.seedPrice : 150;
        const current = meta?.currentSimPrice && meta.currentSimPrice > 0 ? meta.currentSimPrice : seed;

        const isIndexSpot = seg === 'IDX_I';
        // Index spot ticks smoothly (±0.01%–0.04%); options tick ±0.08%–0.35% every 350ms
        const magnitude = isIndexSpot
          ? 0.0001 + Math.random() * 0.0003
          : 0.0008 + Math.random() * 0.0027;

        const driftRatio = (current - seed) / Math.max(seed, 1);
        const upBias = Math.max(0.32, Math.min(0.68, 0.5 - driftRatio * 1.4));
        const direction = Math.random() < upBias ? 1 : -1;

        const rawNext = current * (1 + direction * magnitude);
        // Snap to Indian F&O ₹0.05 tick size
        const nextPrice = Math.max(0.05, Number((Math.round(rawNext * 20) / 20).toFixed(2)));

        if (meta) {
          meta.currentSimPrice = nextPrice;
        }

        const tickVolume = isIndexSpot ? undefined : Math.floor(15 + Math.random() * 140);

        this.broadcastTick({
          securityId: secId,
          exchangeSegment: seg,
          ltp: nextPrice,
          volume: tickVolume,
          timestamp: now,
        });
      });
    }, SIMULATED_TICK_INTERVAL_MS);
  }

  private static stopSimulatedFeed(): void {
    if (this.simulatedInterval) {
      clearInterval(this.simulatedInterval);
      this.simulatedInterval = null;
    }
  }

  static disconnect(): void {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.stopSimulatedFeed();
    this.isConnected = false;
    this.isConnecting = false;
  }
}
