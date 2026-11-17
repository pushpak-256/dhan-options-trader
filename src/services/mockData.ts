import { OptionChainData, OptionStrikeRow, CandleData, DhanPosition, DhanFundLimit } from '../types/dhan';
import { SUPPORTED_INDICES } from '../constants/indices';

export const MOCK_UNDERLYING_PRICES: Record<string, number> = {
  NIFTY: 24200.5,
  BANKNIFTY: 51850.25,
  SENSEX: 79620.0,
  FINNIFTY: 22450.1,
};

export function generateMockOptionChain(indexKey: string): OptionChainData {
  const index = SUPPORTED_INDICES[indexKey] || SUPPORTED_INDICES.NIFTY;
  const spot = MOCK_UNDERLYING_PRICES[indexKey] || 24000;
  const step = index.strikeStep;
  const atmStrike = Math.round(spot / step) * step;

  // Generate 7 strikes above and below ATM (15 total)
  const strikes: OptionStrikeRow[] = [];
  const expiry = getUpcomingExpiry(indexKey);

  for (let i = -7; i <= 7; i++) {
    const strike = atmStrike + i * step;
    const isATM = strike === atmStrike;
    const dist = (strike - spot) / spot;

    // Call pricing
    const callIntrinsic = Math.max(0, spot - strike);
    const callTimeVal = Math.max(12, 180 * Math.exp(-Math.abs(dist) * 12));
    const callLtp = Number((callIntrinsic + callTimeVal).toFixed(2));

    // Put pricing
    const putIntrinsic = Math.max(0, strike - spot);
    const putTimeVal = Math.max(12, 175 * Math.exp(-Math.abs(dist) * 12));
    const putLtp = Number((putIntrinsic + putTimeVal).toFixed(2));

    const callDelta = Number((0.5 - dist * 4).toFixed(2));
    const putDelta = Number((-0.5 - dist * 4).toFixed(2));

    strikes.push({
      strikePrice: strike,
      isATM,
      call: {
        securityId: `MOCK_${indexKey}_${strike}_CE`,
        tradingSymbol: `${indexKey} ${expiry.slice(0, 6).toUpperCase()} ${strike} CE`,
        symbol: indexKey,
        strikePrice: strike,
        optionType: 'CALL',
        expiryDate: expiry,
        exchangeSegment: index.exchangeSegment,
        lotSize: index.lotSize,
        ltp: callLtp,
        previousClose: Number((callLtp * 0.96).toFixed(2)),
        change: Number((callLtp * 0.04).toFixed(2)),
        changePercent: 4.17,
        oi: Math.round(1500000 + Math.random() * 800000),
        oiChange: Math.round(120000 - Math.random() * 240000),
        volume: Math.round(500000 + Math.random() * 1000000),
        iv: Number((13.5 + Math.random() * 2).toFixed(1)),
        delta: Math.max(0.01, Math.min(0.99, callDelta)),
        theta: -8.4,
        bidPrice: Number((callLtp - 0.2).toFixed(2)),
        askPrice: Number((callLtp + 0.2).toFixed(2)),
      },
      put: {
        securityId: `MOCK_${indexKey}_${strike}_PE`,
        tradingSymbol: `${indexKey} ${expiry.slice(0, 6).toUpperCase()} ${strike} PE`,
        symbol: indexKey,
        strikePrice: strike,
        optionType: 'PUT',
        expiryDate: expiry,
        exchangeSegment: index.exchangeSegment,
        lotSize: index.lotSize,
        ltp: putLtp,
        previousClose: Number((putLtp * 1.05).toFixed(2)),
        change: Number((-putLtp * 0.05).toFixed(2)),
        changePercent: -4.76,
        oi: Math.round(1800000 + Math.random() * 900000),
        oiChange: Math.round(250000 - Math.random() * 200000),
        volume: Math.round(600000 + Math.random() * 1200000),
        iv: Number((14.0 + Math.random() * 2.5).toFixed(1)),
        delta: Math.max(-0.99, Math.min(-0.01, putDelta)),
        theta: -8.2,
        bidPrice: Number((putLtp - 0.25).toFixed(2)),
        askPrice: Number((putLtp + 0.25).toFixed(2)),
      },
    });
  }

  return {
    underlying: indexKey,
    underlyingLtp: spot,
    expiryDates: [
      expiry,
      getNextWeekExpiry(indexKey),
      '2026-12-03',
      '2026-12-31',
    ],
    selectedExpiry: expiry,
    strikes,
  };
}

