import { Platform } from 'react-native';
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

      let targetExpiry = expiry;
      if (!targetExpiry) {
        const expRes = await client.post('/optionchain/expirylist', {
          UnderlyingScrip: underlyingScrip,
          UnderlyingSeg: 'IDX_I',
        });
        if (expRes.data?.data?.length > 0) {
          targetExpiry = expRes.data.data[0];
        }
      }

      const res = await client.post('/optionchain', {
        UnderlyingScrip: underlyingScrip,
        UnderlyingSeg: 'IDX_I',
        Expiry: targetExpiry,
      });

      if (res.data && res.data.data && Array.isArray(res.data.data.strikes)) {
        return res.data.data;
      }
      return generateMockOptionChain(indexKey);
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
