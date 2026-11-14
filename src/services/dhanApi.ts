import axios, { AxiosInstance } from 'axios';
import {
  DhanCredentials,
  DhanProfile,
  DhanFundLimit,
  OptionChainData,
  CandleData,
  DhanOrderRequest,
  DhanOrderResponse,
  DhanPosition,
  DhanOrder,
} from '../types/dhan';
import { StorageService } from './storage';
import {
  generateMockOptionChain,
  generateMockCandles,
  MOCK_FUND_LIMIT,
  MOCK_POSITIONS,
} from './mockData';

const DHAN_BASE_URL = 'https://api.dhan.co/v2';

export class DhanApiService {
  private static client: AxiosInstance | null = null;
  private static cachedCreds: DhanCredentials | null = null;

  static async getClient(): Promise<AxiosInstance> {
    const creds = await StorageService.getCredentials();
    this.cachedCreds = creds;

    return axios.create({
      baseURL: DHAN_BASE_URL,
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
      const res = await client.get('/profile');
      return res.data;
    } catch (err: any) {
      console.warn('Dhan profile fetch failed, using fallback:', err.message);
      throw new Error(err.response?.data?.message || 'Invalid Dhan Client ID or Access Token.');
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
        availMargin: res.data.availMargin || 0,
        utilizedMargin: res.data.utilizedMargin || 0,
        collateralMargin: res.data.collateralMargin || 0,
        cashBalance: res.data.cashBalance || 0,
      };
    } catch {
      return MOCK_FUND_LIMIT;
    }
  }

  // 3. Option Chain (NIFTY, BANKNIFTY, SENSEX)
  static async getOptionChain(indexKey: string, expiry?: string): Promise<OptionChainData> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      const mockChain = generateMockOptionChain(indexKey);
      if (expiry) mockChain.selectedExpiry = expiry;
      return mockChain;
    }

    try {
      const client = await this.getClient();
      const res = await client.post('/optionchain', {
        Underlying: indexKey,
        Expiry: expiry,
      });

      if (res.data && res.data.data) {
        return res.data.data;
      }
      return generateMockOptionChain(indexKey);
    } catch {
      // Graceful fallback to mock feed if offline or after hours
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
  static async placeOrder(orderReq: DhanOrderRequest): Promise<DhanOrderResponse> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      // Realistic simulation
      return {
        orderId: `SIM_${Date.now().toString().slice(-6)}`,
        orderStatus: 'TRADED',
      };
    }

    try {
      const client = await this.getClient();
      const res = await client.post('/orders', orderReq);
      return res.data;
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Order failed at broker.';
      throw new Error(message);
    }
  }

  // 6. Positions & Open Orders
  static async getPositions(): Promise<DhanPosition[]> {
    const isDemo = await this.isDemoMode();
    if (isDemo) {
      return MOCK_POSITIONS;
    }

    try {
      const client = await this.getClient();
      const res = await client.get('/positions');
      return res.data || [];
    } catch {
      return MOCK_POSITIONS;
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
      return res.data || [];
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
}
