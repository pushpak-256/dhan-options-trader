import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { CandleData, TransactionType, DhanPosition } from '../types/dhan';
import { calculateVWAP, calculateEMA } from '../utils/indicators';

export type DrawingTool = 'DRAG' | 'TPSL' | 'HLINE' | 'TRENDLINE';

interface InteractiveChartProps {
  candles: CandleData[];
  symbol: string;
  transactionType: TransactionType;
  entryPrice: number;
  stopLossPrice?: number;
  targetPrice?: number;
  lotSize: number;
  lots: number;
  activePosition?: DhanPosition | null;
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

export const InteractiveChart: React.FC<InteractiveChartProps> = ({
  candles,
  symbol,
  transactionType,
  entryPrice,
  stopLossPrice,
  targetPrice,
  lotSize,
  lots,
  activePosition,
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

  const [activeTool, setActiveTool] = useState<DrawingTool>('DRAG');
  const [showTpSlBox, setShowTpSlBox] = useState<boolean>(true);
  const [drawingCount, setDrawingCount] = useState<number>(0);

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
      entry: entryPrice,
      sl: stopLossPrice || 0,
      tp: targetPrice || 0,
      totalQty,
      showTpSlBox,
      tool: activeTool,
      activeLineType,
      activePosition: activePosition && activePosition.netQty !== 0
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
    entryPrice,
    stopLossPrice,
    targetPrice,
    totalQty,
    showTpSlBox,
    activeTool,
    activeLineType,
    activePosition,
  ]);

  // Sync dynamic state (Entry, SL, TP, side, qty, tool, active position) smoothly to chart
  useEffect(() => {
    syncStateToChart();
  }, [syncStateToChart]);

  const handleUndoDrawing = () => {
    postToChart({ type: 'UNDO_DRAWING' });
  };

  const handleClearDrawings = () => {
    postToChart({ type: 'CLEAR_DRAWINGS' });
    setDrawingCount(0);
    setActiveTool('DRAG');
  };

