export interface IndexConfig {
  id: string;
  name: string;
  symbol: string;
  exchange: 'NSE_FNO' | 'BSE_FNO';
  exchangeSegment: 'NSE_FNO' | 'BSE_FNO';
  underlyingExchangeSegment: 'NSE_EQ' | 'BSE_EQ';
  underlyingSecurityId: string;
  lotSize: number;
  strikeStep: number;
  tickSize: number;
  tradingHours: {
    open: string; // "09:15"
    close: string; // "15:30"
  };
  color: string;
}

export const SUPPORTED_INDICES: Record<string, IndexConfig> = {
  NIFTY: {
    id: 'NIFTY',
    name: 'NIFTY 50',
    symbol: 'NIFTY',
    exchange: 'NSE_FNO',
    exchangeSegment: 'NSE_FNO',
    underlyingExchangeSegment: 'NSE_EQ',
    underlyingSecurityId: '13',
    lotSize: 25,
    strikeStep: 50,
    tickSize: 0.05,
    tradingHours: { open: '09:15', close: '15:30' },
    color: '#3B82F6', // Blue
  },
  BANKNIFTY: {
    id: 'BANKNIFTY',
    name: 'BANK NIFTY',
    symbol: 'BANKNIFTY',
    exchange: 'NSE_FNO',
    exchangeSegment: 'NSE_FNO',
    underlyingExchangeSegment: 'NSE_EQ',
    underlyingSecurityId: '25',
    lotSize: 15,
    strikeStep: 100,
    tickSize: 0.05,
    tradingHours: { open: '09:15', close: '15:30' },
    color: '#8B5CF6', // Purple
  },
  SENSEX: {
    id: 'SENSEX',
    name: 'BSE SENSEX',
    symbol: 'SENSEX',
    exchange: 'BSE_FNO',
    exchangeSegment: 'BSE_FNO',
    underlyingExchangeSegment: 'BSE_EQ',
    underlyingSecurityId: '51',
    lotSize: 10,
    strikeStep: 100,
    tickSize: 0.05,
    tradingHours: { open: '09:15', close: '15:30' },
    color: '#EC4899', // Pink
  },
  FINNIFTY: {
    id: 'FINNIFTY',
    name: 'FIN NIFTY',
    symbol: 'FINNIFTY',
    exchange: 'NSE_FNO',
    exchangeSegment: 'NSE_FNO',
    underlyingExchangeSegment: 'NSE_EQ',
    underlyingSecurityId: '27',
    lotSize: 25,
    strikeStep: 50,
    tickSize: 0.05,
    tradingHours: { open: '09:15', close: '15:30' },
    color: '#10B981', // Emerald
  },
};
