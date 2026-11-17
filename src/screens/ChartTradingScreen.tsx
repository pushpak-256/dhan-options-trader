import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

const ONE_CLICK_MODE_STORAGE_KEY = 'trading_one_click_mode_v1';

export interface LiveTickPayload {
  price: number;
  volume?: number;
  timestamp: number;
}

type InteractiveChartWithTickProps = React.ComponentProps<typeof InteractiveChart> & {
  latestTick?: LiveTickPayload | null;
  orderType?: OrderType;
};

const InteractiveChartWithTick =
  InteractiveChart as React.ComponentType<InteractiveChartWithTickProps>;

type ChartOrderPanelWithModeProps = React.ComponentProps<typeof ChartOrderPanel> & {
  oneClickMode?: boolean;
  onToggleOneClickMode?: () => void;
};

const ChartOrderPanelWithMode =
  ChartOrderPanel as React.ComponentType<ChartOrderPanelWithModeProps>;

interface PendingLevelChange {
  line: 'ENTRY' | 'SL' | 'TP';
  previousPrice: number;
  newPrice: number;
}

interface PendingOrderConfirm {
  side: TransactionType;
  orderType: OrderType;
  price: number;
  sl?: number;
  tp?: number;
  lots: number;
  totalQty: number;
  maxRisk: number;
  maxReward: number;
  rrRatio: number;
  warnings: string[];
  orderReq: DhanOrderRequest;
}

