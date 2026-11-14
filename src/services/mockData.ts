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
      '2026-11-26',
      '2026-12-31',
    ],
    selectedExpiry: expiry,
    strikes,
  };
}

export function generateMockCandles(basePrice: number, count: number = 80): CandleData[] {
  const candles: CandleData[] = [];
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds = 300; // 5 minute candles

  let currentPrice = Math.max(15, basePrice * 0.85);

  for (let i = count; i >= 0; i--) {
    const time = now - i * intervalSeconds;
    const volatility = currentPrice * 0.025;
    const open = currentPrice;
    const change = (Math.random() - 0.48) * volatility;
    const close = Math.max(5, Number((open + change).toFixed(2)));
    const high = Number((Math.max(open, close) + Math.random() * (volatility * 0.6)).toFixed(2));
    const low = Number((Math.min(open, close) - Math.random() * (volatility * 0.6)).toFixed(2));
    const volume = Math.floor(5000 + Math.random() * 45000);

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
