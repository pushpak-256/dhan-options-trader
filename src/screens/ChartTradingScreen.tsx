import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Alert, Text, TouchableOpacity } from 'react-native';
import { InteractiveChart } from '../components/InteractiveChart';
import { ChartOrderPanel } from '../components/ChartOrderPanel';
import { DhanApiService } from '../services/dhanApi';
import { DhanWebSocketService } from '../services/dhanWebSocket';
import { ComplianceEngine } from '../services/complianceEngine';
import {
  CandleData,
  OptionContract,
  TransactionType,
  OrderType,
  DhanOrderRequest,
} from '../types/dhan';
import { OrderPreFlightValidation } from '../types/compliance';
import { SUPPORTED_INDICES } from '../constants/indices';

interface ChartTradingScreenProps {
  selectedContract: OptionContract;
  onOpenChain: () => void;
  onTradeExecuted?: () => void;
}

export const ChartTradingScreen: React.FC<ChartTradingScreenProps> = ({
  selectedContract,
  onOpenChain,
  onTradeExecuted,
}) => {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [timeframe, setTimeframe] = useState('5m');
  const [showVWAP, setShowVWAP] = useState(true);
  const [showEMA9, setShowEMA9] = useState(true);

  const [transactionType, setTransactionType] = useState<TransactionType>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [lots, setLots] = useState(1);
  const [entryPrice, setEntryPrice] = useState(selectedContract.ltp || 150);
  const [stopLossPrice, setStopLossPrice] = useState<number | undefined>(
    Number((selectedContract.ltp * 0.85).toFixed(1))
  );
  const [targetPrice, setTargetPrice] = useState<number | undefined>(
    Number((selectedContract.ltp * 1.3).toFixed(1))
  );
  const [activeLineType, setActiveLineType] = useState<'ENTRY' | 'SL' | 'TP'>('SL');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validation, setValidation] = useState<OrderPreFlightValidation>({
    allowed: true,
    reasons: [],
    warnings: [],
    checks: [],
  });

  const indexConfig =
    SUPPORTED_INDICES[selectedContract.symbol] || SUPPORTED_INDICES.NIFTY;
  const lotSize = selectedContract.lotSize || indexConfig.lotSize;

  // Load candles
  const loadCandles = useCallback(async () => {
    const data = await DhanApiService.getChartCandles(
      selectedContract.securityId,
      selectedContract.exchangeSegment
    );
    if (data.length > 0) {
      setCandles(data);
      const lastCandle = data[data.length - 1];
      setEntryPrice(lastCandle.close);
      setStopLossPrice(Number((lastCandle.close * 0.85).toFixed(1)));
      setTargetPrice(Number((lastCandle.close * 1.3).toFixed(1)));
    }
  }, [selectedContract]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles, timeframe]);

  // Connect WebSocket for live ticks
  useEffect(() => {
    DhanWebSocketService.connect();

    const unsubscribe = DhanWebSocketService.subscribe(
      selectedContract.securityId,
      (tick) => {
        if (tick && tick.ltp) {
          // If in MARKET order type, sync entry with live tick
          if (orderType === 'MARKET') {
            setEntryPrice(tick.ltp);
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [selectedContract.securityId, orderType]);

  // Run compliance validation whenever trade parameters change
  const runValidation = useCallback(async () => {
    const orderReq: DhanOrderRequest = {
      transactionType,
      exchangeSegment: selectedContract.exchangeSegment,
      productType: 'INTRADAY',
      orderType,
      validity: 'DAY',
      securityId: selectedContract.securityId,
      quantity: lots * lotSize,
      price: entryPrice,
      triggerPrice: stopLossPrice,
    };

    const result = await ComplianceEngine.validateOrder({
      order: orderReq,
      lotSize,
      entryPrice,
      stopLossPrice,
      targetPrice,
    });
    setValidation(result);
  }, [
    transactionType,
    orderType,
    lots,
    lotSize,
    entryPrice,
    stopLossPrice,
    targetPrice,
    selectedContract,
  ]);

  useEffect(() => {
    runValidation();
  }, [runValidation]);

  // Handle tap on chart
  const handlePriceSelected = (price: number) => {
    if (activeLineType === 'ENTRY') {
      setEntryPrice(price);
    } else if (activeLineType === 'SL') {
      setStopLossPrice(price);
    } else if (activeLineType === 'TP') {
      setTargetPrice(price);
    }
  };

  // Place order
  const handlePlaceOrder = async () => {
    if (!validation.allowed) {
      Alert.alert('Order Blocked by Compliance', validation.reasons.join('\n'));
      return;
    }

    try {
      setIsSubmitting(true);
      const totalQty = lots * lotSize;

      const orderReq: DhanOrderRequest = {
        transactionType,
        exchangeSegment: selectedContract.exchangeSegment,
        productType: 'INTRADAY',
        orderType,
        validity: 'DAY',
        securityId: selectedContract.securityId,
        quantity: totalQty,
        price: orderType === 'LIMIT' ? entryPrice : undefined,
        triggerPrice: stopLossPrice,
      };

      const res = await DhanApiService.placeOrder(orderReq);

      Alert.alert(
        'Order Executed!',
        `Order ID: ${res.orderId}\nStatus: ${res.orderStatus}\n${transactionType} ${lots} lot (${totalQty} qty) of ${selectedContract.tradingSymbol} @ ₹${entryPrice.toFixed(1)}\nSL: ₹${stopLossPrice?.toFixed(1) || 'None'}\nTarget: ₹${targetPrice?.toFixed(1) || 'None'}`
      );

      if (onTradeExecuted) onTradeExecuted();
    } catch (err: any) {
      Alert.alert('Execution Failed', err.message || 'Could not place order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Strike Quick Selector Header */}
      <View style={styles.topSelectorBar}>
        <View>
          <Text style={styles.symbolTitle}>{selectedContract.tradingSymbol}</Text>
          <Text style={styles.subTitle}>
            LTP: ₹{selectedContract.ltp.toFixed(2)} ({selectedContract.changePercent >= 0 ? '+' : ''}
            {selectedContract.changePercent}%) • Lot: {lotSize}
          </Text>
        </View>

        <TouchableOpacity style={styles.chainBtn} onPress={onOpenChain}>
          <Text style={styles.chainBtnText}>Option Chain ➔</Text>
        </TouchableOpacity>
      </View>

      {/* Interactive TradingView Chart with VWAP & EMA Indicators */}
      <View style={styles.chartWrapper}>
        <InteractiveChart
          candles={candles}
          symbol={selectedContract.tradingSymbol}
          entryPrice={entryPrice}
          stopLossPrice={stopLossPrice}
          targetPrice={targetPrice}
          lotSize={lotSize}
          lots={lots}
          onPriceSelected={handlePriceSelected}
          activeLineType={activeLineType}
          showVWAP={showVWAP}
          showEMA9={showEMA9}
          timeframe={timeframe}
          onSelectTimeframe={(tf) => setTimeframe(tf)}
          onToggleVWAP={() => setShowVWAP(!showVWAP)}
          onToggleEMA9={() => setShowEMA9(!showEMA9)}
        />
      </View>

      {/* Bottom Order Panel */}
      <ChartOrderPanel
        transactionType={transactionType}
        setTransactionType={setTransactionType}
        orderType={orderType}
        setOrderType={setOrderType}
        lots={lots}
        setLots={setLots}
        lotSize={lotSize}
        entryPrice={entryPrice}
        setEntryPrice={setEntryPrice}
        stopLossPrice={stopLossPrice}
        setStopLossPrice={setStopLossPrice}
        targetPrice={targetPrice}
        setTargetPrice={setTargetPrice}
        activeLineType={activeLineType}
        setActiveLineType={setActiveLineType}
        validation={validation}
        onPlaceOrder={handlePlaceOrder}
        isSubmitting={isSubmitting}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  topSelectorBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  symbolTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 14,
  },
  subTitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  chainBtn: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chainBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 11,
  },
  chartWrapper: {
    flex: 1,
  },
});
