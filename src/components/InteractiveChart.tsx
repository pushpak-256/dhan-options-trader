import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { CandleData, TransactionType, DhanPosition, OrderType } from '../types/dhan';

export type DrawingTool =
  | 'POINTER'
  | 'DRAG'
  | 'TPSL'
  | 'HLINE'
  | 'TRENDLINE'
  | 'RAY'
  | 'CHANNEL'
  | 'FIB';

export interface LiveChartTick {
  price: number;
  volume?: number;
  timestamp: number;
}

interface InteractiveChartProps {
  candles: CandleData[];
  symbol: string;
  transactionType: TransactionType;
  orderType?: OrderType;
  entryPrice: number;
  stopLossPrice?: number;
  targetPrice?: number;
  lotSize: number;
  lots: number;
  activePosition?: DhanPosition | null;
  latestTick?: LiveChartTick | null;
  onLevelChange?: (line: 'ENTRY' | 'SL' | 'TP', price: number) => void;
  onQuickOrder?: (side: TransactionType, price: number) => void;
  onQuickExitPosition?: (pos: DhanPosition) => void;
  onPriceSelected?: (price: number) => void;
  activeLineType?: 'ENTRY' | 'SL' | 'TP';
  showVWAP?: boolean;
  showEMA9?: boolean;
  timeframe?: string;
  onSelectTimeframe?: (tf: string) => void;
  onToggleVWAP?: () => void;
  onToggleEMA9?: () => void;
}

const OPACITY_STEPS = [1.0, 0.65, 0.35, 0.15] as const;

