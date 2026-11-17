import { Platform } from 'react-native';
import axios, { AxiosInstance } from 'axios';
import {
  DhanCredentials,
  DhanProfile,
  DhanFundLimit,
  OptionChainData,
  OptionContract,
  OptionStrikeRow,
  CandleData,
  DhanOrderRequest,
  DhanOrderResponse,
  DhanPosition,
  DhanOrder,
} from '../types/dhan';
import { StorageService } from './storage';
import { SUPPORTED_INDICES } from '../constants/indices';
import {
  generateMockOptionChain,
  generateMockCandles,
  MOCK_FUND_LIMIT,
  MOCK_POSITIONS,
} from './mockData';

function getDhanBaseUrl(): string {
  // On deployed web (PWA on Netlify), route via stateless /api/dhan proxy to avoid browser CORS blocks.
  // On native iOS/Android APK, connect directly to DhanHQ v2 API.
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1')
  ) {
    return '/api/dhan';
  }
  return 'https://api.dhan.co/v2';
}

export interface SquareOffSummary {
  exitedCount: number;
  cancelledOrdersCount: number;
  orderIds: string[];
  exitedSymbols: string[];
  totalPnlAtExit: number;
}

let demoPositionsStore: DhanPosition[] = [...MOCK_POSITIONS.map((p) => ({ ...p }))];

export class DhanApiService {
  private static client: AxiosInstance | null = null;
  private static cachedCreds: DhanCredentials | null = null;

  static async getClient(): Promise<AxiosInstance> {
    const creds = await StorageService.getCredentials();
    this.cachedCreds = creds;

    return axios.create({
      baseURL: getDhanBaseUrl(),
      headers: {
        'access-token': creds?.accessToken || '',
        'client-id': creds?.clientId || '',
        'Content-Type': 'application/json',
      },
      timeout: 12000,
    });
  }

  static async isDemoMode(): Promise<boolean> {
    const creds = await StorageService.getCredentials();
    return !creds || !creds.accessToken || creds.isDemoMode === true;
  }

