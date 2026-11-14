import { CandleData } from '../types/dhan';

export interface LinePoint {
  time: number;
  value: number;
}

export function calculateVWAP(candles: CandleData[]): LinePoint[] {
  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;
  const result: LinePoint[] = [];

  for (const c of candles) {
    const vol = c.volume || 1000;
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTypicalVolume += typicalPrice * vol;
    cumulativeVolume += vol;

    const vwap = cumulativeVolume > 0 ? cumulativeTypicalVolume / cumulativeVolume : typicalPrice;
    result.push({
      time: c.time,
      value: Number(vwap.toFixed(2)),
    });
  }

  return result;
}

export function calculateEMA(candles: CandleData[], period: number): LinePoint[] {
  if (candles.length === 0) return [];
  const result: LinePoint[] = [];
  const k = 2 / (period + 1);

  // Initialize with SMA
  let sum = 0;
  const initPeriod = Math.min(period, candles.length);
  for (let i = 0; i < initPeriod; i++) {
    sum += candles[i].close;
  }
  let prevEma = sum / initPeriod;

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      prevEma = (candles[i].close - prevEma) * (2 / (i + 2)) + prevEma;
    } else {
      prevEma = (candles[i].close - prevEma) * k + prevEma;
    }
    result.push({
      time: candles[i].time,
      value: Number(prevEma.toFixed(2)),
    });
  }

  return result;
}