interface ToastState {
  message: string;
  tone: 'success' | 'info' | 'warning' | 'error';
}

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
  const [liveLtp, setLiveLtp] = useState<number>(selectedContract.ltp || 150);
  const [latestTick, setLatestTick] = useState<LiveTickPayload | null>(null);
  const [tickDirection, setTickDirection] = useState<'up' | 'down' | 'flat'>('flat');
  const [stopLossPrice, setStopLossPrice] = useState<number | undefined>(
    Number((selectedContract.ltp * 0.93).toFixed(1))
  );
  const [targetPrice, setTargetPrice] = useState<number | undefined>(
    Number((selectedContract.ltp * 1.12).toFixed(1))
  );
  const [activeLineType, setActiveLineType] = useState<'ENTRY' | 'SL' | 'TP'>('SL');
  const [activePosition, setActivePosition] = useState<DhanPosition | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // One-Click vs Safe Confirm Mode (persisted in AsyncStorage, default false = safe Confirm mode)
  const [oneClickMode, setOneClickMode] = useState<boolean>(false);
  const [pendingLevelChange, setPendingLevelChange] = useState<PendingLevelChange | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrderConfirm | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [validation, setValidation] = useState<OrderPreFlightValidation>({
    allowed: true,
    reasons: [],
    warnings: [],
    checks: [],
  });

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const orderTypeRef = useRef<OrderType>(orderType);
  orderTypeRef.current = orderType;

  const liveLtpRef = useRef<number>(liveLtp);
  liveLtpRef.current = liveLtp;

  const entryPriceRef = useRef<number>(entryPrice);
  entryPriceRef.current = entryPrice;

  const stopLossRef = useRef<number | undefined>(stopLossPrice);
  stopLossRef.current = stopLossPrice;

  const targetRef = useRef<number | undefined>(targetPrice);
  targetRef.current = targetPrice;

  const indexConfig =
    SUPPORTED_INDICES[selectedContract.symbol] || SUPPORTED_INDICES.NIFTY;
  const lotSize = selectedContract.lotSize || indexConfig.lotSize;
  const totalQty = lots * lotSize;

  const showToast = useCallback(
    (message: string, tone: ToastState['tone'] = 'info', durationMs: number = 2200) => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      setToast({ message, tone });
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, durationMs);
    },
    []
  );

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Load persisted oneClickMode preference
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(ONE_CLICK_MODE_STORAGE_KEY)
      .then((val) => {
        if (mounted && val !== null) {
          setOneClickMode(val === 'true');
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggleOneClickMode = useCallback(() => {
    setOneClickMode((prev) => {
      const next = !prev;
      AsyncStorage.setItem(ONE_CLICK_MODE_STORAGE_KEY, next ? 'true' : 'false').catch(() => {});
      if (next) {
        setPendingLevelChange(null);
        setPendingOrder(null);
        showToast('⚡ 1-Click Mode ON — instant line & order actions', 'warning', 2000);
      } else {
        showToast('✓ Confirm Mode ON — prompts before executing', 'info', 2000);
      }
      return next;
    });
  }, [showToast]);

  // Smartly sync Entry price to live market price when switching to MARKET order mode
  const handleSetOrderType = useCallback(
    (nextOrderType: OrderType) => {
      setOrderType(nextOrderType);
      if (nextOrderType === 'MARKET') {
        const latestCandleClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
        const marketPrice =
          liveLtpRef.current > 0
            ? liveLtpRef.current
            : latestCandleClose > 0
            ? latestCandleClose
            : entryPriceRef.current;
        if (marketPrice > 0) {
          setEntryPrice(marketPrice);
        }
        setActiveLineType((prev) => (prev === 'ENTRY' ? 'SL' : prev));
        setPendingLevelChange((prev) => (prev?.line === 'ENTRY' ? null : prev));
      }
    },
    [candles]
  );

  // Smartly flip SL & TP when switching between BUY (Long) and SELL (Short)
  const handleSetTransactionType = (newSide: TransactionType) => {
    setTransactionType(newSide);
    setPendingLevelChange(null);
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

  // Reset live price & pending prompts when switching contracts
  useEffect(() => {
    const initialLtp = selectedContract.ltp || 150;
    setLiveLtp(initialLtp);
    setLatestTick(null);
    setTickDirection('flat');
    setPendingLevelChange(null);
    setPendingOrder(null);
  }, [selectedContract.securityId, selectedContract.ltp]);

  // Load candles for the selected contract & timeframe (1m..1W)
  const loadCandles = useCallback(async () => {
    const getCandlesWithTf = DhanApiService.getChartCandles.bind(DhanApiService) as (
      securityId: string,
      exchangeSegment: string,
      instrument?: string,
      tf?: string
    ) => Promise<CandleData[]>;

    const data = await getCandlesWithTf(
      selectedContract.securityId,
      selectedContract.exchangeSegment,
      'OPTIDX',
      timeframe
    );
    if (data.length > 0) {
      setCandles(data);
      const lastCandle = data[data.length - 1];
      setEntryPrice(lastCandle.close);
      setLiveLtp(lastCandle.close);
      DhanWebSocketService.updateSeedPrice(selectedContract.securityId, lastCandle.close);
      if (transactionType === 'BUY') {
        setStopLossPrice(Number((lastCandle.close * 0.93).toFixed(1)));
        setTargetPrice(Number((lastCandle.close * 1.12).toFixed(1)));
      } else {
        setStopLossPrice(Number((lastCandle.close * 1.07).toFixed(1)));
        setTargetPrice(Number((lastCandle.close * 0.88).toFixed(1)));
      }
    }
    await refreshActivePosition();
  }, [selectedContract, timeframe, refreshActivePosition]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Connect WebSocket for live ticks with true ExchangeSegment & seedPrice (0ms throttle)
  useEffect(() => {
    DhanWebSocketService.connect();

    const seedPrice = entryPriceRef.current || selectedContract.ltp || 150;
    const unsubscribe = DhanWebSocketService.subscribe(
      selectedContract.securityId,
      (tick) => {
        if (tick && Number.isFinite(tick.ltp) && tick.ltp > 0) {
          const prev = liveLtpRef.current;
          if (tick.ltp > prev) {
            setTickDirection('up');
          } else if (tick.ltp < prev) {
            setTickDirection('down');
          }

          setLiveLtp(tick.ltp);
          setLatestTick({
            price: tick.ltp,
            volume: tick.volume,
            timestamp: tick.timestamp || Date.now(),
          });

          if (orderTypeRef.current === 'MARKET') {
            setEntryPrice(tick.ltp);
          }
        }
      },
      {
        exchangeSegment: selectedContract.exchangeSegment,
        seedPrice,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [selectedContract.securityId, selectedContract.exchangeSegment]);

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

  // Sync linked open SL / TP broker order when an active position exists
  const syncLinkedOpenOrder = useCallback(
    async (line: 'ENTRY' | 'SL' | 'TP', price: number): Promise<boolean> => {
      if (!activePosition || line === 'ENTRY') return false;
      try {
        const openOrders = await DhanApiService.getOrders();
        const matchingOrder = openOrders.find((ord) => {
          const isOpen = ord.orderStatus === 'PENDING' || ord.orderStatus === 'TRANSIT';
          if (!isOpen || ord.securityId !== selectedContract.securityId) return false;
          if (line === 'SL') {
            return ord.orderType === 'STOP_LOSS' || ord.orderType === 'STOP_LOSS_MARKET';
          }
          return ord.orderType === 'LIMIT';
        });

        if (!matchingOrder) return false;

        const targetOrderType: OrderType =
          line === 'SL'
            ? matchingOrder.orderType === 'STOP_LOSS_MARKET'
              ? 'STOP_LOSS_MARKET'
              : 'STOP_LOSS'
            : 'LIMIT';

        await DhanApiService.modifyOrder(matchingOrder.orderId, {
          orderType: targetOrderType,
          quantity: matchingOrder.quantity || Math.abs(activePosition.netQty),
          price: targetOrderType === 'STOP_LOSS_MARKET' ? 0 : price,
          triggerPrice: line === 'SL' ? price : undefined,
          validity: 'DAY',
        });
        return true;
      } catch (err: any) {
        console.warn('Modify linked order skipped:', err?.message);
        return false;
      }
    },
    [activePosition, selectedContract.securityId]
  );

  // Helper to apply a line price to local state
  const applyLinePrice = useCallback((line: 'ENTRY' | 'SL' | 'TP', price: number) => {
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
  }, []);

  // Handle dragging ENTRY, SL, or TP directly on the chart
  const handleLevelChange = useCallback(
    (line: 'ENTRY' | 'SL' | 'TP', price: number) => {
      const prevPrice =
        line === 'ENTRY'
          ? entryPriceRef.current
          : line === 'SL'
          ? stopLossRef.current ?? entryPriceRef.current
          : targetRef.current ?? entryPriceRef.current;

      // Always update chart line smoothly for immediate visual feedback
      applyLinePrice(line, price);

      if (oneClickMode) {
        setPendingLevelChange(null);
        syncLinkedOpenOrder(line, price).then((modifiedBroker) => {
          showToast(
            modifiedBroker
              ? `⚡ ${line} order modified to ₹${price.toFixed(1)}`
              : `⚡ ${line} updated to ₹${price.toFixed(1)}`,
            'success',
            2000
          );
        });
      } else {
        // Preserve original anchor price if user re-drags the same line before confirming
        setPendingLevelChange((existing) => ({
          line,
          previousPrice: existing && existing.line === line ? existing.previousPrice : prevPrice,
          newPrice: price,
        }));
      }
    },
    [oneClickMode, applyLinePrice, syncLinkedOpenOrder, showToast]
  );

  const handleConfirmLevelChange = useCallback(async () => {
    if (!pendingLevelChange) return;
    const { line, newPrice } = pendingLevelChange;
    setPendingLevelChange(null);
    const modifiedBroker = await syncLinkedOpenOrder(line, newPrice);
    showToast(
      modifiedBroker
        ? `✓ ${line} order updated to ₹${newPrice.toFixed(1)}`
        : `✓ ${line} confirmed at ₹${newPrice.toFixed(1)}`,
      'success',
      2000
    );
  }, [pendingLevelChange, syncLinkedOpenOrder, showToast]);

  const handleRevertLevelChange = useCallback(() => {
    if (!pendingLevelChange) return;
    const { line, previousPrice } = pendingLevelChange;
    applyLinePrice(line, previousPrice);
    setPendingLevelChange(null);
    showToast(`↩ ${line} reverted to ₹${previousPrice.toFixed(1)}`, 'info', 1800);
  }, [pendingLevelChange, applyLinePrice, showToast]);

  // Actually submit a validated order to DhanApiService
  const commitOrder = useCallback(
    async (pending: PendingOrderConfirm) => {
      try {
        setIsSubmitting(true);
        const res = await DhanApiService.placeOrder(
          pending.orderReq,
          selectedContract.tradingSymbol
        );

        setPendingOrder(null);
        setPendingLevelChange(null);
        await refreshActivePosition();
        await AutoSquareOffEngine.checkAndEnforce();

        showToast(
          `✓ ${pending.side} ${pending.lots} Lot executed @ ₹${pending.price.toFixed(1)} (${res.orderId})`,
          'success',
          2600
        );

        if (onTradeExecuted) onTradeExecuted();
      } catch (err: any) {
        showToast(`✕ Order failed: ${err?.message || 'Broker rejected order'}`, 'error', 3200);
      } finally {
        setIsSubmitting(false);
      }
    },
    [selectedContract.tradingSymbol, refreshActivePosition, onTradeExecuted, showToast]
  );

  // Entry point for both bottom CTA button and on-chart Quick BUY/SELL buttons
  const handleOrderIntent = async (overrideSide?: TransactionType, overridePrice?: number) => {
    const side = overrideSide || transactionType;
    const price =
      overridePrice ?? (orderType === 'MARKET' && liveLtpRef.current > 0 ? liveLtpRef.current : entryPrice);

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
      showToast(`🛡️ Blocked: ${preFlight.reasons[0] || 'Compliance rule failed'}`, 'error', 3400);
      return;
    }

    const slPts = sl ? Math.abs(price - sl) : 0;
    const tpPts = tp ? Math.abs(tp - price) : 0;
    const maxRisk = slPts * totalQty;
    const maxReward = tpPts * totalQty;
    const rrRatio = slPts > 0 && tpPts > 0 ? tpPts / slPts : 0;

    const preparedOrder: PendingOrderConfirm = {
      side,
      orderType,
      price,
      sl,
      tp,
      lots,
      totalQty,
      maxRisk,
      maxReward,
      rrRatio,
      warnings: preFlight.warnings,
      orderReq,
    };

    if (oneClickMode) {
      await commitOrder(preparedOrder);
    } else {
      setPendingOrder(preparedOrder);
    }
  };

  // Quick Exit Open Position directly from chart button
  const handleQuickExitPosition = async (pos: DhanPosition) => {
    try {
      const res = await DhanApiService.exitPosition(pos);
      await ComplianceEngine.recordTradeResult(pos.unrealizedProfit);
      await refreshActivePosition();
      await AutoSquareOffEngine.checkAndEnforce();
      showToast(
        `✓ Exited ${pos.tradingSymbol} (${res?.orderId || 'OK'})`,
        'success',
        2600
      );
      if (onTradeExecuted) onTradeExecuted();
    } catch (err: any) {
      showToast(`✕ Exit failed: ${err?.message || 'Could not exit position'}`, 'error', 3200);
    }
  };

  const liveChangePercent =
    selectedContract.previousClose > 0
      ? Number(
          (((liveLtp - selectedContract.previousClose) / selectedContract.previousClose) * 100).toFixed(2)
        )
      : selectedContract.changePercent;

  const ltpColor =
    tickDirection === 'up'
      ? '#10B981'
      : tickDirection === 'down'
      ? '#EF4444'
      : '#F8FAFC';

  // Compute live risk/reward detail text for the inline Confirm Level Prompt bar
  const pendingLevelImpactText = (() => {
    if (!pendingLevelChange) return '';
    const { line, newPrice } = pendingLevelChange;
    if (line === 'SL') {
      const risk = Math.abs(entryPrice - newPrice) * totalQty;
      return ` (Risk: -₹${Math.round(risk).toLocaleString('en-IN')})`;
    }
    if (line === 'TP') {
      const reward = Math.abs(newPrice - entryPrice) * totalQty;
      return ` (Target: +₹${Math.round(reward).toLocaleString('en-IN')})`;
    }
    if (stopLossPrice) {
      const risk = Math.abs(newPrice - stopLossPrice) * totalQty;
      return ` (Risk: -₹${Math.round(risk).toLocaleString('en-IN')})`;
    }
    return '';
  })();

  return (
    <View style={styles.container}>
      {/* Strike Quick Selector Header */}
      <View style={styles.topSelectorBar}>
        <View style={styles.headerLeft}>
          <View style={styles.symbolRow}>
            <Text style={styles.symbolTitle}>{selectedContract.tradingSymbol}</Text>
            <View style={styles.liveDotBadge}>
              <Text style={styles.liveDotText}>● LIVE</Text>
            </View>
          </View>
          <View style={styles.ltpRow}>
            <Text style={styles.subTitle}>LTP: </Text>
            <Text style={[styles.liveLtpVal, { color: ltpColor }]}>
              ₹{liveLtp.toFixed(2)}
            </Text>
            <Text
              style={[
                styles.liveChangeText,
                { color: liveChangePercent >= 0 ? '#10B981' : '#EF4444' },
              ]}
            >
              {' '}({liveChangePercent >= 0 ? '+' : ''}
              {liveChangePercent.toFixed(2)}%)
            </Text>
            <Text style={styles.subTitle}> • Lot: {lotSize}</Text>
          </View>
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

      {/* Auto-dismissing Toast Banner */}
      {toast && (
        <View
          style={[
            styles.toastBanner,
            toast.tone === 'success' && styles.toastSuccess,
            toast.tone === 'warning' && styles.toastWarning,
            toast.tone === 'error' && styles.toastError,
          ]}
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      {/* Interactive TradingView Chart with Drag Handles, TP/SL Box, Drawing Tools & On-Chart Orders */}
      <View style={styles.chartWrapper}>
        <InteractiveChartWithTick
          candles={candles}
          symbol={selectedContract.tradingSymbol}
          transactionType={transactionType}
          orderType={orderType}
          entryPrice={entryPrice}
          stopLossPrice={stopLossPrice}
          targetPrice={targetPrice}
          lotSize={lotSize}
          lots={lots}
          activePosition={activePosition}
          latestTick={latestTick}
          onLevelChange={handleLevelChange}
          onQuickOrder={(side, price) => handleOrderIntent(side, price)}
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

      {/* Inline Confirm Prompt Bar for Dragged ENTRY / SL / TP Lines (Safe Confirm Mode) */}
      {pendingLevelChange && !oneClickMode && (
        <View style={styles.confirmLevelBar}>
          <View style={styles.confirmLevelInfo}>
            <Text style={styles.confirmLevelTitle}>
              Move {pendingLevelChange.line}: ₹{pendingLevelChange.previousPrice.toFixed(1)} → ₹
              {pendingLevelChange.newPrice.toFixed(1)}
              <Text style={styles.confirmLevelImpact}>{pendingLevelImpactText}</Text>
            </Text>
          </View>
          <View style={styles.confirmLevelBtns}>
            <TouchableOpacity
              style={styles.confirmActionBtn}
              onPress={handleConfirmLevelChange}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmActionText}>✓ Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.revertActionBtn}
              onPress={handleRevertLevelChange}
              activeOpacity={0.8}
            >
              <Text style={styles.revertActionText}>✕ Revert</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Bottom Order Panel */}
      <ChartOrderPanelWithMode
        transactionType={transactionType}
        setTransactionType={handleSetTransactionType}
        orderType={orderType}
        setOrderType={handleSetOrderType}
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
        onPlaceOrder={() => handleOrderIntent()}
        isSubmitting={isSubmitting}
        oneClickMode={oneClickMode}
        onToggleOneClickMode={handleToggleOneClickMode}
      />

      {/* Cross-Platform Dark Confirm Order Overlay (Safe Confirm Mode) */}
      {pendingOrder && (
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmOrderCard}>
            <View style={styles.confirmOrderHeader}>
              <View style={styles.confirmOrderBadgeRow}>
                <View
                  style={[
                    styles.sidePill,
                    pendingOrder.side === 'BUY' ? styles.sidePillBuy : styles.sidePillSell,
                  ]}
                >
                  <Text style={styles.sidePillText}>{pendingOrder.side}</Text>
                </View>
                <Text style={styles.confirmOrderType}>{pendingOrder.orderType}</Text>
                <Text style={styles.confirmOrderSymbol} numberOfLines={1}>
                  {selectedContract.tradingSymbol}
                </Text>
              </View>
            </View>

            <View style={styles.confirmOrderGrid}>
              <View style={styles.confirmGridCell}>
                <Text style={styles.confirmGridLabel}>Qty</Text>
                <Text style={styles.confirmGridValue}>
                  {pendingOrder.lots} Lot ({pendingOrder.totalQty})
                </Text>
              </View>
              <View style={styles.confirmGridCell}>
                <Text style={styles.confirmGridLabel}>Entry</Text>
                <Text style={styles.confirmGridValue}>₹{pendingOrder.price.toFixed(1)}</Text>
              </View>
              <View style={styles.confirmGridCell}>
                <Text style={styles.confirmGridLabel}>Stop Loss</Text>
                <Text style={[styles.confirmGridValue, { color: '#EF4444' }]}>
                  {pendingOrder.sl ? `₹${pendingOrder.sl.toFixed(1)}` : 'None'}
                </Text>
              </View>
              <View style={styles.confirmGridCell}>
                <Text style={styles.confirmGridLabel}>Target</Text>
                <Text style={[styles.confirmGridValue, { color: '#10B981' }]}>
                  {pendingOrder.tp ? `₹${pendingOrder.tp.toFixed(1)}` : 'None'}
                </Text>
              </View>
            </View>

            <View style={styles.confirmMetricsStrip}>
              <Text style={styles.confirmMetricText}>
                Max Risk:{' '}
                <Text style={{ color: '#EF4444', fontWeight: '800' }}>
                  -₹{Math.round(pendingOrder.maxRisk).toLocaleString('en-IN')}
                </Text>
              </Text>
              <Text style={styles.confirmMetricText}>
                R:R:{' '}
                <Text style={{ color: '#38BDF8', fontWeight: '800' }}>
                  {pendingOrder.rrRatio > 0 ? `1:${pendingOrder.rrRatio.toFixed(2)}` : '—'}
                </Text>
              </Text>
            </View>

            {pendingOrder.warnings.length > 0 && (
              <View style={styles.confirmWarnBox}>
                <Text style={styles.confirmWarnText}>
                  ⚠️ {pendingOrder.warnings[0]}
                </Text>
              </View>
            )}

            <View style={styles.confirmOrderActions}>
              <TouchableOpacity
                style={styles.cancelOrderBtn}
                onPress={() => setPendingOrder(null)}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelOrderBtnText}>✕ Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.placeOrderConfirmBtn,
                  pendingOrder.side === 'SELL' && styles.placeOrderConfirmBtnSell,
                  isSubmitting && { opacity: 0.6 },
                ]}
                onPress={() => commitOrder(pendingOrder)}
                disabled={isSubmitting}
                activeOpacity={0.85}
              >
                <Text style={styles.placeOrderConfirmBtnText}>
                  {isSubmitting ? 'Placing...' : '✓ Confirm & Place'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    position: 'relative',
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
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  symbolTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 14,
  },
  liveDotBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  liveDotText: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  ltpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  liveLtpVal: {
    fontSize: 12,
    fontWeight: '800',
  },
  liveChangeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  subTitle: {
    color: '#94A3B8',
    fontSize: 11,
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
  toastBanner: {
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#38BDF8',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toastSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderBottomColor: '#10B981',
  },
  toastWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderBottomColor: '#F59E0B',
  },
  toastError: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderBottomColor: '#EF4444',
  },
  toastText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  chartWrapper: {
    flex: 1,
  },
  confirmLevelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#172554',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#38BDF8',
  },
  confirmLevelInfo: {
    flex: 1,
    minWidth: 170,
  },
  confirmLevelTitle: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  confirmLevelImpact: {
    color: '#FBBF24',
    fontWeight: '800',
  },
  confirmLevelBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confirmActionBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmActionText: {
    color: '#042F2E',
    fontSize: 11,
    fontWeight: '800',
  },
  revertActionBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  revertActionText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 50,
  },
  confirmOrderCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
  },
  confirmOrderHeader: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 8,
  },
  confirmOrderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sidePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sidePillBuy: {
    backgroundColor: '#10B981',
  },
  sidePillSell: {
    backgroundColor: '#EF4444',
  },
  sidePillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  confirmOrderType: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  confirmOrderSymbol: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  confirmOrderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  confirmGridCell: {
    width: '47%',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  confirmGridLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  confirmGridValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  confirmMetricsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B1220',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  confirmMetricText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
  confirmWarnBox: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginBottom: 10,
  },
  confirmWarnText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '600',
  },
  confirmOrderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelOrderBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelOrderBtnText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  placeOrderConfirmBtn: {
    flex: 1.5,
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  placeOrderConfirmBtnSell: {
    backgroundColor: '#EF4444',
  },
  placeOrderConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