  // 1. Profile & Verification
  static async getProfile(): Promise<DhanProfile> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return {
        dhanClientId: 'DEMO_USER_001',
        clientName: 'Demo Trader (BYOK to connect Dhan)',
        email: 'trader@demo.local',
        mobile: '9999999999',
        status: 'DEMO_SIMULATION',
      };
    }

    try {
      const client = await this.getClient();
      const creds = await StorageService.getCredentials();
      try {
        const res = await client.get('/profile');
        return {
          dhanClientId: res.data.dhanClientId || creds?.clientId || '',
          clientName: res.data.clientName || `Dhan Trader (${creds?.clientId})`,
          email: res.data.email || '',
          mobile: res.data.mobile || '',
          status: res.data.tokenValidity || 'ACTIVE',
        };
      } catch {
        // Fallback: verify token via /fundlimit (supported across all DhanHQ v2 accounts)
        const fundRes = await client.get('/fundlimit');
        return {
          dhanClientId: fundRes.data.dhanClientId || creds?.clientId || '',
          clientName: `Dhan Account ${fundRes.data.dhanClientId || creds?.clientId}`,
          email: '',
          mobile: '',
          status: 'ACTIVE',
        };
      }
    } catch (err: any) {
      console.warn('Dhan profile verification failed:', err.message);
      throw new Error(
        err.response?.data?.internalErrorMessage ||
          err.response?.data?.message ||
          'Connection failed. Verify Client ID & Access Token (and note browser CORS on localhost).'
      );
    }
  }

  // 2. Fund Limits
  static async getFundLimits(): Promise<DhanFundLimit> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return MOCK_FUND_LIMIT;
    }

    try {
      const client = await this.getClient();
      const res = await client.get('/fundlimit');
      return {
        availMargin: res.data.availabelBalance ?? res.data.availMargin ?? 0,
        utilizedMargin: res.data.utilizedAmount ?? res.data.utilizedMargin ?? 0,
        collateralMargin: res.data.collateralAmount ?? res.data.collateralMargin ?? 0,
        cashBalance: res.data.withdrawableBalance ?? res.data.sodLimit ?? res.data.cashBalance ?? 0,
      };
    } catch {
      return MOCK_FUND_LIMIT;
    }
  }

  // 3. Option Chain (NIFTY, BANKNIFTY, SENSEX)
  // Parses DhanHQ v2 /optionchain real response:
  //   { data: { last_price, oc: { "24200.000000": { ce: { last_price, previous_close_price, oi, previous_oi, volume, implied_volatility, greeks: { delta, theta, gamma, vega }, top_bid_price, top_ask_price, security_id }, pe: { ... } } } } }
  static async getOptionChain(indexKey: string, expiry?: string): Promise<OptionChainData> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      const mockChain = generateMockOptionChain(indexKey);
      if (expiry) mockChain.selectedExpiry = expiry;
      return mockChain;
    }

    try {
      const client = await this.getClient();
      const idxConfig = SUPPORTED_INDICES[indexKey] || SUPPORTED_INDICES.NIFTY;
      const underlyingScrip = Number(idxConfig.underlyingSecurityId) || 13;

      // --- Always fetch expiry list so UI retains all expiry chips ---
      let expiryDates: string[] = [];
      let targetExpiry = expiry;
      try {
        const expRes = await client.post('/optionchain/expirylist', {
          UnderlyingScrip: underlyingScrip,
          UnderlyingSeg: 'IDX_I',
        });
        if (expRes.data?.data?.length > 0) {
          expiryDates = expRes.data.data;
          if (!targetExpiry) {
            targetExpiry = expiryDates[0];
          }
        }
      } catch {
        // If expiry list fetch fails, continue with what we have
        if (!targetExpiry) {
          return generateMockOptionChain(indexKey);
        }
      }

      const res = await client.post('/optionchain', {
        UnderlyingScrip: underlyingScrip,
        UnderlyingSeg: 'IDX_I',
        Expiry: targetExpiry,
      });

      // --- Parse real DhanHQ v2 oc map ---
      const responseData = res.data?.data;
      const ocMap: Record<string, any> | undefined = responseData?.oc;

      if (!responseData || !ocMap || Object.keys(ocMap).length === 0) {
        return generateMockOptionChain(indexKey);
      }

      const underlyingLtp: number = responseData.last_price ?? 0;
      const step = idxConfig.strikeStep;
      const atmStrike = Math.round(underlyingLtp / step) * step;

      const strikes: OptionStrikeRow[] = [];

      for (const strikePriceStr of Object.keys(ocMap)) {
        const strikePrice = parseFloat(strikePriceStr);
        if (isNaN(strikePrice)) continue;

        const entry = ocMap[strikePriceStr];
        const rawCe = entry?.ce;
        const rawPe = entry?.pe;

        const ceGreeks = rawCe?.greeks || {};
        const peGreeks = rawPe?.greeks || {};

        const ceLtp = rawCe?.last_price ?? 0;
        const cePrevClose = rawCe?.previous_close_price ?? 0;
        const ceChange = cePrevClose ? ceLtp - cePrevClose : 0;
        const ceChangePct = cePrevClose ? (ceChange / cePrevClose) * 100 : 0;
        const ceOi = rawCe?.oi ?? 0;
        const cePrevOi = rawCe?.previous_oi ?? 0;

        const peLtp = rawPe?.last_price ?? 0;
        const pePrevClose = rawPe?.previous_close_price ?? 0;
        const peChange = pePrevClose ? peLtp - pePrevClose : 0;
        const peChangePct = pePrevClose ? (peChange / pePrevClose) * 100 : 0;
        const peOi = rawPe?.oi ?? 0;
        const pePrevOi = rawPe?.previous_oi ?? 0;

        const callContract: OptionContract = {
          securityId: String(rawCe?.security_id ?? `${indexKey}_${strikePrice}_CE`),
          tradingSymbol: `${indexKey} ${targetExpiry || ''} ${strikePrice} CE`,
          symbol: indexKey,
          strikePrice,
          optionType: 'CALL',
          expiryDate: targetExpiry || '',
          exchangeSegment: idxConfig.exchangeSegment,
          lotSize: idxConfig.lotSize,
          ltp: ceLtp,
          previousClose: cePrevClose,
          change: Number(ceChange.toFixed(2)),
          changePercent: Number(ceChangePct.toFixed(2)),
          oi: ceOi,
          oiChange: ceOi - cePrevOi,
          volume: rawCe?.volume ?? 0,
          iv: rawCe?.implied_volatility,
          delta: ceGreeks.delta,
          theta: ceGreeks.theta,
          bidPrice: rawCe?.top_bid_price,
          askPrice: rawCe?.top_ask_price,
        };

        const putContract: OptionContract = {
          securityId: String(rawPe?.security_id ?? `${indexKey}_${strikePrice}_PE`),
          tradingSymbol: `${indexKey} ${targetExpiry || ''} ${strikePrice} PE`,
          symbol: indexKey,
          strikePrice,
          optionType: 'PUT',
          expiryDate: targetExpiry || '',
          exchangeSegment: idxConfig.exchangeSegment,
          lotSize: idxConfig.lotSize,
          ltp: peLtp,
          previousClose: pePrevClose,
          change: Number(peChange.toFixed(2)),
          changePercent: Number(peChangePct.toFixed(2)),
          oi: peOi,
          oiChange: peOi - pePrevOi,
          volume: rawPe?.volume ?? 0,
          iv: rawPe?.implied_volatility,
          delta: peGreeks.delta,
          theta: peGreeks.theta,
          bidPrice: rawPe?.top_bid_price,
          askPrice: rawPe?.top_ask_price,
        };

        strikes.push({
          strikePrice,
          call: callContract,
          put: putContract,
          isATM: strikePrice === atmStrike,
        });
      }

      // Sort by strike price ascending
      strikes.sort((a, b) => a.strikePrice - b.strikePrice);

      // If no strike was tagged as ATM (rounding edge case), mark the closest one
      if (!strikes.some((s) => s.isATM) && strikes.length > 0) {
        let closest = strikes[0];
        let minDist = Math.abs(closest.strikePrice - underlyingLtp);
        for (const s of strikes) {
          const dist = Math.abs(s.strikePrice - underlyingLtp);
          if (dist < minDist) {
            closest = s;
            minDist = dist;
          }
        }
        closest.isATM = true;
      }

      // Window ±12 strikes around ATM so the UI opens centered, not at deep ITM
      const ATM_WINDOW = 12;
      const atmIndex = strikes.findIndex((s) => s.isATM);
      if (atmIndex >= 0 && strikes.length > ATM_WINDOW * 2 + 1) {
        const start = Math.max(0, Math.min(atmIndex - ATM_WINDOW, strikes.length - (ATM_WINDOW * 2 + 1)));
        const end = Math.min(strikes.length, start + ATM_WINDOW * 2 + 1);
        strikes.splice(end);
        strikes.splice(0, start);
      }

      return {
        underlying: indexKey,
        underlyingLtp,
        expiryDates: expiryDates.length > 0 ? expiryDates : (targetExpiry ? [targetExpiry] : []),
        selectedExpiry: targetExpiry || '',
        strikes,
      };
    } catch {
      // Graceful fallback to mock feed if offline, after hours, or Data API inactive
      return generateMockOptionChain(indexKey);
    }
  }

  // 4. Intraday / Historical Candlestick Chart Data
  static async getChartCandles(
    securityId: string,
    exchangeSegment: string,
    instrument: string = 'OPTIDX'
  ): Promise<CandleData[]> {
    const isDemo = await this.isDemoMode();
    if (isDemo || securityId.startsWith('MOCK_')) {
      // Estimate baseline price from securityId or default
      const basePrice = securityId.includes('CE') ? 145 : 120;
      return generateMockCandles(basePrice, 100);
    }

    try {
      const client = await this.getClient();
      const res = await client.post('/charts/intraday', {
        securityId,
        exchangeSegment,
        instrument,
        interval: '5', // 5-minute candles
      });

      if (res.data && Array.isArray(res.data.open)) {
        const opens = res.data.open;
        const highs = res.data.high;
        const lows = res.data.low;
        const closes = res.data.close;
        const timestamps = res.data.timestamp;
        const volumes = res.data.volume || [];

        const candles: CandleData[] = [];
        for (let i = 0; i < opens.length; i++) {
          candles.push({
            time: timestamps[i],
            open: opens[i],
            high: highs[i],
            low: lows[i],
            close: closes[i],
            volume: volumes[i],
          });
        }
        return candles;
      }
      return generateMockCandles(150, 100);
    } catch {
      return generateMockCandles(150, 100);
    }
  }

  // 5. Order Placement (with Bracket/SL-Trigger support)
  static async placeOrder(
    orderReq: DhanOrderRequest,
    tradingSymbol?: string
  ): Promise<DhanOrderResponse> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      const orderId = `SIM_${Date.now().toString().slice(-6)}`;
      const fillPrice = orderReq.price || 140;
      const signedQty =
        orderReq.transactionType === 'BUY' ? orderReq.quantity : -orderReq.quantity;

      const existing = demoPositionsStore.find(
        (p) => p.securityId === orderReq.securityId
      );
      if (existing) {
        existing.netQty += signedQty;
        if (orderReq.transactionType === 'BUY') {
          existing.buyQty += orderReq.quantity;
          existing.buyAvg = fillPrice;
        } else {
          existing.sellQty += orderReq.quantity;
          existing.sellAvg = fillPrice;
        }
        existing.ltp = fillPrice;
      } else {
        demoPositionsStore.unshift({
          securityId: orderReq.securityId,
          tradingSymbol: tradingSymbol || orderReq.securityId,
          exchangeSegment: orderReq.exchangeSegment,
          productType: orderReq.productType,
          buyQty: orderReq.transactionType === 'BUY' ? orderReq.quantity : 0,
          buyAvg: orderReq.transactionType === 'BUY' ? fillPrice : 0,
          sellQty: orderReq.transactionType === 'SELL' ? orderReq.quantity : 0,
          sellAvg: orderReq.transactionType === 'SELL' ? fillPrice : 0,
          netQty: signedQty,
          realizedProfit: 0,
          unrealizedProfit: 0,
          costPrice: fillPrice,
          ltp: fillPrice,
          dayPnl: 0,
        });
      }

      return {
        orderId,
        orderStatus: 'TRADED',
      };
    }

    try {
      const client = await this.getClient();
      const creds = await StorageService.getCredentials();
      const payload = {
        ...orderReq,
        dhanClientId: orderReq.dhanClientId || creds?.clientId,
      };
      const res = await client.post('/orders', payload);
      return res.data;
    } catch (err: any) {
      const message =
        err.response?.data?.internalErrorMessage ||
        err.response?.data?.message ||
        err.message ||
        'Order failed at broker.';
      throw new Error(message);
    }
  }

  // 5b. Modify Open Order (used when dragging live order / SL / TP line on chart)
  static async modifyOrder(
    orderId: string,
    params: {
      orderType: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LOSS_MARKET';
      quantity: number;
      price?: number;
      triggerPrice?: number;
      validity?: 'DAY' | 'IOC';
    }
  ): Promise<DhanOrderResponse> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return {
        orderId,
        orderStatus: 'PENDING',
      };
    }

    try {
      const client = await this.getClient();
      const creds = await StorageService.getCredentials();
      const res = await client.put(`/orders/${orderId}`, {
        dhanClientId: creds?.clientId,
        orderId,
        orderType: params.orderType,
        legName: 'ENTRY_LEG',
        quantity: params.quantity,
        price: params.price ?? 0,
        triggerPrice: params.triggerPrice ?? 0,
        validity: params.validity || 'DAY',
      });
      return res.data;
    } catch (err: any) {
      throw new Error(
        err.response?.data?.message || err.message || 'Failed to modify order.'
      );
    }
  }

  // 6. Positions & Open Orders
  // DhanHQ v2 /positions may omit `ltp` and `dayPnl`; safely derive them.
  static async getPositions(): Promise<DhanPosition[]> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return demoPositionsStore.map((p) => ({ ...p }));
    }

    try {
      const client = await this.getClient();
      const res = await client.get('/positions');
      const rawPositions: any[] = Array.isArray(res.data) ? res.data : [];

      return rawPositions.map((p) => {
        const buyAvg: number = p.buyAvg ?? 0;
        const buyQty: number = p.buyQty ?? 0;
        const sellAvg: number = p.sellAvg ?? 0;
        const sellQty: number = p.sellQty ?? 0;
        const netQty: number = p.netQty ?? 0;
        const realizedProfit: number = p.realizedProfit ?? 0;
        const unrealizedProfit: number = p.unrealizedProfit ?? 0;
        const costPrice: number = p.costPrice ?? (netQty > 0 ? buyAvg : sellAvg);

        // Safely compute ltp: use raw ltp if present, else derive from costPrice + unrealizedProfit
        // For both long and short: unrealizedProfit = (ltp - costPrice) * netQty
        // So: ltp = costPrice + unrealizedProfit / netQty (signed, not abs)
        let ltp: number = p.ltp ?? 0;
        if (!ltp && costPrice && netQty !== 0) {
          ltp = Math.max(0, Number((costPrice + unrealizedProfit / netQty).toFixed(2)));
        }

        // Safely compute dayPnl: use raw dayPnl if present, else sum realized + unrealized
        const dayPnl: number = p.dayPnl ?? (realizedProfit + unrealizedProfit);

        return {
          securityId: String(p.securityId ?? ''),
          tradingSymbol: p.tradingSymbol ?? '',
          exchangeSegment: p.exchangeSegment ?? '',
          productType: p.productType ?? '',
          buyQty,
          buyAvg,
          sellQty,
          sellAvg,
          netQty,
          realizedProfit,
          unrealizedProfit,
          costPrice,
          ltp,
          dayPnl,
        };
      });
    } catch {
      return demoPositionsStore.map((p) => ({ ...p }));
    }
  }

  static async getOrders(): Promise<DhanOrder[]> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return [];
    }

    try {
      const client = await this.getClient();
      const res = await client.get('/orders');
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  static async cancelOrder(orderId: string): Promise<boolean> {
    const isDemo = await this.isDemoMode();
    if (isDemo) return true;

    try {
      const client = await this.getClient();
      await client.delete(`/orders/${orderId}`);
      return true;
    } catch {
      return false;
    }
  }

  // 7. Exit a single open position at MARKET via DhanHQ API
  static async exitPosition(pos: DhanPosition): Promise<DhanOrderResponse | null> {
    if (pos.netQty === 0) return null;

    const isDemo = await this.isDemoMode();
    const exitType: 'BUY' | 'SELL' = pos.netQty > 0 ? 'SELL' : 'BUY';
    const exitQty = Math.abs(pos.netQty);

    if (isDemo) {
      const target = demoPositionsStore.find(
        (p) => p.securityId === pos.securityId
      );
      if (target) {
        target.realizedProfit += target.unrealizedProfit;
        target.unrealizedProfit = 0;
        target.netQty = 0;
      }
      return {
        orderId: `EXIT_${Date.now().toString().slice(-6)}`,
        orderStatus: 'TRADED',
      };
    }

    return this.placeOrder({
      transactionType: exitType,
      exchangeSegment:
        pos.exchangeSegment === 'BSE_FNO' ? 'BSE_FNO' : 'NSE_FNO',
      productType: (pos.productType as any) || 'INTRADAY',
      orderType: 'MARKET',
      validity: 'DAY',
      securityId: pos.securityId,
      quantity: exitQty,
      price: 0,
    });
  }

  // 8. Auto-Exit / Kill-Switch: Cancel all pending orders & square off ALL open positions via Dhan API
  static async squareOffAllPositions(): Promise<SquareOffSummary> {
    const positions = await this.getPositions();
    const orders = await this.getOrders();

    let cancelledOrdersCount = 0;
    const orderIds: string[] = [];
    const exitedSymbols: string[] = [];
    let totalPnlAtExit = 0;

    // Step 1: Cancel all PENDING/TRANSIT orders so nothing re-triggers
    for (const ord of orders) {
      if (ord.orderStatus === 'PENDING' || ord.orderStatus === 'TRANSIT') {
        const ok = await this.cancelOrder(ord.orderId);
        if (ok) cancelledOrdersCount += 1;
      }
    }

    // Step 2: Square off every open position at MARKET
    for (const pos of positions) {
      totalPnlAtExit += (pos.realizedProfit || 0) + (pos.unrealizedProfit || 0);
      if (pos.netQty !== 0) {
        try {
          const res = await this.exitPosition(pos);
          if (res) {
            orderIds.push(res.orderId);
            exitedSymbols.push(`${pos.tradingSymbol} (${pos.netQty > 0 ? 'SELL' : 'BUY'} ${Math.abs(pos.netQty)})`);
          }
        } catch (err) {
          console.error(`Failed to auto-exit ${pos.tradingSymbol}:`, err);
        }
      }
    }

    return {
      exitedCount: exitedSymbols.length,
      cancelledOrdersCount,
      orderIds,
      exitedSymbols,
      totalPnlAtExit,
    };
  }

  // Helper to simulate a Max Daily Loss breach in Demo Mode so user can test the Auto-Exit Kill Switch safely
  static simulateDemoLossBreach(lossAmount: number): void {
    const openPos = demoPositionsStore.find((p) => p.netQty !== 0);
    if (openPos) {
      openPos.unrealizedProfit = -Math.abs(lossAmount);
      openPos.dayPnl = -Math.abs(lossAmount);
    } else {
      demoPositionsStore.unshift({
        securityId: 'MOCK_NIFTY_24200_CE',
        tradingSymbol: 'NIFTY 24200 CE',
        exchangeSegment: 'NSE_FNO',
        productType: 'INTRADAY',
        buyQty: 50,
        buyAvg: 150,
        sellQty: 0,
        sellAvg: 0,
        netQty: 50,
        realizedProfit: 0,
        unrealizedProfit: -Math.abs(lossAmount),
        costPrice: 150,
        ltp: Math.max(5, 150 - Math.abs(lossAmount) / 50),
        dayPnl: -Math.abs(lossAmount),
      });
    }
  }
}