export const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
  '1W': 604800,
};

const TIMEFRAME_VOLATILITY: Record<string, number> = {
  '1m': 0.011,
  '3m': 0.019,
  '5m': 0.025,
  '15m': 0.038,
  '30m': 0.05,
  '1H': 0.065,
  '4H': 0.09,
  '1D': 0.12,
  '1W': 0.18,
};

export function normalizeTimeframe(timeframe: string = '5m'): string {
  const trimmed = (timeframe || '5m').trim();
  const upper = trimmed.toUpperCase();
  if (upper === '1M') return '1m';
  if (upper === '3M') return '3m';
  if (upper === '5M') return '5m';
  if (upper === '15M') return '15m';
  if (upper === '30M') return '30m';
  if (upper === '1H') return '1H';
  if (upper === '4H') return '4H';
  if (upper === '1D') return '1D';
  if (upper === '1W') return '1W';
  return TIMEFRAME_SECONDS[trimmed] ? trimmed : '5m';
}

export function getTimeframeSeconds(timeframe: string = '5m'): number {
  const normalized = normalizeTimeframe(timeframe);
  return TIMEFRAME_SECONDS[normalized] ?? 300;
}

export function generateMockCandles(
  basePrice: number,
  count: number = 80,
  timeframe: string = '5m'
): CandleData[] {
  const candles: CandleData[] = [];
  const normalizedTf = normalizeTimeframe(timeframe);
  const intervalSeconds = TIMEFRAME_SECONDS[normalizedTf] ?? 300;
  const volFactor = TIMEFRAME_VOLATILITY[normalizedTf] ?? 0.025;
  const volumeScale = Math.max(0.25, Math.sqrt(intervalSeconds / 300));

  const nowAligned = Math.floor(Date.now() / 1000 / intervalSeconds) * intervalSeconds;
  let currentPrice = Math.max(15, basePrice * 0.85);

  for (let i = count; i >= 0; i--) {
    const time = nowAligned - i * intervalSeconds;
    const volatility = currentPrice * volFactor;
    const open = Number(currentPrice.toFixed(2));
    const change = (Math.random() - 0.48) * volatility;
    const close = Math.max(5, Number((open + change).toFixed(2)));
    const high = Number((Math.max(open, close) + Math.random() * (volatility * 0.6)).toFixed(2));
    const low = Math.max(
      0.05,
      Number((Math.min(open, close) - Math.random() * (volatility * 0.6)).toFixed(2))
    );
    const volume = Math.floor((5000 + Math.random() * 45000) * volumeScale);

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

export const MOCK_POSITIONS: DhanPosition[] = [
  {
    securityId: 'MOCK_NIFTY_24200_CE',
    tradingSymbol: 'NIFTY 24200 CE',
    exchangeSegment: 'NSE_FNO',
    productType: 'INTRADAY',
    buyQty: 50,
    buyAvg: 142.5,
    sellQty: 0,
    sellAvg: 0,
    netQty: 50,
    realizedProfit: 0,
    unrealizedProfit: 1250,
    costPrice: 142.5,
    ltp: 167.5,
    dayPnl: 1250,
  },
  {
    securityId: 'MOCK_BANKNIFTY_51800_PE',
    tradingSymbol: 'BANKNIFTY 51800 PE',
    exchangeSegment: 'NSE_FNO',
    productType: 'INTRADAY',
    buyQty: 30,
    buyAvg: 280.0,
    sellQty: 30,
    sellAvg: 315.0,
    netQty: 0,
    realizedProfit: 1050,
    unrealizedProfit: 0,
    costPrice: 280.0,
    ltp: 305.0,
    dayPnl: 1050,
  },
];

export const MOCK_FUND_LIMIT: DhanFundLimit = {
  availMargin: 128500.5,
  utilizedMargin: 21500.0,
  collateralMargin: 50000.0,
  cashBalance: 100000.5,
};

function getUpcomingExpiry(indexKey: string): string {
  // SENSEX expires on Fridays, NIFTY/BANKNIFTY on Thursdays/Wednesdays
  return '2026-11-19';
}

function getNextWeekExpiry(indexKey: string): string {
  return '2026-11-26';
}