export const InteractiveChart: React.FC<InteractiveChartProps> = ({
  candles,
  symbol,
  transactionType,
  orderType = 'LIMIT',
  entryPrice,
  stopLossPrice,
  targetPrice,
  lotSize,
  lots,
  activePosition,
  latestTick,
  onLevelChange,
  onQuickOrder,
  onQuickExitPosition,
  onPriceSelected,
  activeLineType = 'SL',
  showVWAP = true,
  showEMA9 = true,
  timeframe = '5m',
  onSelectTimeframe,
  onToggleVWAP,
  onToggleEMA9,
}) => {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<any>(null);
  const WebViewComponent: any = WebView;

  // Additional native KLineChart indicator toggles (main & sub-panes)
  const [showBOLL, setShowBOLL] = useState<boolean>(false);
  const [showVOL, setShowVOL] = useState<boolean>(true);
  const [showRSI, setShowRSI] = useState<boolean>(false);

  // Order line & shaded TP/SL zone opacity control (100% -> 65% -> 35% -> 15%)
  const [opacityIndex, setOpacityIndex] = useState<number>(0);
  const overlayOpacity = OPACITY_STEPS[opacityIndex];

  const [showTpSlBox, setShowTpSlBox] = useState<boolean>(true);

  const totalQty = lotSize * lots;

  // Detect whether SL / TP are placed on the wrong side of Entry
  const isSlInverted =
    !!stopLossPrice &&
    stopLossPrice > 0 &&
    (transactionType === 'BUY'
      ? stopLossPrice >= entryPrice
      : stopLossPrice <= entryPrice);

  const isTpInverted =
    !!targetPrice &&
    targetPrice > 0 &&
    (transactionType === 'BUY'
      ? targetPrice <= entryPrice
      : targetPrice >= entryPrice);

  // Calculate SL risk & TP reward
  const slRiskPts = stopLossPrice && !isSlInverted ? Math.abs(entryPrice - stopLossPrice) : 0;
  const slRiskRupees = slRiskPts * totalQty;

  const tpRewardPts = targetPrice && !isTpInverted ? Math.abs(targetPrice - entryPrice) : 0;
  const tpRewardRupees = tpRewardPts * totalQty;

  const rrRatio = slRiskPts > 0 && tpRewardPts > 0 ? (tpRewardPts / slRiskPts).toFixed(2) : '-';

  // Helper to send commands to chart without reloading iframe/webview
  const postToChart = useCallback((payload: Record<string, any>) => {
    const msg = JSON.stringify(payload);
    if (Platform.OS === 'web') {
      try {
        iframeRef.current?.contentWindow?.postMessage(msg, '*');
      } catch {}
    } else {
      try {
        webViewRef.current?.injectJavaScript(
          `window.handleHostMessage && window.handleHostMessage(${JSON.stringify(msg)}); true;`
        );
      } catch {}
    }
  }, []);

  const syncStateToChart = useCallback(() => {
    postToChart({
      type: 'SYNC_STATE',
      side: transactionType,
      orderType,
      entry: entryPrice,
      sl: stopLossPrice || 0,
      tp: targetPrice || 0,
      totalQty,
      showTpSlBox,
      overlayOpacity,
      timeframe,
      activeLineType,
      indicators: {
        vwap: showVWAP,
        ema: showEMA9,
        boll: showBOLL,
        vol: showVOL,
        rsi: showRSI,
      },
      activePosition:
        activePosition && activePosition.netQty !== 0
          ? {
              avgPrice: activePosition.netQty > 0 ? activePosition.buyAvg : activePosition.sellAvg,
              netQty: activePosition.netQty,
              pnl: activePosition.unrealizedProfit,
            }
          : null,
    });
  }, [
    postToChart,
    transactionType,
    orderType,
    entryPrice,
    stopLossPrice,
    targetPrice,
    totalQty,
    showTpSlBox,
    overlayOpacity,
    timeframe,
    activeLineType,
    showVWAP,
    showEMA9,
    showBOLL,
    showVOL,
    showRSI,
    activePosition,
  ]);

  // Sync dynamic state smoothly to KLineChart without reloading
  useEffect(() => {
    syncStateToChart();
  }, [syncStateToChart]);

  // Stream real-time tick-by-tick updates without reloading chart
  useEffect(() => {
    if (!latestTick || !latestTick.price || latestTick.price <= 0) return;
    postToChart({
      type: 'LIVE_TICK',
      price: latestTick.price,
      volume: latestTick.volume,
      timestamp: latestTick.timestamp,
    });
  }, [latestTick, postToChart]);

  const handleCycleOpacity = () => {
    setOpacityIndex((prev) => (prev + 1) % OPACITY_STEPS.length);
  };

  const handleResetChart = () => {
    postToChart({ type: 'RESET_CHART' });
  };

  // Build HTML only when candles or symbol change (never on drag, ticks, opacity, or indicators!)
  const chartHtml = useMemo(() => {
    const initialEntry = candles.length > 0 ? candles[candles.length - 1].close : entryPrice;
    const safeSymbol = String(symbol)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const safeJson = (val: unknown) => JSON.stringify(val).replace(/</g, '\\u003c');

    const klineInitialData = candles.map((c) => ({
      timestamp: c.time < 1e12 ? c.time * 1000 : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: typeof c.volume === 'number' && c.volume > 0 ? c.volume : 100,
    }));

    return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://cdn.jsdelivr.net/npm/klinecharts@9.8.12/dist/umd/klinecharts.min.js"></script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
      body, html {
        width: 100%;
        height: 100%;
        background-color: #0F172A;
        overflow: hidden;
        touch-action: none;
        overscroll-behavior: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #app {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: row;
        background: #0F172A;
        touch-action: none;
        overscroll-behavior: none;
      }
      /* TradingView-style Left Vertical Drawing Rail */
      #drawRail {
        width: 38px;
        flex-shrink: 0;
        height: 100%;
        background: #0B1120;
        border-right: 1px solid #1E293B;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4px 2px;
        gap: 3px;
        overflow-y: auto;
        scrollbar-width: none;
        z-index: 40;
      }
      #drawRail::-webkit-scrollbar { display: none; }
      .rail-btn {
        width: 30px;
        height: 28px;
        flex-shrink: 0;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: #94A3B8;
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
        position: relative;
      }
      .rail-btn:hover { background: #1E293B; color: #F8FAFC; }
      .rail-btn:active { transform: scale(0.93); }
      .rail-btn.active {
        background: rgba(56, 189, 248, 0.2);
        border-color: #38BDF8;
        color: #38BDF8;
      }
      .rail-btn.active-green {
        background: rgba(16, 185, 129, 0.18);
        border-color: #10B981;
        color: #34D399;
      }
      .rail-btn.active-amber {
        background: rgba(245, 158, 11, 0.18);
        border-color: #F59E0B;
        color: #FBBF24;
      }
      .rail-btn.active-red {
        background: rgba(239, 68, 68, 0.16);
        border-color: #EF4444;
        color: #F87171;
      }
      .rail-btn.dimmed { opacity: 0.42; }
      .rail-sep {
        width: 22px;
        height: 1px;
        background: #1E293B;
        margin: 2px 0;
        flex-shrink: 0;
      }
      .rail-badge {
        position: absolute;
        top: 1px;
        right: 1px;
        min-width: 12px;
        height: 12px;
        border-radius: 6px;
        background: #EF4444;
        color: #FFFFFF;
        font-size: 8px;
        font-weight: 800;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 2px;
      }
      /* Main Chart Area right of Left Rail */
      #chartArea {
        flex: 1;
        min-width: 0;
        height: 100%;
        position: relative;
        overflow: hidden;
        touch-action: none;
        overscroll-behavior: none;
      }
      #klineContainer {
        width: 100%;
        height: 100%;
        position: absolute;
        inset: 0;
        touch-action: none;
        overscroll-behavior: none;
      }
      #overlayCanvas {
        width: 100%;
        height: 100%;
        position: absolute;
        inset: 0;
        z-index: 15;
        pointer-events: none;
      }
      .chart-header {
        position: absolute;
        top: 5px;
        left: 6px;
        z-index: 25;
        height: 22px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.86);
        padding: 0 8px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        pointer-events: none;
        max-width: calc(100% - 210px);
        overflow: hidden;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .symbol-text {
        color: #F8FAFC;
        font-weight: 700;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ltp-text {
        color: #38BDF8;
        font-weight: 800;
        font-size: 11px;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
        transition: color 0.15s;
      }
      .ltp-up { color: #34D399 !important; }
      .ltp-down { color: #F87171 !important; }
      .quick-order-bar {
        position: absolute;
        top: 5px;
        right: 64px;
        z-index: 30;
        display: flex;
        gap: 5px;
        align-items: center;
        font-variant-numeric: tabular-nums;
      }
      .qbtn {
        border: none;
        border-radius: 5px;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 800;
        color: #FFFFFF;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.42);
        letter-spacing: 0.25px;
        white-space: nowrap;
      }
      .qbtn:active { transform: scale(0.94); }
      .qbtn-buy { background: rgba(16, 185, 129, 0.92); border: 1px solid #34D399; }
      .qbtn-sell { background: rgba(239, 68, 68, 0.92); border: 1px solid #F87171; }
      .qbtn-exit { background: rgba(245, 158, 11, 0.96); color: #0F172A; border: 1px solid #FDE047; }
      .hint-pill {
        position: absolute;
        bottom: 28px;
        left: 6px;
        z-index: 25;
        background: rgba(15, 23, 42, 0.86);
        color: #94A3B8;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        pointer-events: none;
        max-width: calc(100% - 166px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .floating-axis-controls {
        position: absolute;
        bottom: 28px;
        right: 66px;
        z-index: 30;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .auto-y-btn {
        height: 24px;
        padding: 0 6px;
        border-radius: 5px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(15, 23, 42, 0.9);
        color: #38BDF8;
        font-size: 9px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
      }
      .auto-y-btn.manual {
        border-color: rgba(245, 158, 11, 0.7);
        background: rgba(245, 158, 11, 0.18);
        color: #FBBF24;
      }
      .floating-reset-btn {
        width: 26px;
        height: 24px;
        border-radius: 5px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(15, 23, 42, 0.9);
        color: #38BDF8;
        font-size: 13px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
      }
      .floating-reset-btn:hover, .auto-y-btn:hover { background: #1E293B; color: #7DD3FC; }
      .floating-reset-btn:active, .auto-y-btn:active { transform: scale(0.92); }
      @media (max-width: 440px) {
        #drawRail { width: 32px; padding: 3px 1px; gap: 2px; }
        .rail-btn { width: 26px; height: 25px; font-size: 12px; }
        .chart-header { height: 20px; padding: 0 6px; gap: 4px; max-width: calc(100% - 178px); }
        .symbol-text, .ltp-text { font-size: 10px; }
        .quick-order-bar { right: 56px; gap: 3px; }
        .qbtn { padding: 3px 6px; font-size: 9px; letter-spacing: 0.1px; }
        .hint-pill { font-size: 9px; padding: 2px 6px; bottom: 26px; max-width: calc(100% - 146px); }
        .floating-axis-controls { bottom: 26px; right: 58px; gap: 3px; }
        .auto-y-btn { height: 22px; padding: 0 5px; font-size: 8.5px; }
        .floating-reset-btn { width: 24px; height: 22px; font-size: 12px; }
      }
    </style>
  </head>
  <body>
    <div id="app">
      <!-- TradingView-style Left Vertical Drawing Toolbar -->
      <div id="drawRail" role="toolbar" aria-label="Drawing tools">
        <button class="rail-btn active" id="toolPointer" title="Pointer / Crosshair (Select & Drag)">✛</button>
        <button class="rail-btn" id="toolSegment" title="Trendline">╱</button>
        <button class="rail-btn" id="toolRay" title="Ray">↗</button>
        <button class="rail-btn" id="toolHLine" title="Horizontal Line">━</button>
        <button class="rail-btn" id="toolChannel" title="Parallel Channel">║</button>
        <button class="rail-btn" id="toolFib" title="Fibonacci Retracement">≡</button>
        <div class="rail-sep"></div>
        <button class="rail-btn active-green" id="toolTpSl" title="Toggle TP / SL Risk-Reward Box">📐</button>
        <button class="rail-btn" id="toolMagnet" title="Magnet Snap to OHLC">🧲</button>
        <div class="rail-sep"></div>
        <button class="rail-btn dimmed" id="toolDeleteSel" title="Delete Selected Drawing">⌫</button>
        <button class="rail-btn dimmed" id="toolUndo" title="Undo Last Drawing">↩️</button>
        <button class="rail-btn dimmed" id="toolClear" title="Clear All Drawings">🗑️<span class="rail-badge" id="drawBadge">0</span></button>
      </div>

      <!-- KLineChart + Draggable Order Levels Overlay -->
      <div id="chartArea">
        <div id="klineContainer"></div>
        <canvas id="overlayCanvas"></canvas>

        <div class="chart-header">
          <span class="symbol-text">${safeSymbol}</span>
          <span class="ltp-text" id="ltpHeader">₹${initialEntry.toFixed(2)}</span>
        </div>

        <div class="quick-order-bar">
          <button class="qbtn qbtn-buy" id="btnQuickBuy">BUY</button>
          <button class="qbtn qbtn-sell" id="btnQuickSell">SELL</button>
          <button class="qbtn qbtn-exit" id="btnQuickExit" style="display:none;">✕ EXIT</button>
        </div>

        <div class="hint-pill" id="hintPill">✛ Drag pills to adjust TP/SL, drag chart to pan X & Y</div>
        <div class="floating-axis-controls">
          <button class="auto-y-btn" id="btnAutoY" title="Toggle Auto Y-Axis Scale">Auto Y</button>
          <button class="floating-reset-btn" id="btnResetChart" title="Auto-fit & Reset Chart View">⟲</button>
        </div>
      </div>
    </div>

    <script>
      const chartArea = document.getElementById('chartArea');
      const klineContainer = document.getElementById('klineContainer');
      const canvas = document.getElementById('overlayCanvas');
      const ctx = canvas.getContext('2d');
      const ltpHeader = document.getElementById('ltpHeader');
      const hintPill = document.getElementById('hintPill');
      const btnQuickBuy = document.getElementById('btnQuickBuy');
      const btnQuickSell = document.getElementById('btnQuickSell');
      const btnQuickExit = document.getElementById('btnQuickExit');
      const btnAutoY = document.getElementById('btnAutoY');
      const btnResetChart = document.getElementById('btnResetChart');
      const drawBadge = document.getElementById('drawBadge');

      const railBtns = {
        POINTER: document.getElementById('toolPointer'),
        segment: document.getElementById('toolSegment'),
        rayLine: document.getElementById('toolRay'),
        horizontalStraightLine: document.getElementById('toolHLine'),
        parallelStraightLine: document.getElementById('toolChannel'),
        fibonacciLine: document.getElementById('toolFib'),
        TPSL: document.getElementById('toolTpSl'),
        MAGNET: document.getElementById('toolMagnet'),
        DELETE_SEL: document.getElementById('toolDeleteSel'),
        UNDO: document.getElementById('toolUndo'),
        CLEAR: document.getElementById('toolClear'),
      };

      function sendToHost(obj) {
        const msg = JSON.stringify(obj);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(msg);
        } else if (window.parent) {
          window.parent.postMessage(msg, '*');
        }
      }

      // Register custom native VWAP indicator in KLineChart v9
      if (window.klinecharts && typeof klinecharts.registerIndicator === 'function') {
        klinecharts.registerIndicator({
          name: 'VWAP',
          shortName: 'VWAP',
          series: 'price',
          precision: 2,
          figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
          styles: {
            lines: [
              {
                style: 'solid',
                smooth: false,
                size: 1.5,
                dashedValue: [2, 2],
                color: '#F59E0B',
              },
            ],
          },
          calc: (dataList) => {
            let cumPV = 0;
            let cumVol = 0;
            return dataList.map((k) => {
              const typical = (k.high + k.low + k.close) / 3;
              const vol = k.volume && k.volume > 0 ? k.volume : 1;
              cumPV += typical * vol;
              cumVol += vol;
              return { vwap: cumVol > 0 ? cumPV / cumVol : k.close };
            });
          },
        });
      }

      // Initialize KLineChart v9 in TradingView Dark theme
      const chart = klinecharts.init(klineContainer, {
        styles: {
          grid: {
            show: true,
            horizontal: { show: true, size: 1, color: '#1E293B', style: 'solid', dashedValue: [2, 2] },
            vertical: { show: true, size: 1, color: '#1E293B', style: 'solid', dashedValue: [2, 2] },
          },
          candle: {
            type: 'candle_solid',
            bar: {
              upColor: '#10B981',
              downColor: '#EF4444',
              noChangeColor: '#64748B',
              upBorderColor: '#10B981',
              downBorderColor: '#EF4444',
              noChangeBorderColor: '#64748B',
              upWickColor: '#10B981',
              downWickColor: '#EF4444',
              noChangeWickColor: '#64748B',
            },
            priceMark: {
              show: true,
              high: { show: true, color: '#94A3B8', textOffset: 4, textSize: 9, textFamily: 'sans-serif', textWeight: '600' },
              low: { show: true, color: '#94A3B8', textOffset: 4, textSize: 9, textFamily: 'sans-serif', textWeight: '600' },
              last: {
                show: true,
                upColor: '#10B981',
                downColor: '#EF4444',
                noChangeColor: '#38BDF8',
                line: { show: true, style: 'dashed', dashedValue: [4, 4], size: 1 },
                text: {
                  show: true,
                  style: 'fill',
                  size: 10,
                  paddingLeft: 4,
                  paddingTop: 2,
                  paddingRight: 4,
                  paddingBottom: 2,
                  color: '#FFFFFF',
                  family: 'sans-serif',
                  weight: '700',
                  borderRadius: 3,
                },
              },
            },
            tooltip: {
              showRule: 'follow_cross',
              showType: 'standard',
              offsetTop: 30,
              offsetLeft: 6,
              text: { size: 10, family: 'sans-serif', weight: '600', color: '#CBD5E1', marginLeft: 6, marginTop: 2, marginRight: 4, marginBottom: 2 },
            },
          },
          indicator: {
            ohlc: { upColor: 'rgba(16, 185, 129, 0.7)', downColor: 'rgba(239, 68, 68, 0.7)', noChangeColor: '#64748B' },
            bars: [
              {
                style: 'fill',
                borderStyle: 'solid',
                borderSize: 1,
                borderDashedValue: [2, 2],
                upColor: 'rgba(16, 185, 129, 0.48)',
                downColor: 'rgba(239, 68, 68, 0.48)',
                noChangeColor: 'rgba(100, 116, 139, 0.48)',
              },
            ],
            lines: [
              { style: 'solid', smooth: false, size: 1.5, dashedValue: [2, 2], color: '#06B6D4' },
              { style: 'solid', smooth: false, size: 1.5, dashedValue: [2, 2], color: '#A855F7' },
              { style: 'solid', smooth: false, size: 1.2, dashedValue: [2, 2], color: '#F59E0B' },
              { style: 'solid', smooth: false, size: 1.2, dashedValue: [2, 2], color: '#EC4899' },
            ],
            tooltip: {
              showRule: 'always',
              showType: 'standard',
              showName: true,
              showParams: true,
              offsetTop: 28,
              offsetLeft: 6,
              text: { size: 9, family: 'sans-serif', weight: '600', color: '#94A3B8', marginTop: 2, marginRight: 6, marginBottom: 2, marginLeft: 4 },
            },
          },
          xAxis: {
            show: true,
            axisLine: { show: true, color: '#334155', size: 1 },
            tickText: { show: true, color: '#94A3B8', family: 'sans-serif', weight: '500', size: 10 },
            tickLine: { show: true, size: 1, length: 3, color: '#334155' },
          },
          yAxis: {
            show: true,
            position: 'right',
            type: 'normal',
            inside: false,
            axisLine: { show: true, color: '#334155', size: 1 },
            tickText: { show: true, color: '#94A3B8', family: 'sans-serif', weight: '600', size: 10 },
            tickLine: { show: true, size: 1, length: 3, color: '#334155' },
          },
          separator: {
            size: 1,
            color: '#1E293B',
            fill: true,
            activeBackgroundColor: 'rgba(56, 189, 248, 0.25)',
          },
          crosshair: {
            show: true,
            horizontal: {
              show: true,
              line: { show: true, style: 'dashed', dashedValue: [4, 3], size: 1, color: '#64748B' },
              text: { show: true, style: 'fill', color: '#F8FAFC', size: 10, family: 'sans-serif', weight: '700', backgroundColor: '#1E293B', borderColor: '#38BDF8', borderSize: 1, borderRadius: 3 },
            },
            vertical: {
              show: true,
              line: { show: true, style: 'dashed', dashedValue: [4, 3], size: 1, color: '#64748B' },
              text: { show: true, style: 'fill', color: '#F8FAFC', size: 10, family: 'sans-serif', weight: '600', backgroundColor: '#1E293B', borderColor: '#334155', borderSize: 1, borderRadius: 3 },
            },
          },
          overlay: {
            point: {
              color: '#38BDF8',
              borderColor: 'rgba(56, 189, 248, 0.35)',
              borderSize: 2,
              radius: 4.5,
              activeColor: '#F59E0B',
              activeBorderColor: 'rgba(245, 158, 11, 0.45)',
              activeBorderSize: 3,
              activeRadius: 6,
            },
            line: { style: 'solid', smooth: false, color: '#38BDF8', size: 1.6, dashedValue: [4, 3] },
            rect: { style: 'fill', color: 'rgba(56, 189, 248, 0.14)', borderColor: '#38BDF8', borderSize: 1 },
            polygon: { style: 'fill', color: 'rgba(56, 189, 248, 0.14)', borderColor: '#38BDF8', borderSize: 1 },
            text: { style: 'fill', color: '#F8FAFC', size: 10, family: 'sans-serif', weight: '700', backgroundColor: 'rgba(15, 23, 42, 0.85)', borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
          },
        },
      });

      chart.setPriceVolumePrecision(2, 0);
      try { chart.setTimezone('Asia/Kolkata'); } catch (e) {}
      chart.setOffsetRightDistance(56);

      const klineBars = ${safeJson(klineInitialData)};
      if (klineBars.length > 0) {
        chart.applyNewData(klineBars);
      }

      // Mutable interactive state
      const state = {
        side: ${safeJson(transactionType)},
        orderType: ${safeJson(orderType)},
        entry: ${Number(entryPrice) || 0},
        sl: ${Number(stopLossPrice) || 0},
        tp: ${Number(targetPrice) || 0},
        totalQty: ${Number(totalQty) || 0},
        showTpSlBox: true,
        overlayOpacity: 1.0,
        timeframe: ${safeJson(timeframe)},
        activeLineType: ${safeJson(activeLineType)},
        activePosition: null,
        magnet: false,
        lastLtp: klineBars.length > 0 ? klineBars[klineBars.length - 1].close : (${Number(entryPrice) || 0}),
        livePrice: klineBars.length > 0 ? klineBars[klineBars.length - 1].close : (${Number(entryPrice) || 0}),
      };

      function getEffectiveEntryPrice() {
        if (state.orderType === 'MARKET') {
          return state.livePrice > 0 ? state.livePrice : (state.lastLtp > 0 ? state.lastLtp : state.entry);
        }
        return state.entry;
      }

      function updateQuickOrderButtons() {
        const isMarket = state.orderType === 'MARKET';
        const px = getEffectiveEntryPrice();
        btnQuickBuy.textContent = (isMarket ? 'BUY MKT ₹' : 'BUY ₹') + px.toFixed(1);
        btnQuickSell.textContent = (isMarket ? 'SELL MKT ₹' : 'SELL ₹') + px.toFixed(1);
      }

      // Native KLineChart indicator state
      const indicatorState = {
        vwap: false,
        ema: false,
        boll: false,
        vol: false,
        rsi: false,
        volPaneId: null,
        rsiPaneId: null,
      };

      function syncIndicators(ind) {
        if (!ind) return;
        // Main pane: VWAP
        if (!!ind.vwap !== indicatorState.vwap) {
          if (ind.vwap) {
            chart.createIndicator('VWAP', true, { id: 'candle_pane' });
          } else {
            chart.removeIndicator('candle_pane', 'VWAP');
          }
          indicatorState.vwap = !!ind.vwap;
        }
        // Main pane: EMA (9, 21)
        if (!!ind.ema !== indicatorState.ema) {
          if (ind.ema) {
            chart.createIndicator({ name: 'EMA', calcParams: [9, 21] }, true, { id: 'candle_pane' });
          } else {
            chart.removeIndicator('candle_pane', 'EMA');
          }
          indicatorState.ema = !!ind.ema;
        }
        // Main pane: BOLL
        if (!!ind.boll !== indicatorState.boll) {
          if (ind.boll) {
            chart.createIndicator('BOLL', true, { id: 'candle_pane' });
          } else {
            chart.removeIndicator('candle_pane', 'BOLL');
          }
          indicatorState.boll = !!ind.boll;
        }
        // Sub-pane: VOL
        if (!!ind.vol !== indicatorState.vol) {
          if (ind.vol) {
            indicatorState.volPaneId = chart.createIndicator('VOL', false, { height: 64, minHeight: 44 });
          } else if (indicatorState.volPaneId) {
            chart.removeIndicator(indicatorState.volPaneId, 'VOL');
            indicatorState.volPaneId = null;
          }
          indicatorState.vol = !!ind.vol;
        }
        // Sub-pane: RSI (14)
        if (!!ind.rsi !== indicatorState.rsi) {
          if (ind.rsi) {
            indicatorState.rsiPaneId = chart.createIndicator(
              { name: 'RSI', calcParams: [14] },
              false,
              { height: 70, minHeight: 48 }
            );
          } else if (indicatorState.rsiPaneId) {
            chart.removeIndicator(indicatorState.rsiPaneId, 'RSI');
            indicatorState.rsiPaneId = null;
          }
          indicatorState.rsi = !!ind.rsi;
        }
        setTimeout(() => drawOverlay(), 30);
      }

      // Native KLineChart drawing state
      let activeDrawTool = 'POINTER'; // 'POINTER' | overlay name
      let activePendingOverlayId = null;
      let selectedOverlayId = null;
      let overlayHistory = []; // overlay IDs in chronological creation order

      const TOOL_HINTS = {
        POINTER: '✛ Drag ENTRY / SL / TP handles or click drawings to adjust',
        segment: '╱ Tap start & end point to draw Trendline',
        rayLine: '↗ Tap anchor & direction point to draw Ray',
        horizontalStraightLine: '━ Tap chart to place Horizontal S/R Line',
        parallelStraightLine: '║ Tap 2 points for line, then 3rd for Channel width',
        fibonacciLine: '≡ Tap swing High & Low to draw Fibonacci Retracement',
      };

      function updateToolbarUI() {
        const drawTools = ['POINTER', 'segment', 'rayLine', 'horizontalStraightLine', 'parallelStraightLine', 'fibonacciLine'];
        drawTools.forEach((k) => {
          if (railBtns[k]) {
            railBtns[k].classList.toggle('active', activeDrawTool === k);
          }
        });
        if (railBtns.TPSL) {
          railBtns.TPSL.classList.toggle('active-green', !!state.showTpSlBox);
        }
        if (railBtns.MAGNET) {
          railBtns.MAGNET.classList.toggle('active-amber', !!state.magnet);
        }
        if (railBtns.DELETE_SEL) {
          railBtns.DELETE_SEL.classList.toggle('active-red', !!selectedOverlayId);
          railBtns.DELETE_SEL.classList.toggle('dimmed', !selectedOverlayId);
        }
        const count = overlayHistory.length;
        if (railBtns.UNDO) {
          railBtns.UNDO.classList.toggle('active-amber', count > 0);
          railBtns.UNDO.classList.toggle('dimmed', count === 0);
        }
        if (railBtns.CLEAR) {
          railBtns.CLEAR.classList.toggle('active-red', count > 0);
          railBtns.CLEAR.classList.toggle('dimmed', count === 0);
        }
        if (drawBadge) {
          drawBadge.textContent = String(count);
          drawBadge.style.display = count > 0 ? 'flex' : 'none';
        }
        hintPill.textContent = TOOL_HINTS[activeDrawTool] || TOOL_HINTS.POINTER;
      }

      function cancelPendingOverlay() {
        if (activePendingOverlayId) {
          const pendingId = activePendingOverlayId;
          activePendingOverlayId = null;
          try { chart.removeOverlay(pendingId); } catch (e) {}
          overlayHistory = overlayHistory.filter((id) => id !== pendingId);
        }
      }

      function startDrawingTool(toolName) {
        if (toolName === 'POINTER') {
          cancelPendingOverlay();
          activeDrawTool = 'POINTER';
          updateToolbarUI();
          return;
        }
        if (activeDrawTool === toolName && activePendingOverlayId) {
          cancelPendingOverlay();
          activeDrawTool = 'POINTER';
          updateToolbarUI();
          return;
        }
        cancelPendingOverlay();
        activeDrawTool = toolName;
        selectedOverlayId = null;

        const created = chart.createOverlay({
          name: toolName,
          groupId: 'user_drawings',
          mode: state.magnet ? 'weak_magnet' : 'normal',
          onDrawEnd: (ev) => {
            const doneId = ev && ev.overlay ? ev.overlay.id : null;
            if (doneId && overlayHistory.indexOf(doneId) === -1) {
              overlayHistory.push(doneId);
            }
            activePendingOverlayId = null;
            activeDrawTool = 'POINTER';
            updateToolbarUI();
            return false;
          },
          onSelected: (ev) => {
            selectedOverlayId = ev && ev.overlay ? ev.overlay.id : null;
            updateToolbarUI();
            return false;
          },
          onDeselected: () => {
            selectedOverlayId = null;
            updateToolbarUI();
            return false;
          },
          onRemoved: (ev) => {
            const rid = ev && ev.overlay ? ev.overlay.id : null;
            if (rid) {
              overlayHistory = overlayHistory.filter((id) => id !== rid);
              if (selectedOverlayId === rid) selectedOverlayId = null;
              if (activePendingOverlayId === rid) activePendingOverlayId = null;
              updateToolbarUI();
            }
            return false;
          },
        }, 'candle_pane');

        const createdId = Array.isArray(created) ? created[0] : created;
        if (createdId) {
          activePendingOverlayId = createdId;
          overlayHistory.push(createdId);
        }
        updateToolbarUI();
      }

      // Wire left vertical rail buttons
      railBtns.POINTER.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('POINTER'); });
      railBtns.segment.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('segment'); });
      railBtns.rayLine.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('rayLine'); });
      railBtns.horizontalStraightLine.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('horizontalStraightLine'); });
      railBtns.parallelStraightLine.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('parallelStraightLine'); });
      railBtns.fibonacciLine.addEventListener('click', (e) => { e.stopPropagation(); startDrawingTool('fibonacciLine'); });

      railBtns.TPSL.addEventListener('click', (e) => {
        e.stopPropagation();
        state.showTpSlBox = !state.showTpSlBox;
        sendToHost({ type: 'TPSL_TOGGLED', show: state.showTpSlBox });
        updateToolbarUI();
        drawOverlay();
      });

      railBtns.MAGNET.addEventListener('click', (e) => {
        e.stopPropagation();
        state.magnet = !state.magnet;
        updateToolbarUI();
        hintPill.textContent = state.magnet
          ? '🧲 Magnet Snap ON — drawings snap to candle OHLC'
          : '🧲 Magnet Snap OFF — freehand placement';
      });

      railBtns.DELETE_SEL.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!selectedOverlayId) return;
        const targetId = selectedOverlayId;
        selectedOverlayId = null;
        try { chart.removeOverlay(targetId); } catch (err) {}
        overlayHistory = overlayHistory.filter((id) => id !== targetId);
        updateToolbarUI();
      });

      function undoLastDrawing() {
        if (activePendingOverlayId) {
          cancelPendingOverlay();
          activeDrawTool = 'POINTER';
          updateToolbarUI();
          return;
        }
        if (overlayHistory.length > 0) {
          const lastId = overlayHistory.pop();
          if (selectedOverlayId === lastId) selectedOverlayId = null;
          try { chart.removeOverlay(lastId); } catch (err) {}
          updateToolbarUI();
        }
      }

      function clearAllDrawings() {
        activePendingOverlayId = null;
        selectedOverlayId = null;
        overlayHistory = [];
        activeDrawTool = 'POINTER';
        try { chart.removeOverlay(); } catch (err) {}
        updateToolbarUI();
      }

      railBtns.UNDO.addEventListener('click', (e) => {
        e.stopPropagation();
        undoLastDrawing();
      });

      railBtns.CLEAR.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllDrawings();
      });

      // Desktop keyboard shortcut: Delete / Backspace deletes selected drawing, Esc returns to Pointer
      window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedOverlayId) {
          const targetId = selectedOverlayId;
          selectedOverlayId = null;
          try { chart.removeOverlay(targetId); } catch (err) {}
          overlayHistory = overlayHistory.filter((id) => id !== targetId);
          updateToolbarUI();
        } else if (e.key === 'Escape') {
          startDrawingTool('POINTER');
        }
      });

      // Helper utilities for coordinate conversion & pill rendering
      function roundTick(p) {
        return Math.max(0.05, Math.round(p * 20) / 20);
      }

      function getCandleBounds() {
        const W = chartArea.clientWidth;
        const H = chartArea.clientHeight;
        let plotW = Math.max(100, W - 62);
        let plotH = Math.max(100, H - 26);
        try {
          const mainSize = chart.getSize('candle_pane', 'main');
          if (mainSize && mainSize.width > 40 && mainSize.height > 40) {
            plotW = mainSize.width;
            plotH = mainSize.height;
          }
        } catch (e) {}
        return { W, H, plotW, plotH };
      }

      function priceToY(price) {
        if (typeof price !== 'number' || !isFinite(price) || price <= 0) return null;
        try {
          const res = chart.convertToPixel({ value: price }, { paneId: 'candle_pane', absolute: false });
          const pt = Array.isArray(res) ? res[0] : res;
          if (pt && typeof pt.y === 'number' && isFinite(pt.y)) return pt.y;
        } catch (e) {}
        return null;
      }

      function yToPrice(y) {
        try {
          const res = chart.convertFromPixel([{ y }], { paneId: 'candle_pane', absolute: false });
          const pt = Array.isArray(res) ? res[0] : res;
          if (pt && typeof pt.value === 'number' && !isNaN(pt.value) && pt.value > 0) return pt.value;
        } catch (e) {}
        return null;
      }

      function drawRoundedRect(x, y, w, h, r) {
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
        } else {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }
      }

      function drawPill(x, y, text, bgColor, textColor, borderColor, options) {
        const opts = options || {};
        const isCompact = !!opts.compact;
        const align = opts.align || 'left';
        const minX = typeof opts.minX === 'number' ? opts.minX : 6;
        const maxX = typeof opts.maxX === 'number' ? opts.maxX : Math.max(80, getCandleBounds().plotW - 6);

        ctx.font = (isCompact ? 'bold 9.5px ' : 'bold 10px ') + '-apple-system, BlinkMacSystemFont, sans-serif';
        const padX = isCompact ? 5 : 7;
        const h = isCompact ? 17 : 18;
        const maxAllowedW = Math.max(44, maxX - minX);

        let displayText = text;
        let textW = ctx.measureText(displayText).width;
        if (textW + padX * 2 > maxAllowedW) {
          const ellipsis = '…';
          while (displayText.length > 4 && ctx.measureText(displayText + ellipsis).width + padX * 2 > maxAllowedW) {
            displayText = displayText.slice(0, -1);
          }
          displayText = displayText + ellipsis;
          textW = ctx.measureText(displayText).width;
        }

        const w = Math.min(maxAllowedW, textW + padX * 2);
        let drawX = align === 'right' ? (x - w) : x;
        drawX = Math.max(minX, Math.min(maxX - w, drawX));
        const top = y - h / 2;

        ctx.fillStyle = bgColor;
        drawRoundedRect(drawX, top, w, h, 4);
        ctx.fill();

        if (borderColor) {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.fillStyle = textColor || '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, drawX + padX, y + 0.5);
        return { x: drawX, y: top, w, h };
      }

      // Track last rendered pill hitboxes for crisp touch/mouse grabbing
      let renderedPills = {}; // { TP?: rect, ENTRY?: rect, SL?: rect }
      let draggingTarget = null; // { type: 'ENTRY' | 'SL' | 'TP' }

      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = chartArea.clientWidth * dpr;
        canvas.height = chartArea.clientHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawOverlay();
      }

      function drawOverlay() {
        const { W, H, plotW, plotH } = getCandleBounds();
        const isCompact = W <= 390;
        const pillRightEdge = plotW - 6;
        const baseAlpha = Math.max(0.15, Math.min(1.0, state.overlayOpacity || 1.0));

        ctx.clearRect(0, 0, W, H);
        renderedPills = {};

        // Clip overlay cleanly to the main candle_pane so lines never bleed into VOL/RSI sub-panes
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, plotW, plotH);
        ctx.clip();

        const isMarket = state.orderType === 'MARKET';
        const anchorPrice = getEffectiveEntryPrice();
        const yAnchor = priceToY(anchorPrice);
        const yEntry = isMarket ? null : priceToY(state.entry);
        const ySL = priceToY(state.sl);
        const yTP = priceToY(state.tp);

        const isBuy = state.side === 'BUY';
        const slInverted = state.sl > 0 && anchorPrice > 0 && (isBuy ? state.sl >= anchorPrice : state.sl <= anchorPrice);
        const tpInverted = state.tp > 0 && anchorPrice > 0 && (isBuy ? state.tp <= anchorPrice : state.tp >= anchorPrice);

        // 1. Shaded Long / Short Risk-Reward Zone (anchored to live LTP in MKT mode, or Entry in LIMIT mode)
        if (state.showTpSlBox && yAnchor !== null) {
          const boxLeft = Math.max(10, Math.round(plotW * (isCompact ? 0.14 : 0.24)));
          const boxWidth = Math.max(60, Math.min(plotW - boxLeft - 6, Math.round(plotW * 0.72)));
          const clampedAnchorY = Math.max(0, Math.min(plotH, yAnchor));

          ctx.save();
          ctx.globalAlpha = baseAlpha;
          if (yTP !== null) {
            const clampedTpY = Math.max(0, Math.min(plotH, yTP));
            const topY = Math.min(clampedAnchorY, clampedTpY);
            const boxH = Math.abs(clampedTpY - clampedAnchorY);
            if (boxH > 0) {
              ctx.fillStyle = tpInverted ? 'rgba(245, 158, 11, 0.16)' : 'rgba(16, 185, 129, 0.15)';
              ctx.fillRect(boxLeft, topY, boxWidth, boxH);
              ctx.strokeStyle = tpInverted ? 'rgba(245, 158, 11, 0.55)' : 'rgba(16, 185, 129, 0.45)';
              ctx.lineWidth = 1;
              ctx.strokeRect(boxLeft, topY, boxWidth, boxH);
            }
          }

          if (ySL !== null) {
            const clampedSlY = Math.max(0, Math.min(plotH, ySL));
            const topY = Math.min(clampedAnchorY, clampedSlY);
            const boxH = Math.abs(clampedSlY - clampedAnchorY);
            if (boxH > 0) {
              ctx.fillStyle = slInverted ? 'rgba(245, 158, 11, 0.16)' : 'rgba(239, 68, 68, 0.16)';
              ctx.fillRect(boxLeft, topY, boxWidth, boxH);
              ctx.strokeStyle = slInverted ? 'rgba(245, 158, 11, 0.55)' : 'rgba(239, 68, 68, 0.45)';
              ctx.lineWidth = 1;
              ctx.strokeRect(boxLeft, topY, boxWidth, boxH);
            }
          }
          ctx.restore();
        }

        // 2. Active Open Position Line on Chart
        if (state.activePosition && state.activePosition.avgPrice > 0) {
          const yPos = priceToY(state.activePosition.avgPrice);
          if (yPos !== null && yPos >= 4 && yPos <= plotH - 4) {
            ctx.save();
            ctx.strokeStyle = '#F59E0B';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(plotW, yPos);
            ctx.stroke();
            ctx.restore();

            const sideLbl = state.activePosition.netQty > 0 ? 'LONG' : 'SHORT';
            const pnlStr = (state.activePosition.pnl >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(state.activePosition.pnl));
            drawPill(
              6,
              yPos,
              '⚡ ' + sideLbl + ' ' + Math.abs(state.activePosition.netQty) + ' @ ₹' + state.activePosition.avgPrice.toFixed(1) + ' (' + pnlStr + ')',
              '#F59E0B',
              '#0F172A',
              '#FEF08A',
              { compact: isCompact, align: 'left', minX: 6, maxX: pillRightEdge }
            );
          }
        }

        // 3. Draggable TP, ENTRY (hidden in MARKET mode), SL Lines & Interactive Handles
        const slPts = state.sl > 0 && !slInverted ? Math.abs(anchorPrice - state.sl) : 0;
        const tpPts = state.tp > 0 && !tpInverted ? Math.abs(state.tp - anchorPrice) : 0;
        const riskRs = Math.round(slPts * state.totalQty);
        const rewardRs = Math.round(tpPts * state.totalQty);
        const rrStr = slPts > 0 && tpPts > 0 ? (tpPts / slPts).toFixed(2) : '-';

        const pillOpts = {
          compact: isCompact,
          align: 'right',
          minX: 6,
          maxX: pillRightEdge,
        };

        const renderTP = () => {
          if (yTP === null || yTP < 2 || yTP > plotH - 2) return;
          const isDragging = draggingTarget && draggingTarget.type === 'TP';
          ctx.save();
          ctx.globalAlpha = isDragging ? Math.max(0.9, baseAlpha) : baseAlpha;
          ctx.strokeStyle = tpInverted ? '#F59E0B' : '#10B981';
          ctx.lineWidth = isDragging ? 3 : 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, yTP);
          ctx.lineTo(plotW, yTP);
          ctx.stroke();
          ctx.setLineDash([]);

          let tpLabel;
          if (tpInverted) {
            const cmp = isBuy ? (state.tp < anchorPrice ? '<' : '=') : (state.tp > anchorPrice ? '>' : '=');
            tpLabel = '☰ ⚠️ TP ' + cmp + (isMarket ? ' LTP ₹' : ' ENTRY ₹') + state.tp.toFixed(1);
          } else if (isCompact) {
            tpLabel = '☰ TP ₹' + state.tp.toFixed(1) + ' +₹' + rewardRs + (rrStr !== '-' ? ' (1:' + rrStr + ')' : '');
          } else {
            tpLabel = '☰ TP ₹' + state.tp.toFixed(1) + '  +₹' + rewardRs + ' (1:' + rrStr + ')';
          }

          renderedPills.TP = drawPill(
            pillRightEdge,
            yTP,
            tpLabel,
            tpInverted ? '#F59E0B' : '#10B981',
            tpInverted ? '#0F172A' : '#06281E',
            tpInverted ? '#FEF08A' : '#6EE7B7',
            pillOpts
          );
          ctx.restore();
        };

        const renderEntry = () => {
          if (isMarket || yEntry === null || yEntry < 2 || yEntry > plotH - 2) return;
          const isDragging = draggingTarget && draggingTarget.type === 'ENTRY';
          ctx.save();
          ctx.globalAlpha = isDragging ? Math.max(0.9, baseAlpha) : baseAlpha;
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = isDragging ? 3 : 2;
          ctx.beginPath();
          ctx.moveTo(0, yEntry);
          ctx.lineTo(plotW, yEntry);
          ctx.stroke();

          const entryLabel = '☰ ' + state.side + ' ENTRY ₹' + state.entry.toFixed(1);
          renderedPills.ENTRY = drawPill(
            pillRightEdge,
            yEntry,
            entryLabel,
            '#0284C7',
            '#FFFFFF',
            '#7DD3FC',
            pillOpts
          );
          ctx.restore();
        };

        const renderSL = () => {
          if (ySL === null || ySL < 2 || ySL > plotH - 2) return;
          const isDragging = draggingTarget && draggingTarget.type === 'SL';
          ctx.save();
          ctx.globalAlpha = isDragging ? Math.max(0.9, baseAlpha) : baseAlpha;
          ctx.strokeStyle = slInverted ? '#F59E0B' : '#EF4444';
          ctx.lineWidth = isDragging ? 3 : 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, ySL);
          ctx.lineTo(plotW, ySL);
          ctx.stroke();
          ctx.setLineDash([]);

          let slLabel;
          if (slInverted) {
            const cmp = isBuy ? (state.sl > anchorPrice ? '>' : '=') : (state.sl < anchorPrice ? '<' : '=');
            slLabel = '☰ ⚠️ SL ' + cmp + (isMarket ? ' LTP ₹' : ' ENTRY ₹') + state.sl.toFixed(1);
          } else {
            slLabel = '☰ SL ₹' + state.sl.toFixed(1) + (isCompact ? ' -₹' : '  -₹') + riskRs;
          }

          renderedPills.SL = drawPill(
            pillRightEdge,
            ySL,
            slLabel,
            slInverted ? '#F59E0B' : '#DC2626',
            slInverted ? '#0F172A' : '#FFFFFF',
            slInverted ? '#FEF08A' : '#FCA5A5',
            pillOpts
          );
          ctx.restore();
        };

        const activeDragType = draggingTarget ? draggingTarget.type : null;
        const drawOrder = isMarket ? ['TP', 'SL'] : ['TP', 'ENTRY', 'SL'];
        if (activeDragType && drawOrder.indexOf(activeDragType) !== -1) {
          drawOrder.splice(drawOrder.indexOf(activeDragType), 1);
          drawOrder.push(activeDragType);
        }
        drawOrder.forEach((key) => {
          if (key === 'TP') renderTP();
          else if (key === 'ENTRY') renderEntry();
          else if (key === 'SL') renderSL();
        });

        ctx.restore();
      }

      // Access KLineChart v9's candle_pane Y-axis for true 2-axis (X + Y) panning & mobile Y-scale
      let autoYEnabled = true;

      function getCandleYAxis() {
        try {
          const pane =
            typeof chart.getDrawPaneById === 'function'
              ? chart.getDrawPaneById('candle_pane')
              : null;
          return pane && typeof pane.getAxisComponent === 'function'
            ? pane.getAxisComponent()
            : null;
        } catch (e) {
          return null;
        }
      }

      function setAutoYIndicator(isAuto) {
        autoYEnabled = !!isAuto;
        if (btnAutoY) {
          btnAutoY.textContent = autoYEnabled ? 'Auto Y' : 'Free Y';
          btnAutoY.classList.toggle('manual', !autoYEnabled);
        }
      }

      function applyYAxisRange(yAxis, newFrom, newTo) {
        if (!yAxis || !isFinite(newFrom) || !isFinite(newTo) || newTo <= newFrom) return;
        const newRealFrom =
          typeof yAxis.convertToRealValue === 'function'
            ? yAxis.convertToRealValue(newFrom)
            : newFrom;
        const newRealTo =
          typeof yAxis.convertToRealValue === 'function'
            ? yAxis.convertToRealValue(newTo)
            : newTo;
        yAxis.setRange({
          from: newFrom,
          to: newTo,
          range: newTo - newFrom,
          realFrom: newRealFrom,
          realTo: newRealTo,
          realRange: newRealTo - newRealFrom,
        });
        if (typeof chart.adjustPaneViewport === 'function') {
          chart.adjustPaneViewport(false, true, true, true);
        }
        setAutoYIndicator(false);
        drawOverlay();
      }

      function lockAutoYAxis() {
        try {
          const yAxis = getCandleYAxis();
          if (yAxis && typeof yAxis.setAutoCalcTickFlag === 'function') {
            yAxis.setAutoCalcTickFlag(true);
          }
          if (typeof chart.adjustPaneViewport === 'function') {
            chart.adjustPaneViewport(false, true, true, true);
          }
        } catch (e) {}
        setAutoYIndicator(true);
        drawOverlay();
      }

      // Hit-test STRICTLY inside rendered TP / ENTRY / SL pill handle boxes (never full-width!)
      // Touching anywhere else on candles passes straight through to 2-axis chart panning/zooming.
      function hitTestOrderHandle(xClick, yClick) {
        const { plotW, plotH } = getCandleBounds();
        if (xClick > plotW || yClick < 0 || yClick > plotH) return null;

        const isMarket = state.orderType === 'MARKET';
        const PAD_X = 8;
        const PAD_Y = 10;
        const keys = isMarket ? ['TP', 'SL'] : ['TP', 'SL', 'ENTRY'];
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const rect = renderedPills[k];
          if (
            rect &&
            xClick >= rect.x - PAD_X &&
            xClick <= rect.x + rect.w + PAD_X &&
            yClick >= rect.y - PAD_Y &&
            yClick <= rect.y + rect.h + PAD_Y
          ) {
            return { type: k };
          }
        }
        return null;
      }

      function getCoords(e) {
        const rect = chartArea.getBoundingClientRect();
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
      }

      let yAxisScaleState = null; // { startY, startRange }
      let verticalPanState = null; // { startX, startY, startRange, isTouch, unlocked }

      function onPointerDown(e) {
        if (
          e.target &&
          e.target.closest &&
          (e.target.closest('.quick-order-bar') || e.target.closest('.floating-axis-controls'))
        ) {
          return;
        }
        // Let 2-finger pinch zoom pass 100% natively to KLineChart
        if (e.touches && e.touches.length >= 2) {
          draggingTarget = null;
          yAxisScaleState = null;
          verticalPanState = null;
          return;
        }
        // Let KLineChart handle 100% of clicks while actively placing a drawing tool
        if (activeDrawTool !== 'POINTER') return;

        const pos = getCoords(e);
        const { plotW, plotH } = getCandleBounds();

        // 1. Direct pill-box hit -> drag Entry / SL / TP handle
        const hit = hitTestOrderHandle(pos.x, pos.y);
        if (hit) {
          draggingTarget = hit;
          yAxisScaleState = null;
          verticalPanState = null;
          try {
            chart.setScrollEnabled(false);
            chart.setZoomEnabled(false);
          } catch (err) {}
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          drawOverlay();
          return;
        }

        // 2. Right price axis drag -> smooth Y-axis scale/zoom on BOTH mobile touch & desktop mouse
        if (pos.x > plotW && pos.y >= 0 && pos.y <= plotH) {
          const yAxis = getCandleYAxis();
          const curRange = yAxis && typeof yAxis.getRange === 'function' ? yAxis.getRange() : null;
          if (curRange && curRange.range > 0) {
            yAxisScaleState = {
              startY: pos.y,
              startRange: { from: curRange.from, to: curRange.to, range: curRange.range },
            };
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        // 3. Candle area drag -> smooth 2-axis (X + Y) pan (does NOT block KLineChart's X pan!)
        if (pos.x <= plotW && pos.y >= 0 && pos.y <= plotH && !selectedOverlayId) {
          const yAxis = getCandleYAxis();
          const curRange = yAxis && typeof yAxis.getRange === 'function' ? yAxis.getRange() : null;
          if (curRange && curRange.range > 0) {
            verticalPanState = {
              startX: pos.x,
              startY: pos.y,
              startRange: { from: curRange.from, to: curRange.to, range: curRange.range },
              isTouch: !!(e.touches && e.touches.length > 0),
              unlocked: !autoYEnabled,
            };
          }
        }
      }

      function onPointerMove(e) {
        if (e.touches && e.touches.length >= 2) {
          yAxisScaleState = null;
          verticalPanState = null;
          return;
        }

        const pos = getCoords(e);

        // A. Active TP / ENTRY / SL pill handle drag
        if (draggingTarget) {
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          const price = yToPrice(pos.y);
          if (!price) return;
          const snapped = roundTick(price);

          if (draggingTarget.type === 'ENTRY') state.entry = snapped;
          else if (draggingTarget.type === 'SL') state.sl = snapped;
          else if (draggingTarget.type === 'TP') state.tp = snapped;

          updateQuickOrderButtons();
          drawOverlay();
          return;
        }

        // B. Right Y-axis vertical zoom/scale drag (works smoothly on mobile touch & mouse)
        if (yAxisScaleState) {
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          const yAxis = getCandleYAxis();
          if (yAxis) {
            const dy = pos.y - yAxisScaleState.startY;
            const scale = Math.max(0.15, Math.min(8.0, Math.exp(dy * 0.008)));
            const sr = yAxisScaleState.startRange;
            const newRange = sr.range * scale;
            const halfDiff = (newRange - sr.range) / 2;
            applyYAxisRange(yAxis, sr.from - halfDiff, sr.to + halfDiff);
          }
          return;
        }

        // C. Candle area vertical pan alongside native X-axis scroll (2-axis pan!)
        if (verticalPanState) {
          const dy = pos.y - verticalPanState.startY;
          if (!verticalPanState.unlocked && Math.abs(dy) >= 6) {
            verticalPanState.unlocked = true;
          }
          if (verticalPanState.unlocked) {
            if (verticalPanState.isTouch && e.cancelable) {
              e.preventDefault();
            }
            const yAxis = getCandleYAxis();
            const { plotH } = getCandleBounds();
            if (yAxis) {
              const sr = verticalPanState.startRange;
              const difRange = sr.range * (dy / Math.max(80, plotH));
              applyYAxisRange(yAxis, sr.from + difRange, sr.to + difRange);
            }
          }
          return;
        }

        // Hover cursor feedback on desktop
        if (activeDrawTool === 'POINTER') {
          const { plotW, plotH } = getCandleBounds();
          if (pos.x > plotW && pos.y >= 0 && pos.y <= plotH) {
            klineContainer.style.cursor = 'ns-resize';
          } else {
            const hit = hitTestOrderHandle(pos.x, pos.y);
            klineContainer.style.cursor = hit ? 'ns-resize' : 'grab';
          }
        } else {
          klineContainer.style.cursor = 'crosshair';
        }
      }

      function onPointerUp() {
        yAxisScaleState = null;
        verticalPanState = null;
        if (!draggingTarget) return;
        const finished = draggingTarget;
        draggingTarget = null;
        try {
          chart.setScrollEnabled(true);
          chart.setZoomEnabled(true);
        } catch (err) {}

        if (finished.type === 'ENTRY') sendToHost({ type: 'LEVEL_DRAGGED', line: 'ENTRY', price: state.entry });
        else if (finished.type === 'SL') sendToHost({ type: 'LEVEL_DRAGGED', line: 'SL', price: state.sl });
        else if (finished.type === 'TP') sendToHost({ type: 'LEVEL_DRAGGED', line: 'TP', price: state.tp });

        drawOverlay();
      }

      // Capture phase on chartArea so pill drags & Y-axis scaling work cleanly without breaking X pan/pinch
      chartArea.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('mousemove', onPointerMove, true);
      window.addEventListener('mouseup', onPointerUp, true);

      chartArea.addEventListener('touchstart', onPointerDown, { passive: false, capture: true });
      window.addEventListener('touchmove', onPointerMove, { passive: false, capture: true });
      window.addEventListener('touchend', onPointerUp, true);
      window.addEventListener('touchcancel', onPointerUp, true);

      // Quick Buy / Sell / Exit buttons directly on chart
      btnQuickBuy.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_ORDER', side: 'BUY', price: getEffectiveEntryPrice() });
      });
      btnQuickSell.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_ORDER', side: 'SELL', price: getEffectiveEntryPrice() });
      });
      btnQuickExit.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_EXIT' });
      });

      // Keep overlay canvas synced smoothly when KLineChart scrolls, zooms, or resizes panes
      try {
        chart.subscribeAction('onScroll', () => drawOverlay());
        chart.subscribeAction('onZoom', () => drawOverlay());
        chart.subscribeAction('onVisibleRangeChange', () => drawOverlay());
        chart.subscribeAction('onPaneDrag', () => drawOverlay());
      } catch (e) {}
      setInterval(() => drawOverlay(), 200);

      function getTimeframeMs(tf) {
        const map = {
          '1m': 60 * 1000,
          '3m': 3 * 60 * 1000,
          '5m': 5 * 60 * 1000,
          '15m': 15 * 60 * 1000,
          '30m': 30 * 60 * 1000,
          '1H': 60 * 60 * 1000,
          '4H': 4 * 60 * 60 * 1000,
          '1D': 24 * 60 * 60 * 1000,
          '1W': 7 * 24 * 60 * 60 * 1000,
        };
        return map[tf] || 5 * 60 * 1000;
      }

      let ltpFlashTimer = null;
      function applyLiveTick(price, volume, timestamp) {
        if (typeof price !== 'number' || !isFinite(price) || price <= 0) return;

        const prevLtp = state.lastLtp;
        state.lastLtp = price;
        state.livePrice = price;
        if (state.orderType === 'MARKET') {
          updateQuickOrderButtons();
        }
        ltpHeader.textContent = '₹' + price.toFixed(2);
        ltpHeader.classList.remove('ltp-up', 'ltp-down');
        if (price > prevLtp) ltpHeader.classList.add('ltp-up');
        else if (price < prevLtp) ltpHeader.classList.add('ltp-down');
        if (ltpFlashTimer) clearTimeout(ltpFlashTimer);
        ltpFlashTimer = setTimeout(() => {
          ltpHeader.classList.remove('ltp-up', 'ltp-down');
        }, 500);

        const tfMs = getTimeframeMs(state.timeframe);
        const rawTs = typeof timestamp === 'number' && timestamp > 0 ? timestamp : Date.now();
        const tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
        const weekOffsetMs = 4 * 24 * 60 * 60 * 1000; // Align 1W bars to Monday
        const bucketTs =
          state.timeframe === '1W'
            ? Math.floor((tsMs - weekOffsetMs) / tfMs) * tfMs + weekOffsetMs
            : Math.floor(tsMs / tfMs) * tfMs;
        const volAdd = typeof volume === 'number' && volume > 0 ? volume : 1;

        const lastBar = klineBars.length > 0 ? klineBars[klineBars.length - 1] : null;
        if (!lastBar) {
          const firstBar = { timestamp: bucketTs, open: price, high: price, low: price, close: price, volume: volAdd };
          klineBars.push(firstBar);
          chart.applyNewData(klineBars);
        } else if (bucketTs > lastBar.timestamp) {
          const openPrice = lastBar.close;
          const newBar = {
            timestamp: bucketTs,
            open: openPrice,
            high: Math.max(openPrice, price),
            low: Math.min(openPrice, price),
            close: price,
            volume: volAdd,
          };
          klineBars.push(newBar);
          chart.updateData(newBar);
        } else {
          lastBar.close = price;
          if (price > lastBar.high) lastBar.high = price;
          if (price < lastBar.low) lastBar.low = price;
          lastBar.volume = (lastBar.volume || 0) + volAdd;
          chart.updateData({
            timestamp: lastBar.timestamp,
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
          });
        }
        drawOverlay();
      }

      function resetChartView() {
        try {
          const yAxis = getCandleYAxis();
          if (yAxis && typeof yAxis.setAutoCalcTickFlag === 'function') {
            yAxis.setAutoCalcTickFlag(true);
          }
          chart.setBarSpace(9);
          chart.setOffsetRightDistance(56);
          chart.setPriceVolumePrecision(2, 0);
          chart.setPaneOptions({
            id: 'candle_pane',
            gap: { top: 0.2, bottom: 0.1 },
            axisOptions: { name: 'default', scrollZoomEnabled: true },
          });
          chart.scrollToRealTime(150);
          if (typeof chart.adjustPaneViewport === 'function') {
            chart.adjustPaneViewport(false, true, true, true);
          }
          chart.resize();
        } catch (err) {}
        setAutoYIndicator(true);
        hintPill.textContent = '⟲ Chart zoom & Auto-Y reset to live candles';
        drawOverlay();
        setTimeout(() => drawOverlay(), 180);
      }

      if (btnAutoY) {
        btnAutoY.addEventListener('click', (e) => {
          e.stopPropagation();
          lockAutoYAxis();
          hintPill.textContent = 'Auto Y-Axis re-locked to visible candles';
        });
      }

      if (btnResetChart) {
        btnResetChart.addEventListener('click', (e) => {
          e.stopPropagation();
          resetChartView();
        });
      }

      // Receive state & live tick updates from React Native host without reloading
      window.handleHostMessage = function(raw) {
        try {
          const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!data || !data.type) return;

          if (data.type === 'SYNC_STATE') {
            if (!draggingTarget) {
              if (data.side) state.side = data.side;
              if (data.orderType) state.orderType = data.orderType;
              if (typeof data.entry === 'number') state.entry = data.entry;
              if (typeof data.sl === 'number') state.sl = data.sl;
              if (typeof data.tp === 'number') state.tp = data.tp;
            }
            if (typeof data.totalQty === 'number') state.totalQty = data.totalQty;
            if (typeof data.showTpSlBox === 'boolean') state.showTpSlBox = data.showTpSlBox;
            if (typeof data.overlayOpacity === 'number') state.overlayOpacity = data.overlayOpacity;
            if (typeof data.timeframe === 'string') state.timeframe = data.timeframe;
            if (data.activeLineType) state.activeLineType = data.activeLineType;
            state.activePosition = data.activePosition || null;

            btnQuickExit.style.display = state.activePosition ? 'inline-block' : 'none';
            updateQuickOrderButtons();

            if (data.indicators) syncIndicators(data.indicators);
            updateToolbarUI();
            drawOverlay();
          } else if (data.type === 'LIVE_TICK') {
            applyLiveTick(data.price, data.volume, data.timestamp);
          } else if (data.type === 'RESET_CHART') {
            resetChartView();
          } else if (data.type === 'UNDO_DRAWING') {
            undoLastDrawing();
          } else if (data.type === 'CLEAR_DRAWINGS') {
            clearAllDrawings();
          }
        } catch (err) {}
      };

      window.addEventListener('message', (e) => window.handleHostMessage(e.data));

      window.addEventListener('resize', () => {
        try { chart.resize(); } catch (e) {}
        resizeCanvas();
      });

      updateQuickOrderButtons();
      updateToolbarUI();
      resizeCanvas();
      sendToHost({ type: 'CHART_READY' });
    </script>
  </body>
