import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Alert, Text, TouchableOpacity } from 'react-native';
import { InteractiveChart } from '../components/InteractiveChart';
import { ChartOrderPanel } from '../components/ChartOrderPanel';
import { DhanApiService } from '../services/dhanApi';
import { DhanWebSocketService } from '../services/dhanWebSocket';
import { ComplianceEngine } from '../services/complianceEngine';
import { AutoSquareOffEngine } from '../services/autoSquareOffEngine';
import {
  CandleData,
  OptionContract,
  TransactionType,
  OrderType,
  DhanOrderRequest,
  DhanPosition,
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
    Number((selectedContract.ltp * 0.93).toFixed(1))
  );
  const [targetPrice, setTargetPrice] = useState<number | undefined>(
    Number((selectedContract.ltp * 1.12).toFixed(1))
  );
  const [activeLineType, setActiveLineType] = useState<'ENTRY' | 'SL' | 'TP'>('SL');
  const [activePosition, setActivePosition] = useState<DhanPosition | null>(null);
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

  // Smartly flip SL & TP when switching between BUY (Long) and SELL (Short)
  const handleSetTransactionType = (newSide: TransactionType) => {
    setTransactionType(newSide);
    if (newSide === 'BUY') {
      if (stopLossPrice && stopLossPrice >= entryPrice) {
        setStopLossPrice(Number((entryPrice * 0.88).toFixed(1)));
      }
      if (targetPrice && targetPrice <= entryPrice) {
        setTargetPrice(Number((entryPrice * 1.24).toFixed(1)));
      }
    } else {
      if (stopLossPrice && stopLossPrice <= entryPrice) {
        setStopLossPrice(Number((entryPrice * 1.12).toFixed(1)));
      }
      if (targetPrice && targetPrice >= entryPrice) {
        setTargetPrice(Number((entryPrice * 0.76).toFixed(1)));
      }
    }
  };

  const refreshActivePosition = useCallback(async () => {
    try {
      const positions = await DhanApiService.getPositions();
      const match = positions.find(
        (p) => p.securityId === selectedContract.securityId && p.netQty !== 0
      );
      setActivePosition(match || null);
    } catch {}
  }, [selectedContract.securityId]);

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
      if (transactionType === 'BUY') {
        setStopLossPrice(Number((lastCandle.close * 0.93).toFixed(1)));
        setTargetPrice(Number((lastCandle.close * 1.12).toFixed(1)));
      } else {
        setStopLossPrice(Number((lastCandle.close * 1.07).toFixed(1)));
        setTargetPrice(Number((lastCandle.close * 0.88).toFixed(1)));
      }
    }
    await refreshActivePosition();
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

  // Handle dragging ENTRY, SL, or TP directly on the chart
  const handleLevelChange = (line: 'ENTRY' | 'SL' | 'TP', price: number) => {
    if (line === 'ENTRY') {
      setEntryPrice(price);
      setActiveLineType('ENTRY');
    } else if (line === 'SL') {
      setStopLossPrice(price);
      setActiveLineType('SL');
    } else if (line === 'TP') {
      setTargetPrice(price);
      setActiveLineType('TP');
    }
  };

  // Execute order (used by both bottom CTA button and on-chart Quick BUY/SELL buttons)
  const executeOrder = async (overrideSide?: TransactionType, overridePrice?: number) => {
    const side = overrideSide || transactionType;
    const price = overridePrice ?? entryPrice;

    // Auto-adjust SL/TP if user clicked opposite Quick Order directly on chart
    let sl = stopLossPrice;
    let tp = targetPrice;
    if (overrideSide && overrideSide !== transactionType) {
      setTransactionType(overrideSide);
      if (overrideSide === 'BUY') {
        sl = Number((price * 0.88).toFixed(1));
        tp = Number((price * 1.24).toFixed(1));
      } else {
        sl = Number((price * 1.12).toFixed(1));
        tp = Number((price * 0.76).toFixed(1));
      }
      setStopLossPrice(sl);
      setTargetPrice(tp);
    }

    const totalQty = lots * lotSize;
    const orderReq: DhanOrderRequest = {
      transactionType: side,
      exchangeSegment: selectedContract.exchangeSegment,
      productType: 'INTRADAY',
      orderType,
      validity: 'DAY',
      securityId: selectedContract.securityId,
      quantity: totalQty,
      price: orderType === 'LIMIT' ? price : undefined,
      triggerPrice: sl,
    };

    const preFlight = await ComplianceEngine.validateOrder({
      order: orderReq,
      lotSize,
      entryPrice: price,
      stopLossPrice: sl,
      targetPrice: tp,
    });
    setValidation(preFlight);

    if (!preFlight.allowed) {
      Alert.alert('Order Blocked by Compliance', preFlight.reasons.join('\n'));
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await DhanApiService.placeOrder(orderReq, selectedContract.tradingSymbol);

      await refreshActivePosition();
      await AutoSquareOffEngine.checkAndEnforce();

      Alert.alert(
        'Order Executed!',
        `Order ID: ${res.orderId}\nStatus: ${res.orderStatus}\n${side} ${lots} lot (${totalQty} qty) of ${selectedContract.tradingSymbol} @ ₹${price.toFixed(1)}\nSL: ₹${sl?.toFixed(1) || 'None'}\nTarget: ₹${tp?.toFixed(1) || 'None'}`
      );

      if (onTradeExecuted) onTradeExecuted();
    } catch (err: any) {
      Alert.alert('Execution Failed', err.message || 'Could not place order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Exit Open Position directly from chart button
  const handleQuickExitPosition = async (pos: DhanPosition) => {
    try {
      const res = await DhanApiService.exitPosition(pos);
      await ComplianceEngine.recordTradeResult(pos.unrealizedProfit);
      await refreshActivePosition();
      await AutoSquareOffEngine.checkAndEnforce();
      Alert.alert(
        'Position Exited!',
        `Closed ${pos.tradingSymbol} via Dhan API (Order: ${res?.orderId || 'OK'})`
      );
      if (onTradeExecuted) onTradeExecuted();
    } catch (err: any) {
      Alert.alert('Exit Failed', err.message || 'Could not exit position.');
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
          <Text style={styles.breakevenText}>
            Breakeven Spot:{' '}
            <Text style={styles.breakevenVal}>
              ₹
              {selectedContract.optionType === 'CALL'
                ? (selectedContract.strikePrice + entryPrice).toFixed(1)
                : (selectedContract.strikePrice - entryPrice).toFixed(1)}
            </Text>
          </Text>
        </View>

        <TouchableOpacity style={styles.chainBtn} onPress={onOpenChain}>
          <Text style={styles.chainBtnText}>Option Chain ➔</Text>
        </TouchableOpacity>
      </View>

      {/* Interactive TradingView Chart with Drag Handles, TP/SL Box, Drawing Tools & On-Chart Orders */}
      <View style={styles.chartWrapper}>
        <InteractiveChart
          candles={candles}
          symbol={selectedContract.tradingSymbol}
          transactionType={transactionType}
          entryPrice={entryPrice}
          stopLossPrice={stopLossPrice}
          targetPrice={targetPrice}
          lotSize={lotSize}
          lots={lots}
          activePosition={activePosition}
          onLevelChange={handleLevelChange}
          onQuickOrder={(side, price) => executeOrder(side, price)}
          onQuickExitPosition={handleQuickExitPosition}
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
        setTransactionType={handleSetTransactionType}
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
        onPlaceOrder={() => executeOrder()}
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
  breakevenText: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  breakevenVal: {
    color: '#F59E0B',
    fontWeight: '700',
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