  // Build HTML only when candles/symbol/indicators change (never on drag!)
  const chartHtml = useMemo(() => {
    const vwapData = showVWAP ? calculateVWAP(candles) : [];
    const ema9Data = showEMA9 ? calculateEMA(candles, 9) : [];
    const initialEntry = candles.length > 0 ? candles[candles.length - 1].close : entryPrice;
    const safeSymbol = String(symbol)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const safeJson = (val: unknown) => JSON.stringify(val).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
      body, html { width: 100%; height: 100%; background-color: #0F172A; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      #wrapper { width: 100%; height: 100%; position: relative; }
      #chartContainer { width: 100%; height: 100%; position: absolute; inset: 0; }
      #overlayCanvas { width: 100%; height: 100%; position: absolute; inset: 0; z-index: 15; pointer-events: none; }
      #interactionLayer { width: 100%; height: 100%; position: absolute; inset: 0; z-index: 16; pointer-events: none; }
      .chart-header {
        position: absolute;
        top: 6px;
        left: 8px;
        z-index: 25;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.85);
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.08);
        pointer-events: none;
        max-width: calc(100% - 230px);
        overflow: hidden;
        white-space: nowrap;
      }
      .symbol-text { color: #F8FAFC; font-weight: 700; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
      .ltp-text { color: #38BDF8; font-weight: 700; font-size: 11px; flex-shrink: 0; }
      .vwap-indicator { color: #F59E0B; font-size: 9px; font-weight: 700; flex-shrink: 0; }
      .ema-indicator { color: #06B6D4; font-size: 9px; font-weight: 700; flex-shrink: 0; }
      .quick-order-bar {
        position: absolute;
        top: 6px;
        right: 68px;
        z-index: 30;
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .qbtn {
        border: none;
        border-radius: 5px;
        padding: 4px 9px;
        font-size: 10px;
        font-weight: 800;
        color: #FFFFFF;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        letter-spacing: 0.3px;
        white-space: nowrap;
      }
      .qbtn:active { transform: scale(0.95); }
      .qbtn-buy { background: rgba(16, 185, 129, 0.92); border: 1px solid #34D399; }
      .qbtn-sell { background: rgba(239, 68, 68, 0.92); border: 1px solid #F87171; }
      .qbtn-exit { background: rgba(245, 158, 11, 0.95); color: #0F172A; border: 1px solid #FDE047; }
      .hint-pill {
        position: absolute;
        bottom: 32px;
        left: 8px;
        z-index: 25;
        background: rgba(15, 23, 42, 0.85);
        color: #94A3B8;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        pointer-events: none;
        max-width: calc(100% - 82px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 440px) {
        .chart-header {
          padding: 3px 6px;
          gap: 4px;
          max-width: calc(100% - 205px);
        }
        .symbol-text, .ltp-text { font-size: 10px; }
        .vwap-indicator, .ema-indicator { display: none; }
        .quick-order-bar { right: 64px; gap: 4px; }
        .qbtn { padding: 3px 6px; font-size: 9px; letter-spacing: 0.1px; }
        .hint-pill { font-size: 9px; padding: 2px 6px; bottom: 28px; }
      }
    </style>
  </head>
  <body>
    <div id="wrapper">
      <div id="chartContainer"></div>
      <canvas id="overlayCanvas"></canvas>

      <div class="chart-header">
        <span class="symbol-text">${safeSymbol}</span>
        <span class="ltp-text" id="ltpHeader">₹${initialEntry.toFixed(2)}</span>
        ${showVWAP ? '<span class="vwap-indicator">• VWAP</span>' : ''}
        ${showEMA9 ? '<span class="ema-indicator">• EMA 9</span>' : ''}
      </div>

      <div class="quick-order-bar">
        <button class="qbtn qbtn-buy" id="btnQuickBuy">BUY</button>
        <button class="qbtn qbtn-sell" id="btnQuickSell">SELL</button>
        <button class="qbtn qbtn-exit" id="btnQuickExit" style="display:none;">✕ EXIT</button>
      </div>

      <div class="hint-pill" id="hintPill">✋ Drag ENTRY / SL / TP handles directly on chart</div>
    </div>

    <script>
      const wrapper = document.getElementById('wrapper');
      const container = document.getElementById('chartContainer');
      const canvas = document.getElementById('overlayCanvas');
      const ctx = canvas.getContext('2d');
      const hintPill = document.getElementById('hintPill');
      const btnQuickBuy = document.getElementById('btnQuickBuy');
      const btnQuickSell = document.getElementById('btnQuickSell');
      const btnQuickExit = document.getElementById('btnQuickExit');

      function sendToHost(obj) {
        const msg = JSON.stringify(obj);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(msg);
        } else if (window.parent) {
          window.parent.postMessage(msg, '*');
        }
      }

      const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: {
          background: { color: '#0F172A' },
          textColor: '#94A3B8',
        },
        grid: {
          vertLines: { color: '#1E293B' },
          horzLines: { color: '#1E293B' },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: '#475569', width: 1, style: 1 },
          horzLine: { color: '#475569', width: 1, style: 1 },
        },
        timeScale: {
          borderColor: '#334155',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
        },
        rightPriceScale: {
          borderColor: '#334155',
          scaleMargins: { top: 0.16, bottom: 0.22 },
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10B981',
        downColor: '#EF4444',
        borderUpColor: '#10B981',
        borderDownColor: '#EF4444',
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
      });

      const rawCandles = ${safeJson(candles)};
      candleSeries.setData(rawCandles);

      ${
        showVWAP
          ? `
        const vwapSeries = chart.addLineSeries({
          color: '#F59E0B',
          lineWidth: 1.5,
          title: 'VWAP',
        });
        vwapSeries.setData(${safeJson(vwapData)});
      `
          : ''
      }

      ${
        showEMA9
          ? `
        const ema9Series = chart.addLineSeries({
          color: '#06B6D4',
          lineWidth: 1.5,
          title: 'EMA 9',
        });
        ema9Series.setData(${safeJson(ema9Data)});
      `
          : ''
      }

      // Mutable interactive state
      const state = {
        side: ${safeJson(transactionType)},
        entry: ${Number(entryPrice) || 0},
        sl: ${Number(stopLossPrice) || 0},
        tp: ${Number(targetPrice) || 0},
        totalQty: ${Number(totalQty) || 0},
        showTpSlBox: true,
        tool: 'DRAG',
        activeLineType: ${safeJson(activeLineType)},
        activePosition: null,
        hLines: [], // [{ id, price }]
        trendLines: [], // [{ id, p1: {time, price}, p2: {time, price} }]
        drawingHistory: [], // ['HLINE' | 'TRENDLINE']
        pendingTrendStart: null,
      };

      // Drag tracking
      let draggingTarget = null; // { type: 'ENTRY'|'SL'|'TP'|'HLINE', index?: number }
      let pointerPos = { x: 0, y: 0 };

      function roundTick(p) {
        return Math.max(0.05, Math.round(p * 20) / 20);
      }

      function getPlotWidth() {
        const W = container.clientWidth;
        let rightAxisW = 68;
        try {
          const psW = chart.priceScale('right').width();
          if (typeof psW === 'number' && psW > 30) {
            rightAxisW = Math.ceil(psW) + 4;
          }
        } catch (e) {}
        return Math.max(100, W - rightAxisW);
      }

      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawOverlay();
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

      function drawPill(x, y, text, bgColor, textColor = '#FFFFFF', borderColor = null, options = {}) {
        const isCompact = !!options.compact;
        const align = options.align || 'left';
        const minX = typeof options.minX === 'number' ? options.minX : 6;
        const maxX = typeof options.maxX === 'number' ? options.maxX : Math.max(80, getPlotWidth() - 6);

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

        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, drawX + padX, y + 0.5);
        return { x: drawX, y: top, w, h };
      }

      function drawOverlay() {
        const W = container.clientWidth;
        const H = container.clientHeight;
        const plotW = getPlotWidth();
        const isCompact = W <= 420;
        const pillRightEdge = plotW - 6;
        ctx.clearRect(0, 0, W, H);

        const yEntry = state.entry > 0 ? candleSeries.priceToCoordinate(state.entry) : null;
        const ySL = state.sl > 0 ? candleSeries.priceToCoordinate(state.sl) : null;
        const yTP = state.tp > 0 ? candleSeries.priceToCoordinate(state.tp) : null;

        const isBuy = state.side === 'BUY';
        const slInverted = state.sl > 0 && state.entry > 0 && (isBuy ? state.sl >= state.entry : state.sl <= state.entry);
        const tpInverted = state.tp > 0 && state.entry > 0 && (isBuy ? state.tp <= state.entry : state.tp >= state.entry);

        // 1. TradingView Long / Short Risk-Reward Shaded Box (TP/SL Tool)
        if (state.showTpSlBox && yEntry !== null) {
          const boxLeft = Math.max(10, Math.round(plotW * (isCompact ? 0.14 : 0.24)));
          const boxWidth = Math.max(60, Math.min(plotW - boxLeft - 6, Math.round(plotW * 0.72)));

          // Profit Zone (Entry -> TP)
          if (yTP !== null) {
            const topY = Math.min(yEntry, yTP);
            const boxH = Math.abs(yTP - yEntry);
            ctx.fillStyle = tpInverted ? 'rgba(245, 158, 11, 0.16)' : 'rgba(16, 185, 129, 0.14)';
            ctx.fillRect(boxLeft, topY, boxWidth, boxH);
            ctx.strokeStyle = tpInverted ? 'rgba(245, 158, 11, 0.55)' : 'rgba(16, 185, 129, 0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(boxLeft, topY, boxWidth, boxH);
          }

          // Risk Zone (Entry -> SL)
          if (ySL !== null) {
            const topY = Math.min(yEntry, ySL);
            const boxH = Math.abs(ySL - yEntry);
            ctx.fillStyle = slInverted ? 'rgba(245, 158, 11, 0.16)' : 'rgba(239, 68, 68, 0.15)';
            ctx.fillRect(boxLeft, topY, boxWidth, boxH);
            ctx.strokeStyle = slInverted ? 'rgba(245, 158, 11, 0.55)' : 'rgba(239, 68, 68, 0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(boxLeft, topY, boxWidth, boxH);
          }
        }

        // 2. Custom Horizontal Support/Resistance Lines
        state.hLines.forEach((hl) => {
          const y = candleSeries.priceToCoordinate(hl.price);
          if (y === null) return;
          ctx.save();
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.restore();
          drawPill(6, y, '━ SR ₹' + hl.price.toFixed(1), 'rgba(250, 204, 21, 0.9)', '#0F172A', null, {
            compact: isCompact,
            align: 'left',
            minX: 6,
            maxX: pillRightEdge,
          });
        });

        // 3. Custom Diagonal Trendlines
        state.trendLines.forEach((tl) => {
          const x1 = chart.timeScale().timeToCoordinate(tl.p1.time);
          const y1 = candleSeries.priceToCoordinate(tl.p1.price);
          const x2 = chart.timeScale().timeToCoordinate(tl.p2.time);
          const y2 = candleSeries.priceToCoordinate(tl.p2.price);
          if (x1 === null || y1 === null || x2 === null || y2 === null) return;

          ctx.save();
          ctx.strokeStyle = '#C084FC';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Anchor dots
          ctx.fillStyle = '#E879F9';
          ctx.beginPath();
          ctx.arc(x1, y1, 4, 0, Math.PI * 2);
          ctx.arc(x2, y2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // Pending trendline preview
        if (state.tool === 'TRENDLINE' && state.pendingTrendStart) {
          const x1 = chart.timeScale().timeToCoordinate(state.pendingTrendStart.time);
          const y1 = candleSeries.priceToCoordinate(state.pendingTrendStart.price);
          if (x1 !== null && y1 !== null) {
            ctx.save();
            ctx.strokeStyle = 'rgba(192, 132, 252, 0.75)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(pointerPos.x, pointerPos.y);
            ctx.stroke();
            ctx.fillStyle = '#E879F9';
            ctx.beginPath();
            ctx.arc(x1, y1, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        // 4. Active Open Position Line on Chart
        if (state.activePosition && state.activePosition.avgPrice > 0) {
          const yPos = candleSeries.priceToCoordinate(state.activePosition.avgPrice);
          if (yPos !== null) {
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
              null,
              {
                compact: isCompact,
                align: 'left',
                minX: 6,
                maxX: pillRightEdge,
              }
            );
          }
        }

        // 5. Draggable TP, ENTRY, SL Lines & Interactive Handles (draw dragged handle last for top z-order)
        const slPts = state.sl > 0 && !slInverted ? Math.abs(state.entry - state.sl) : 0;
        const tpPts = state.tp > 0 && !tpInverted ? Math.abs(state.tp - state.entry) : 0;
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
          if (yTP === null) return;
          ctx.save();
          ctx.strokeStyle = tpInverted ? '#F59E0B' : '#10B981';
          ctx.lineWidth = draggingTarget && draggingTarget.type === 'TP' ? 3 : 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, yTP);
          ctx.lineTo(plotW, yTP);
          ctx.stroke();
          ctx.restore();

          let tpLabel;
          if (tpInverted) {
            const cmp = isBuy ? (state.tp < state.entry ? '<' : '=') : (state.tp > state.entry ? '>' : '=');
            tpLabel = '☰ ⚠️ TP ' + cmp + ' ENTRY ₹' + state.tp.toFixed(1);
          } else if (isCompact) {
            tpLabel = '☰ TP ₹' + state.tp.toFixed(1) + ' +₹' + rewardRs + (rrStr !== '-' ? ' (1:' + rrStr + ')' : '');
          } else {
            tpLabel = '☰ TP ₹' + state.tp.toFixed(1) + '  +₹' + rewardRs + ' (1:' + rrStr + ')';
          }

          drawPill(
            pillRightEdge,
            yTP,
            tpLabel,
            tpInverted ? '#F59E0B' : '#10B981',
            tpInverted ? '#0F172A' : '#06281E',
            tpInverted ? '#FEF08A' : '#6EE7B7',
            pillOpts
          );
        };

        const renderEntry = () => {
          if (yEntry === null) return;
          ctx.save();
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = draggingTarget && draggingTarget.type === 'ENTRY' ? 3 : 2;
          ctx.beginPath();
          ctx.moveTo(0, yEntry);
          ctx.lineTo(plotW, yEntry);
          ctx.stroke();
          ctx.restore();

          const entryLabel = '☰ ' + state.side + ' ENTRY ₹' + state.entry.toFixed(1);
          drawPill(pillRightEdge, yEntry, entryLabel, '#0284C7', '#FFFFFF', '#7DD3FC', pillOpts);
        };

        const renderSL = () => {
          if (ySL === null) return;
          ctx.save();
          ctx.strokeStyle = slInverted ? '#F59E0B' : '#EF4444';
          ctx.lineWidth = draggingTarget && draggingTarget.type === 'SL' ? 3 : 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, ySL);
          ctx.lineTo(plotW, ySL);
          ctx.stroke();
          ctx.restore();

          let slLabel;
          if (slInverted) {
            const cmp = isBuy ? (state.sl > state.entry ? '>' : '=') : (state.sl < state.entry ? '<' : '=');
            slLabel = '☰ ⚠️ SL ' + cmp + ' ENTRY ₹' + state.sl.toFixed(1);
          } else {
            slLabel = '☰ SL ₹' + state.sl.toFixed(1) + (isCompact ? ' -₹' : '  -₹') + riskRs;
          }

          drawPill(
            pillRightEdge,
            ySL,
            slLabel,
            slInverted ? '#F59E0B' : '#DC2626',
            slInverted ? '#0F172A' : '#FFFFFF',
            slInverted ? '#FEF08A' : '#FCA5A5',
            pillOpts
          );
        };

        const activeDragType = draggingTarget ? draggingTarget.type : null;
        const drawOrder = ['TP', 'ENTRY', 'SL'];
        if (activeDragType && drawOrder.indexOf(activeDragType) !== -1) {
          drawOrder.splice(drawOrder.indexOf(activeDragType), 1);
          drawOrder.push(activeDragType);
        }
        drawOrder.forEach((key) => {
          if (key === 'TP') renderTP();
          else if (key === 'ENTRY') renderEntry();
          else if (key === 'SL') renderSL();
        });
      }

      // Hit-test near a horizontal level (16px tolerance for comfortable finger/mouse grabbing)
      function hitTestLine(yClick) {
        const TOL = 16;
        const candidates = [];
        if (state.tp > 0) {
          const y = candleSeries.priceToCoordinate(state.tp);
          if (y !== null && Math.abs(y - yClick) <= TOL) candidates.push({ type: 'TP', dist: Math.abs(y - yClick) });
        }
        if (state.sl > 0) {
          const y = candleSeries.priceToCoordinate(state.sl);
          if (y !== null && Math.abs(y - yClick) <= TOL) candidates.push({ type: 'SL', dist: Math.abs(y - yClick) });
        }
        if (state.entry > 0) {
          const y = candleSeries.priceToCoordinate(state.entry);
          if (y !== null && Math.abs(y - yClick) <= TOL) candidates.push({ type: 'ENTRY', dist: Math.abs(y - yClick) });
        }
        state.hLines.forEach((hl, idx) => {
          const y = candleSeries.priceToCoordinate(hl.price);
          if (y !== null && Math.abs(y - yClick) <= TOL) candidates.push({ type: 'HLINE', index: idx, dist: Math.abs(y - yClick) });
        });

        candidates.sort((a, b) => a.dist - b.dist);
        return candidates.length > 0 ? candidates[0] : null;
      }

      function getCoords(e) {
        const rect = container.getBoundingClientRect();
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
      }

      function onPointerDown(e) {
        // Ignore clicks on quick order buttons
        if (e.target && e.target.closest && e.target.closest('.quick-order-bar')) return;

        const pos = getCoords(e);
        pointerPos = pos;

        // Allow native price-axis vertical scaling on the right axis without grabbing lines
        if (pos.x > getPlotWidth()) return;

        // Drawing mode: HLINE
        if (state.tool === 'HLINE') {
          const price = candleSeries.coordinateToPrice(pos.y);
          if (price) {
            state.hLines.push({ id: Date.now(), price: roundTick(price) });
            state.drawingHistory.push('HLINE');
            sendToHost({ type: 'DRAWING_COUNT', count: state.hLines.length + state.trendLines.length });
            drawOverlay();
          }
          return;
        }

        // Drawing mode: TRENDLINE (2 taps)
        if (state.tool === 'TRENDLINE') {
          const price = candleSeries.coordinateToPrice(pos.y);
          let time = chart.timeScale().coordinateToTime(pos.x);
          if (!time && rawCandles.length > 0) time = rawCandles[rawCandles.length - 1].time;
          if (price && time) {
            if (!state.pendingTrendStart) {
              state.pendingTrendStart = { time, price: roundTick(price) };
              hintPill.textContent = '╱ Tap second point to complete Trendline';
            } else {
              state.trendLines.push({
                id: Date.now(),
                p1: state.pendingTrendStart,
                p2: { time, price: roundTick(price) },
              });
              state.drawingHistory.push('TRENDLINE');
              state.pendingTrendStart = null;
              hintPill.textContent = '╱ Trendline added! Tap again to draw another';
              sendToHost({ type: 'DRAWING_COUNT', count: state.hLines.length + state.trendLines.length });
            }
            drawOverlay();
          }
          return;
        }

        // Hit-test draggable Entry / SL / TP / H-Line handles
        const hit = hitTestLine(pos.y);
        if (hit) {
          draggingTarget = hit;
          chart.applyOptions({ handleScroll: false, handleScale: false });
          if (e.cancelable) e.preventDefault();
          drawOverlay();
          return;
        }

        // In TPSL tap-to-anchor mode, tapping empty area sets active level
        if (state.tool === 'TPSL') {
          const price = candleSeries.coordinateToPrice(pos.y);
          if (price) {
            const snapped = roundTick(price);
            if (state.activeLineType === 'ENTRY') state.entry = snapped;
            else if (state.activeLineType === 'SL') state.sl = snapped;
            else if (state.activeLineType === 'TP') state.tp = snapped;
            sendToHost({ type: 'LEVEL_DRAGGED', line: state.activeLineType, price: snapped });
            drawOverlay();
          }
        }
      }

      function onPointerMove(e) {
        const pos = getCoords(e);
        pointerPos = pos;

        if (!draggingTarget) {
          // Hover cursor feedback on desktop
          if (pos.x > getPlotWidth()) {
            container.style.cursor = 'ns-resize';
            return;
          }
          const hit = hitTestLine(pos.y);
          container.style.cursor = hit ? 'ns-resize' : (state.tool === 'HLINE' || state.tool === 'TRENDLINE' ? 'crosshair' : 'default');
          if (state.tool === 'TRENDLINE' && state.pendingTrendStart) {
            drawOverlay();
          }
          return;
        }

        if (e.cancelable) e.preventDefault();
        const price = candleSeries.coordinateToPrice(pos.y);
        if (!price) return;
        const snapped = roundTick(price);

        if (draggingTarget.type === 'ENTRY') state.entry = snapped;
        else if (draggingTarget.type === 'SL') state.sl = snapped;
        else if (draggingTarget.type === 'TP') state.tp = snapped;
        else if (draggingTarget.type === 'HLINE' && state.hLines[draggingTarget.index]) {
          state.hLines[draggingTarget.index].price = snapped;
        }

        drawOverlay();
      }

      function onPointerUp() {
        if (!draggingTarget) return;
        const finished = draggingTarget;
        draggingTarget = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });

        if (finished.type === 'ENTRY') sendToHost({ type: 'LEVEL_DRAGGED', line: 'ENTRY', price: state.entry });
        else if (finished.type === 'SL') sendToHost({ type: 'LEVEL_DRAGGED', line: 'SL', price: state.sl });
        else if (finished.type === 'TP') sendToHost({ type: 'LEVEL_DRAGGED', line: 'TP', price: state.tp });

        drawOverlay();
      }

      // Attach Mouse & Touch listeners in capture phase so grabbing handles beats chart pan
      wrapper.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('mousemove', onPointerMove, true);
      window.addEventListener('mouseup', onPointerUp, true);

      wrapper.addEventListener('touchstart', onPointerDown, { passive: false, capture: true });
      window.addEventListener('touchmove', onPointerMove, { passive: false, capture: true });
      window.addEventListener('touchend', onPointerUp, true);

      // Quick Buy / Sell / Exit buttons directly on chart
      btnQuickBuy.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_ORDER', side: 'BUY', price: state.entry });
      });
      btnQuickSell.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_ORDER', side: 'SELL', price: state.entry });
      });
      btnQuickExit.addEventListener('click', (e) => {
        e.stopPropagation();
        sendToHost({ type: 'QUICK_EXIT' });
      });

      // Redraw overlay smoothly when chart zooms/pans
      chart.timeScale().subscribeVisibleTimeRangeChange(() => drawOverlay());
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawOverlay());
      setInterval(() => drawOverlay(), 250);

      // Receive state updates from React Native host without reloading
      window.handleHostMessage = function(raw) {
        try {
          const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!data || !data.type) return;

          if (data.type === 'SYNC_STATE') {
            if (!draggingTarget) {
              if (data.side) state.side = data.side;
              if (typeof data.entry === 'number') state.entry = data.entry;
              if (typeof data.sl === 'number') state.sl = data.sl;
              if (typeof data.tp === 'number') state.tp = data.tp;
            }
            if (typeof data.totalQty === 'number') state.totalQty = data.totalQty;
            if (typeof data.showTpSlBox === 'boolean') state.showTpSlBox = data.showTpSlBox;
            if (data.tool) {
              state.tool = data.tool;
              state.pendingTrendStart = null;
              if (data.tool === 'DRAG') hintPill.textContent = '✋ Drag ENTRY / SL / TP handles directly on chart';
              else if (data.tool === 'TPSL') hintPill.textContent = '📐 TP/SL Box active — drag handles or tap chart';
              else if (data.tool === 'HLINE') hintPill.textContent = '━ Tap chart to place Support/Resistance line';
              else if (data.tool === 'TRENDLINE') hintPill.textContent = '╱ Tap start point, then end point for Trendline';
            }
            if (data.activeLineType) state.activeLineType = data.activeLineType;
            state.activePosition = data.activePosition || null;
            btnQuickExit.style.display = state.activePosition ? 'inline-block' : 'none';
            btnQuickBuy.textContent = 'BUY ₹' + state.entry.toFixed(1);
            btnQuickSell.textContent = 'SELL ₹' + state.entry.toFixed(1);
            drawOverlay();
          } else if (data.type === 'UNDO_DRAWING') {
            if (state.pendingTrendStart) {
              state.pendingTrendStart = null;
              hintPill.textContent = '╱ Tap start point, then end point for Trendline';
            } else if (state.drawingHistory.length > 0) {
              const lastType = state.drawingHistory.pop();
              if (lastType === 'HLINE') {
                state.hLines.pop();
              } else if (lastType === 'TRENDLINE') {
                state.trendLines.pop();
              }
            } else if (state.trendLines.length > 0) {
              state.trendLines.pop();
            } else if (state.hLines.length > 0) {
              state.hLines.pop();
            }
            sendToHost({ type: 'DRAWING_COUNT', count: state.hLines.length + state.trendLines.length });
            drawOverlay();
          } else if (data.type === 'CLEAR_DRAWINGS') {
            state.hLines = [];
            state.trendLines = [];
            state.drawingHistory = [];
            state.pendingTrendStart = null;
            sendToHost({ type: 'DRAWING_COUNT', count: 0 });
            drawOverlay();
          }
        } catch {}
      };