</html>`;
  }, [candles, symbol]);

  // Process incoming messages from chart (drags, quick buy/sell, exits, ready)
  const processChartEvent = useCallback(
    (raw: any) => {
      try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!data || !data.type) return;

        if (data.type === 'CHART_READY') {
          syncStateToChart();
        } else if (data.type === 'TPSL_TOGGLED' && typeof data.show === 'boolean') {
          setShowTpSlBox(data.show);
        } else if (data.type === 'LEVEL_DRAGGED') {
          if (onLevelChange) {
            onLevelChange(data.line, data.price);
          } else if (onPriceSelected) {
            onPriceSelected(data.price);
          }
        } else if (data.type === 'QUICK_ORDER' && onQuickOrder) {
          onQuickOrder(data.side, data.price);
        } else if (data.type === 'QUICK_EXIT' && activePosition && onQuickExitPosition) {
          onQuickExitPosition(activePosition);
        }
      } catch {}
    },
    [
      syncStateToChart,
      onLevelChange,
      onPriceSelected,
      onQuickOrder,
      activePosition,
      onQuickExitPosition,
    ]
  );

  // Listen for web iframe messages
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const handleWebMessage = (event: MessageEvent) => {
        processChartEvent(event.data);
      };
      window.addEventListener('message', handleWebMessage);
      return () => window.removeEventListener('message', handleWebMessage);
    }
  }, [processChartEvent]);

  const handleWebViewMessage = (event: any) => {
    processChartEvent(event.nativeEvent.data);
  };

  return (
    <View style={styles.container}>
      {/* Row 1: Scrollable Multi-Timeframes (1m..1W) + Reset + Opacity Control */}
      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tfScroll}
          contentContainerStyle={styles.tfGroup}
        >
          {['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W'].map((tf) => (
            <TouchableOpacity
              key={tf}
              style={[styles.tfBtn, timeframe === tf && styles.tfBtnActive]}
              onPress={() => onSelectTimeframe && onSelectTimeframe(tf)}
            >
              <Text
                style={[
                  styles.tfBtnText,
                  timeframe === tf && styles.tfBtnTextActive,
                ]}
              >
                {tf}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.rightControls}>
          <TouchableOpacity
            style={styles.resetChip}
            onPress={handleResetChart}
          >
            <Text style={styles.resetChipText}>⟲ Auto</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.opacityChip,
              overlayOpacity < 1 && styles.opacityChipDimmed,
            ]}
            onPress={handleCycleOpacity}
          >
            <Text style={styles.opacityChipText}>
              👁️ {Math.round(overlayOpacity * 100)}%
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.boxChip, showTpSlBox && styles.boxChipActive]}
            onPress={() => setShowTpSlBox((v) => !v)}
          >
            <Text
              style={[
                styles.boxChipText,
                showTpSlBox && { color: '#34D399' },
              ]}
            >
              📐 {showTpSlBox ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: Native KLineChart Technical Indicators Bar (Main & Sub-Panes) */}
      <View style={styles.indicatorBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.indicatorBarContent}
        >
          <TouchableOpacity
            style={[styles.indChip, showEMA9 && styles.indChipActiveEMA]}
            onPress={onToggleEMA9}
          >
            <Text style={[styles.indChipText, showEMA9 && { color: '#06B6D4' }]}>
              EMA 9/21
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.indChip, showVWAP && styles.indChipActiveVWAP]}
            onPress={onToggleVWAP}
          >
            <Text style={[styles.indChipText, showVWAP && { color: '#F59E0B' }]}>
              VWAP
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.indChip, showBOLL && styles.indChipActiveBOLL]}
            onPress={() => setShowBOLL((v) => !v)}
          >
            <Text style={[styles.indChipText, showBOLL && { color: '#A855F7' }]}>
              BOLL
            </Text>
          </TouchableOpacity>

          <View style={styles.indDivider} />

          <TouchableOpacity
            style={[styles.indChip, showVOL && styles.indChipActiveVOL]}
            onPress={() => setShowVOL((v) => !v)}
          >
            <Text style={[styles.indChipText, showVOL && { color: '#34D399' }]}>
              VOL
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.indChip, showRSI && styles.indChipActiveRSI]}
            onPress={() => setShowRSI((v) => !v)}
          >
            <Text style={[styles.indChipText, showRSI && { color: '#F472B6' }]}>
              RSI
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Main KLineChart v9 + Left Drawing Rail + Draggable Order Overlay */}
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          srcDoc={chartHtml}
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            border: 'none',
            backgroundColor: '#0F172A',
          } as any}
        />
      ) : (
        <WebViewComponent
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: chartHtml }}
          style={styles.webview}
          onMessage={handleWebViewMessage}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      )}

      {/* Legend & Quick Level Bar (Strict fixed height to prevent vertical layout wobble) */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          {orderType === 'MARKET' ? (
            <Text
              numberOfLines={1}
              style={[styles.legendText, { color: '#FBBF24' }]}
            >
              MKT @ ₹{entryPrice.toFixed(1)}
            </Text>
          ) : (
            <>
              <View style={[styles.dot, { backgroundColor: '#38BDF8' }]} />
              <Text numberOfLines={1} style={styles.legendText}>
                Entry: ₹{entryPrice.toFixed(1)}
              </Text>
            </>
          )}
        </View>
        {stopLossPrice && stopLossPrice > 0 ? (
          <View style={styles.legendItem}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isSlInverted ? '#F59E0B' : '#EF4444' },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.legendText,
                { color: isSlInverted ? '#FBBF24' : '#F87171' },
              ]}
            >
              {isSlInverted
                ? `⚠️ SL ${transactionType === 'BUY' ? (stopLossPrice > entryPrice ? '>' : '=') : (stopLossPrice < entryPrice ? '<' : '=')} ENTRY`
                : `SL: ₹${stopLossPrice.toFixed(1)} (-₹${Math.round(slRiskRupees)})`}
            </Text>
          </View>
        ) : null}
        {targetPrice && targetPrice > 0 ? (
          <View style={styles.legendItem}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isTpInverted ? '#F59E0B' : '#10B981' },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.legendText,
                { color: isTpInverted ? '#FBBF24' : '#34D399' },
              ]}
            >
              {isTpInverted
                ? `⚠️ TP ${transactionType === 'BUY' ? (targetPrice < entryPrice ? '<' : '=') : (targetPrice > entryPrice ? '>' : '=')} ENTRY`
                : `TP: ₹${targetPrice.toFixed(1)} (+₹${Math.round(tpRewardRupees)}${rrRatio !== '-' ? ` | 1:${rrRatio}` : ''})`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tfScroll: {
    flex: 1,
    minWidth: 0,
  },
  tfGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 4,
  },
  tfBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#0F172A',
  },
  tfBtnActive: {
    backgroundColor: '#38BDF8',
  },
  tfBtnText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  tfBtnTextActive: {
    color: '#0F172A',
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resetChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#475569',
  },
  resetChipText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700',
  },
  opacityChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  opacityChipDimmed: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
  },
  opacityChipText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
  },
  boxChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  boxChipActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
  },
  boxChipText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  indicatorBarWrap: {
    backgroundColor: '#0B1120',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    flexGrow: 0,
  },
  indicatorBarContent: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  indDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#334155',
    marginHorizontal: 2,
  },
  indChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  indChipActiveVWAP: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  indChipActiveEMA: {
    borderColor: '#06B6D4',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
  },
  indChipActiveBOLL: {
    borderColor: '#A855F7',
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
  },
  indChipActiveVOL: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  indChipActiveRSI: {
    borderColor: '#F472B6',
    backgroundColor: 'rgba(244, 114, 182, 0.15)',
  },
  indChipText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 28,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
    paddingHorizontal: 6,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  legendText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
