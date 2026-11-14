import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { CandleData } from '../types/dhan';
import { calculateVWAP, calculateEMA } from '../utils/indicators';

interface InteractiveChartProps {
  candles: CandleData[];
  symbol: string;
  entryPrice: number;
  stopLossPrice?: number;
  targetPrice?: number;
  lotSize: number;
  lots: number;
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
  entryPrice,
  stopLossPrice,
  targetPrice,
  lotSize,
  lots,
  onPriceSelected,
  activeLineType = 'ENTRY',
  showVWAP = true,
  showEMA9 = true,
  timeframe = '5m',
  onSelectTimeframe,
  onToggleVWAP,
  onToggleEMA9,
}) => {
  const webViewRef = useRef<any>(null);
  const WebViewComponent: any = WebView;
  const totalQty = lotSize * lots;

  // Calculate SL risk & TP reward
  const slRiskPts = stopLossPrice ? Math.abs(entryPrice - stopLossPrice) : 0;
  const slRiskRupees = slRiskPts * totalQty;

  const tpRewardPts = targetPrice ? Math.abs(targetPrice - entryPrice) : 0;
  const tpRewardRupees = tpRewardPts * totalQty;

  const rrRatio = slRiskPts > 0 ? (tpRewardPts / slRiskPts).toFixed(2) : '0';

  // Compute indicators
  const vwapData = showVWAP ? calculateVWAP(candles) : [];
  const ema9Data = showEMA9 ? calculateEMA(candles, 9) : [];

  const chartHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
          body, html { width: 100%; height: 100%; background-color: #0F172A; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          #container { width: 100%; height: 100%; position: relative; }
          .chart-header {
            position: absolute;
            top: 6px;
            left: 8px;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(15, 23, 42, 0.85);
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.08);
          }
          .symbol-text { color: #F8FAFC; font-weight: 700; font-size: 12px; }
          .ltp-text { color: #38BDF8; font-weight: 600; font-size: 12px; }
          .vwap-indicator { color: #F59E0B; font-size: 10px; font-weight: 700; }
          .ema-indicator { color: #06B6D4; font-size: 10px; font-weight: 700; }
        </style>
      </head>
      <body>
        <div id="container">
          <div class="chart-header">
            <span class="symbol-text">${symbol}</span>
            <span class="ltp-text" id="ltpHeader">₹${entryPrice.toFixed(2)}</span>
            ${showVWAP ? '<span class="vwap-indicator">• VWAP</span>' : ''}
            ${showEMA9 ? '<span class="ema-indicator">• EMA 9</span>' : ''}
          </div>
        </div>

        <script>
          const container = document.getElementById('container');
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
            },
            rightPriceScale: {
              borderColor: '#334155',
              scaleMargins: { top: 0.15, bottom: 0.2 },
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

          const rawCandles = ${JSON.stringify(candles)};
          candleSeries.setData(rawCandles);

          // Indicators
          ${
            showVWAP
              ? `
            const vwapSeries = chart.addLineSeries({
              color: '#F59E0B',
              lineWidth: 1.5,
              title: 'VWAP',
            });
            vwapSeries.setData(${JSON.stringify(vwapData)});
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
            ema9Series.setData(${JSON.stringify(ema9Data)});
          `
              : ''
          }

          // Lines for Entry, SL, TP
          let entryLine = null;
          let slLine = null;
          let tpLine = null;

          function updateLines(entry, sl, tp, riskRs, rewardRs, rr) {
            if (entryLine) candleSeries.removePriceLine(entryLine);
            if (slLine) candleSeries.removePriceLine(slLine);
            if (tpLine) candleSeries.removePriceLine(tpLine);

            if (entry && entry > 0) {
              entryLine = candleSeries.createPriceLine({
                price: entry,
                color: '#38BDF8',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true,
                title: 'ENTRY ₹' + entry.toFixed(1),
              });
            }

            if (sl && sl > 0) {
              slLine = candleSeries.createPriceLine({
                price: sl,
                color: '#EF4444',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'SL (-₹' + Math.round(riskRs) + ')',
              });
            }

            if (tp && tp > 0) {
              tpLine = candleSeries.createPriceLine({
                price: tp,
                color: '#10B981',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'TP (+₹' + Math.round(rewardRs) + ' | 1:' + rr + ')',
              });
            }
          }

          updateLines(${entryPrice}, ${stopLossPrice || 0}, ${targetPrice || 0}, ${slRiskRupees}, ${tpRewardRupees}, '${rrRatio}');

          // Handle tap/click on chart to select price
          chart.subscribeClick((param) => {
            if (param && param.point) {
              const price = candleSeries.coordinateToPrice(param.point.y);
              if (price) {
                window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
                  JSON.stringify({ type: 'PRICE_CLICK', price: Math.round(price * 20) / 20 })
                );
              }
            }
          });

          window.addEventListener('resize', () => {
            chart.applyOptions({
              width: container.clientWidth,
              height: container.clientHeight,
            });
          });
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'PRICE_CLICK' && onPriceSelected) {
        onPriceSelected(data.price);
      }
    } catch {}
  };

  return (
    <View style={styles.container}>
      {/* Top Toolbar: Timeframes & Indicator Toggles */}
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
            <Text
              style={[
                styles.indChipText,
                showVWAP && { color: '#F59E0B' },
              ]}
            >
              VWAP
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.indChip, showEMA9 && styles.indChipActiveEMA]}
            onPress={onToggleEMA9}
          >
            <Text
              style={[
                styles.indChipText,
                showEMA9 && { color: '#06B6D4' },
              ]}
            >
              EMA 9
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <WebViewComponent
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: chartHtml }}
        style={styles.webview}
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />

      {/* Legend & Quick Level Bar */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>Entry: ₹{entryPrice.toFixed(1)}</Text>
        </View>
        {stopLossPrice && stopLossPrice > 0 ? (
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
            <Text style={[styles.legendText, { color: '#F87171' }]}>
              SL: ₹{stopLossPrice.toFixed(1)} (-₹{Math.round(slRiskRupees)})
            </Text>
          </View>
        ) : null}
        {targetPrice && targetPrice > 0 ? (
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
            <Text style={[styles.legendText, { color: '#34D399' }]}>
              TP: ₹{targetPrice.toFixed(1)} (+₹{Math.round(tpRewardRupees)})
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
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  legendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 8,
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
    fontSize: 11,
    fontWeight: '600',
  },
});
