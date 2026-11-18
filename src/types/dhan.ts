export interface DhanAppConfig {
  clientId: string;
  appId: string;
  appSecret: string;
}

export interface DhanCredentials {
  clientId: string;
  accessToken: string;
  isDemoMode?: boolean;
  expiryTime?: string;
  clientName?: string;
}

export interface DhanProfile {
  dhanClientId: string;
  clientName: string;
  email: string;
  mobile: string;
  status: string;
}

export interface DhanFundLimit {
  availMargin: number;
  utilizedMargin: number;
  collateralMargin: number;
  cashBalance: number;
}

export interface OptionContract {
  securityId: string;
  tradingSymbol: string;
  symbol: string;
  strikePrice: number;
  optionType: 'CALL' | 'PUT';
  expiryDate: string;
  exchangeSegment: 'NSE_FNO' | 'BSE_FNO';
  lotSize: number;
  ltp: number;
  previousClose: number;
  change: number;
  changePercent: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv?: number;
  delta?: number;
  theta?: number;
  bidPrice?: number;
  askPrice?: number;
}

export interface OptionStrikeRow {
  strikePrice: number;
  call: OptionContract;
  put: OptionContract;
  isATM?: boolean;
}

export interface OptionChainData {
  underlying: string;
  underlyingLtp: number;
  expiryDates: string[];
  selectedExpiry: string;
  strikes: OptionStrikeRow[];
}

export interface CandleData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type TransactionType = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LOSS_MARKET';
export type ProductType = 'INTRADAY' | 'CNC' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
export type OrderStatus = 'TRANSIT' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'TRADED' | 'EXPIRED';

export interface DhanOrderRequest {
  dhanClientId?: string;
  correlationId?: string;
  transactionType: TransactionType;
  exchangeSegment: 'NSE_FNO' | 'BSE_FNO';
  productType: ProductType;
  orderType: OrderType;
  validity: 'DAY' | 'IOC';
  securityId: string;
  quantity: number;
  price?: number;
  triggerPrice?: number;
  disclosedQuantity?: number;
  afterMarketOrder?: boolean;
}

export interface DhanOrderResponse {
  orderId: string;
  orderStatus: OrderStatus;
  rejectionReason?: string;
}

export interface DhanOrder {
  orderId: string;
  correlationId?: string;
  orderStatus: OrderStatus;
  transactionType: TransactionType;
  exchangeSegment: string;
  productType: string;
  orderType: string;
  tradingSymbol: string;
  securityId: string;
  quantity: number;
  price: number;
  triggerPrice?: number;
  tradedQuantity: number;
  createTime: string;
  updateTime: string;
}

export interface DhanPosition {
  securityId: string;
  tradingSymbol: string;
  exchangeSegment: string;
  productType: string;
  buyQty: number;
  buyAvg: number;
  sellQty: number;
  sellAvg: number;
  netQty: number;
  realizedProfit: number;
  unrealizedProfit: number;
  costPrice: number;
  ltp: number;
  dayPnl: number;
}
