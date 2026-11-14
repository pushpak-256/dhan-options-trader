import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { TransactionType, OrderType } from '../types/dhan';
import { OrderPreFlightValidation } from '../types/compliance';

interface ChartOrderPanelProps {
  transactionType: TransactionType;
  setTransactionType: (t: TransactionType) => void;
  orderType: OrderType;
  setOrderType: (o: OrderType) => void;
  lots: number;
  setLots: (l: number) => void;
  lotSize: number;
  entryPrice: number;
  setEntryPrice: (p: number) => void;
  stopLossPrice?: number;
  setStopLossPrice: (p: number) => void;
  targetPrice?: number;
  setTargetPrice: (p: number) => void;
  activeLineType: 'ENTRY' | 'SL' | 'TP';
  setActiveLineType: (t: 'ENTRY' | 'SL' | 'TP') => void;
  validation: OrderPreFlightValidation;
  onPlaceOrder: () => void;
  isSubmitting: boolean;
}

export const ChartOrderPanel: React.FC<ChartOrderPanelProps> = ({
  transactionType,
  setTransactionType,
  orderType,
  setOrderType,
  lots,
  setLots,
  lotSize,
  entryPrice,
  setEntryPrice,
  stopLossPrice,
  setStopLossPrice,
  targetPrice,
  setTargetPrice,
  activeLineType,
  setActiveLineType,
  validation,
  onPlaceOrder,
  isSubmitting,
}) => {
  const totalQty = lots * lotSize;
  const estimatedCapital = (entryPrice * totalQty).toFixed(0);

  const slRiskPts = stopLossPrice ? Math.abs(entryPrice - stopLossPrice) : 0;
  const totalRisk = Math.round(slRiskPts * totalQty);

  const tpRewardPts = targetPrice ? Math.abs(targetPrice - entryPrice) : 0;
  const totalReward = Math.round(tpRewardPts * totalQty);

  const rrRatio = slRiskPts > 0 ? (tpRewardPts / slRiskPts).toFixed(2) : '-';

  return (
    <View style={styles.container}>
      {/* Top Row: Buy/Sell and Order Type */}
      <View style={styles.row}>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              transactionType === 'BUY' && styles.buyActiveBtn,
            ]}
            onPress={() => setTransactionType('BUY')}
          >
            <Text
              style={[
                styles.segmentText,
                transactionType === 'BUY' && styles.textWhite,
              ]}
            >
              BUY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              transactionType === 'SELL' && styles.sellActiveBtn,
            ]}
            onPress={() => setTransactionType('SELL')}
          >
            <Text
              style={[
                styles.segmentText,
                transactionType === 'SELL' && styles.textWhite,
              ]}
            >
              SELL
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lots Counter */}
        <View style={styles.lotsContainer}>
          <Text style={styles.label}>LOTS</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={() => setLots(Math.max(1, lots - 1))}
            >
              <Text style={styles.counterBtnText}>-</Text>
            </TouchableOpacity>
            <View style={styles.lotDisplay}>
              <Text style={styles.lotText}>{lots}</Text>
              <Text style={styles.qtySubtext}>{totalQty} qty</Text>
            </View>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={() => setLots(lots + 1)}
            >
              <Text style={styles.counterBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Level Selection Tabs (Tap on Chart mode) */}
      <View style={styles.levelTabsRow}>
        <TouchableOpacity
          style={[
            styles.levelTab,
            activeLineType === 'ENTRY' && styles.entryActiveTab,
          ]}
          onPress={() => setActiveLineType('ENTRY')}
        >
          <Text style={styles.levelTabLabel}>Entry</Text>
          <Text style={styles.levelTabValue}>₹{entryPrice.toFixed(1)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.levelTab,
            activeLineType === 'SL' && styles.slActiveTab,
          ]}
          onPress={() => setActiveLineType('SL')}
        >
          <Text style={[styles.levelTabLabel, { color: '#F87171' }]}>Stop Loss</Text>
          <Text style={[styles.levelTabValue, { color: '#EF4444' }]}>
            {stopLossPrice ? `₹${stopLossPrice.toFixed(1)}` : 'Tap Chart'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.levelTab,
            activeLineType === 'TP' && styles.tpActiveTab,
          ]}
          onPress={() => setActiveLineType('TP')}
        >
          <Text style={[styles.levelTabLabel, { color: '#34D399' }]}>Target</Text>
          <Text style={[styles.levelTabValue, { color: '#10B981' }]}>
            {targetPrice ? `₹${targetPrice.toFixed(1)}` : 'Tap Chart'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Risk-Reward & Compliance Metrics */}
      <View style={styles.metricsCard}>
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Max Risk</Text>
          <Text style={[styles.metricVal, { color: '#EF4444' }]}>
            {totalRisk > 0 ? `-₹${totalRisk}` : 'None'}
          </Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>Target Reward</Text>
          <Text style={[styles.metricVal, { color: '#10B981' }]}>
            {totalReward > 0 ? `+₹${totalReward}` : 'None'}
          </Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text style={styles.metricLabel}>R : R</Text>
          <Text style={[styles.metricVal, { color: '#38BDF8' }]}>
            {rrRatio !== '-' ? `1:${rrRatio}` : '-'}
          </Text>
        </View>
      </View>

      {/* Compliance Rule Warnings/Blocks */}
      {!validation.allowed && validation.reasons.length > 0 ? (
        <View style={styles.blockNotice}>
          <Text style={styles.blockTitle}>⚠️ Compliance Rule Active</Text>
          <Text style={styles.blockDesc}>{validation.reasons[0]}</Text>
        </View>
      ) : null}

      {/* Submit Button */}
      <TouchableOpacity
        style={[
          styles.submitBtn,
          transactionType === 'BUY' ? styles.buyBtnColor : styles.sellBtnColor,
          (!validation.allowed || isSubmitting) && styles.disabledBtn,
        ]}
        onPress={onPlaceOrder}
        disabled={!validation.allowed || isSubmitting}
      >
        <Text style={styles.submitBtnText}>
          {isSubmitting
            ? 'SENDING ORDER...'
            : `${transactionType} ${lots} LOT (${totalQty} QTY) • ₹${estimatedCapital}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 3,
    width: '45%',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  buyActiveBtn: {
    backgroundColor: '#10B981',
  },
  sellActiveBtn: {
    backgroundColor: '#EF4444',
  },
  segmentText: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 13,
  },
  textWhite: {
    color: '#FFFFFF',
  },
  lotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 2,
  },
  counterBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  counterBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  lotDisplay: {
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  lotText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
  },
  qtySubtext: {
    color: '#64748B',
    fontSize: 9,
  },
  levelTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  levelTab: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  entryActiveTab: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  slActiveTab: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  tpActiveTab: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  levelTabLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  levelTabValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  metricsCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricCol: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  metricVal: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },
  metricDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#334155',
  },
  blockNotice: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  blockTitle: {
    color: '#F87171',
    fontWeight: '700',
    fontSize: 12,
  },
  blockDesc: {
    color: '#FECACA',
    fontSize: 11,
    marginTop: 2,
  },
  submitBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyBtnColor: {
    backgroundColor: '#10B981',
  },
  sellBtnColor: {
    backgroundColor: '#EF4444',
  },
  disabledBtn: {
    backgroundColor: '#334155',
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