      window.addEventListener('message', (e) => window.handleHostMessage(e.data));

      window.addEventListener('resize', () => {
        chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
        resizeCanvas();
      });

      btnQuickBuy.textContent = 'BUY ₹' + state.entry.toFixed(1);
      btnQuickSell.textContent = 'SELL ₹' + state.entry.toFixed(1);
      resizeCanvas();
      sendToHost({ type: 'CHART_READY' });
    </script>
  </body>
</html>`;
  }, [candles, symbol, showVWAP, showEMA9]);

  // Process incoming messages from chart (drags, quick buy/sell, exits, drawings)
  const processChartEvent = useCallback((raw: any) => {
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || !data.type) return;

      if (data.type === 'CHART_READY') {
        syncStateToChart();
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
      } else if (data.type === 'DRAWING_COUNT') {
        setDrawingCount(data.count || 0);
      }
    } catch {}
  }, [syncStateToChart, onLevelChange, onPriceSelected, onQuickOrder, activePosition, onQuickExitPosition]);

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
      {/* Row 1: Timeframes & Indicator Toggles */}
      <View style={styles.toolbar}>
        <View style={styles.tfGroup}>
          {['1m', '3m', '5m', '15m'].map((tf) => (
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
        </View>

        <View style={styles.indicatorGroup}>
          <TouchableOpacity
            style={[styles.indChip, showVWAP && styles.indChipActiveVWAP]}
            onPress={onToggleVWAP}
          >
            <Text style={[styles.indChipText, showVWAP && { color: '#F59E0B' }]}>
              VWAP
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.indChip, showEMA9 && styles.indChipActiveEMA]}
            onPress={onToggleEMA9}
          >
            <Text style={[styles.indChipText, showEMA9 && { color: '#06B6D4' }]}>
              EMA 9
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: Pro Drawing & TP/SL Tools Bar */}
      <View style={styles.drawingBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.drawingBarContent}
        >
          <TouchableOpacity
            style={[styles.toolBtn, activeTool === 'DRAG' && styles.toolBtnActive]}
            onPress={() => setActiveTool('DRAG')}
          >
            <Text
              numberOfLines={1}
              style={[styles.toolBtnText, activeTool === 'DRAG' && styles.toolBtnTextActive]}
            >
              ✋ Drag
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toolBtn,
              showTpSlBox && styles.toolBtnBoxActive,
            ]}
            onPress={() => {
              setShowTpSlBox(!showTpSlBox);
              setActiveTool('TPSL');
            }}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.toolBtnText,
                showTpSlBox && { color: '#10B981' },
              ]}
            >
              📐 TP/SL {showTpSlBox ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, activeTool === 'HLINE' && styles.toolBtnActive]}
            onPress={() => setActiveTool(activeTool === 'HLINE' ? 'DRAG' : 'HLINE')}
          >
            <Text
              numberOfLines={1}
              style={[styles.toolBtnText, activeTool === 'HLINE' && styles.toolBtnTextActive]}
            >
              ━ H-Line
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, activeTool === 'TRENDLINE' && styles.toolBtnActive]}
            onPress={() => setActiveTool(activeTool === 'TRENDLINE' ? 'DRAG' : 'TRENDLINE')}
          >
            <Text
              numberOfLines={1}
              style={[styles.toolBtnText, activeTool === 'TRENDLINE' && styles.toolBtnTextActive]}
            >
              ╱ Trend
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toolBtn,
              drawingCount > 0 ? styles.undoBtnActive : styles.toolBtnMuted,
            ]}
            onPress={handleUndoDrawing}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.toolBtnText,
                drawingCount > 0 && { color: '#FBBF24' },
              ]}
            >
              ↩️ Undo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toolBtn,
              drawingCount > 0 ? styles.clearBtnActive : styles.toolBtnMuted,
            ]}
            onPress={handleClearDrawings}
          >
            <Text
              numberOfLines={1}
              style={[styles.toolBtnText, drawingCount > 0 && { color: '#F87171' }]}
            >
              🗑️ Clear{drawingCount > 0 ? ` (${drawingCount})` : ''}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Main Chart Area */}
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

      {/* Legend & Quick Level Bar */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>Entry: ₹{entryPrice.toFixed(1)}</Text>
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
              style={[
                styles.legendText,
                { color: isSlInverted ? '#FBBF24' : '#F87171' },
              ]}
            >
              {isSlInverted
                ? `⚠️ SL ${transactionType === 'BUY' ? (stopLossPrice > entryPrice ? '>' : '=') : (stopLossPrice < entryPrice ? '<' : '=')} ENTRY (₹${stopLossPrice.toFixed(1)})`
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
              style={[
                styles.legendText,
                { color: isTpInverted ? '#FBBF24' : '#34D399' },
              ]}
            >
              {isTpInverted
                ? `⚠️ TP ${transactionType === 'BUY' ? (targetPrice < entryPrice ? '<' : '=') : (targetPrice > entryPrice ? '>' : '=')} ENTRY (₹${targetPrice.toFixed(1)})`
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
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tfGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  tfBtn: {
    paddingHorizontal: 8,
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
  indicatorGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  indChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#0F172A',
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
  indChipText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
  },
  drawingBarWrap: {
    backgroundColor: '#0B1120',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    flexGrow: 0,
  },
  drawingBarContent: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 5,
    gap: 4,
  },
  toolBtn: {
    flexGrow: 1,
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 5,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    borderColor: '#38BDF8',
  },
  toolBtnBoxActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: '#10B981',
  },
  undoBtnActive: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  clearBtnActive: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  toolBtnMuted: {
    opacity: 0.65,
  },
  toolBtnText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  toolBtnTextActive: {
    color: '#38BDF8',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#1E293B',
    paddingVertical: 5,
    paddingHorizontal: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '600',
  },
});
