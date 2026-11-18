import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
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
  oneClickMode?: boolean;
  onToggleOneClickMode?: () => void;
}

const RR_PRESETS = [
  { label: '1:1.5', multiplier: 1.5 },
  { label: '1:2', multiplier: 2 },
  { label: '1:3', multiplier: 3 },
] as const;

const NUDGE_STEP = 0.5;

function snapToTick(price: number): number {
  return Number(Math.max(0.05, Math.round(price * 20) / 20).toFixed(2));
}

function formatPriceText(price?: number): string {
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return '';
  const snapped = snapToTick(price);
  return Math.abs(snapped * 10 - Math.round(snapped * 10)) > 0.01
    ? snapped.toFixed(2)
    : snapped.toFixed(1);
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
  oneClickMode = false,
  onToggleOneClickMode,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [focusedField, setFocusedField] = useState<'ENTRY' | 'SL' | 'TP' | null>(null);
  const [entryText, setEntryText] = useState<string>(formatPriceText(entryPrice));
  const [slText, setSlText] = useState<string>(formatPriceText(stopLossPrice));
  const [tpText, setTpText] = useState<string>(formatPriceText(targetPrice));

  useEffect(() => {
    if (focusedField !== 'ENTRY') setEntryText(formatPriceText(entryPrice));
  }, [entryPrice, focusedField]);

  useEffect(() => {
    if (focusedField !== 'SL') setSlText(formatPriceText(stopLossPrice));
  }, [stopLossPrice, focusedField]);

  useEffect(() => {
    if (focusedField !== 'TP') setTpText(formatPriceText(targetPrice));
  }, [targetPrice, focusedField]);

  const cleanNumericInput = (raw: string): string => {
    const digitsAndDot = raw.replace(/[^0-9.]/g, '');
    const firstDot = digitsAndDot.indexOf('.');
    if (firstDot === -1) return digitsAndDot;
    return (
      digitsAndDot.slice(0, firstDot + 1) +
      digitsAndDot.slice(firstDot + 1).replace(/\./g, '')
    );
  };

  const commitPriceField = (field: 'ENTRY' | 'SL' | 'TP', rawText: string) => {
    const parsed = parseFloat(rawText);
    if (isFinite(parsed) && parsed > 0) {
      const snapped = snapToTick(parsed);
      if (field === 'ENTRY') {
        setEntryPrice(snapped);
        setEntryText(formatPriceText(snapped));
      } else if (field === 'SL') {
        setStopLossPrice(snapped);
        setSlText(formatPriceText(snapped));
      } else {
        setTargetPrice(snapped);
        setTpText(formatPriceText(snapped));
      }
    } else {
      // Restore previous valid price if input was cleared or invalid
      if (field === 'ENTRY') setEntryText(formatPriceText(entryPrice));
      else if (field === 'SL') setSlText(formatPriceText(stopLossPrice));
      else setTpText(formatPriceText(targetPrice));
    }
  };

  const nudgeLevel = (field: 'ENTRY' | 'SL' | 'TP', delta: number) => {
    setActiveLineType(field);
    if (field === 'ENTRY') {
      const next = snapToTick(entryPrice + delta);
      setEntryPrice(next);
      setEntryText(formatPriceText(next));
    } else if (field === 'SL') {
      const base = stopLossPrice && stopLossPrice > 0 ? stopLossPrice : entryPrice;
      const next = snapToTick(base + delta);
      setStopLossPrice(next);
      setSlText(formatPriceText(next));
    } else {
      const base = targetPrice && targetPrice > 0 ? targetPrice : entryPrice;
      const next = snapToTick(base + delta);
      setTargetPrice(next);
      setTpText(formatPriceText(next));
    }
  };

  const totalQty = lots * lotSize;
  const estimatedCapital = (entryPrice * totalQty).toFixed(0);

  const isSlValid =
    !!stopLossPrice &&
    stopLossPrice > 0 &&
    (transactionType === 'BUY'
      ? stopLossPrice < entryPrice
      : stopLossPrice > entryPrice);

  const isSlInverted = !!stopLossPrice && stopLossPrice > 0 && !isSlValid;

  const isTpValid =
    !!targetPrice &&
    targetPrice > 0 &&
    (transactionType === 'BUY'
      ? targetPrice > entryPrice
      : targetPrice < entryPrice);

  const isTpInverted = !!targetPrice && targetPrice > 0 && !isTpValid;

  const slRiskPts = isSlValid && stopLossPrice ? Math.abs(entryPrice - stopLossPrice) : 0;
  const totalRisk = Math.round(slRiskPts * totalQty);

  const tpRewardPts = isTpValid && targetPrice ? Math.abs(targetPrice - entryPrice) : 0;
  const totalReward = Math.round(tpRewardPts * totalQty);

  const numericRR = slRiskPts > 0 && tpRewardPts > 0 ? tpRewardPts / slRiskPts : 0;
  const rrRatio = numericRR > 0 ? numericRR.toFixed(2) : '-';

  const isMarketOrder = orderType === 'MARKET';

  const handleSnapRR = (multiplier: number) => {
    if (!isSlValid || !stopLossPrice) return;
    const riskPts = Math.abs(entryPrice - stopLossPrice);
    if (riskPts <= 0) return;

    const rawTarget =
      transactionType === 'BUY'
        ? entryPrice + riskPts * multiplier
        : entryPrice - riskPts * multiplier;

    const snappedTarget = snapToTick(rawTarget);
    setTargetPrice(snappedTarget);
    setTpText(formatPriceText(snappedTarget));
    setActiveLineType('TP');
  };

  const handleMinimizedAction = (side: TransactionType) => {
    if (!validation.allowed || isSubmitting) return;
    if (side === transactionType) {
      onPlaceOrder();
    } else {
      setTransactionType(side);
    }
  };

  if (isMinimized) {
    return (
      <View style={styles.minimizedContainer}>
        <TouchableOpacity
          style={styles.expandHandleBtn}
          onPress={() => setIsMinimized(false)}
          accessibilityLabel="Expand Order Ticket"
        >
          <Text numberOfLines={1} style={styles.expandHandleText}>
            ⌃ Ticket
          </Text>
        </TouchableOpacity>

        <View style={styles.minMetaGroup}>
          <View style={styles.minBadge}>
            <Text numberOfLines={1} style={styles.minBadgeText}>
              {lots}L • {isMarketOrder ? 'MKT' : 'LMT'}
            </Text>
          </View>
          <View style={styles.minSlTpPill}>
            <Text numberOfLines={1} style={styles.minSlTpText}>
              SL {stopLossPrice ? formatPriceText(stopLossPrice) : '-'} / TP{' '}
              {targetPrice ? formatPriceText(targetPrice) : '-'}
            </Text>
          </View>
        </View>

        <View style={styles.minActionGroup}>
          <TouchableOpacity
            style={[
              styles.minQuickBtn,
              styles.buyActiveBtn,
              transactionType === 'BUY' && styles.minQuickBtnArmed,
              (!validation.allowed || isSubmitting) && styles.disabledBtn,
            ]}
            onPress={() => handleMinimizedAction('BUY')}
            disabled={!validation.allowed || isSubmitting}
          >
            <Text numberOfLines={1} style={styles.minQuickBtnText}>
              BUY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.minQuickBtn,
              styles.sellActiveBtn,
              transactionType === 'SELL' && styles.minQuickBtnArmed,
              (!validation.allowed || isSubmitting) && styles.disabledBtn,
            ]}
            onPress={() => handleMinimizedAction('SELL')}
            disabled={!validation.allowed || isSubmitting}
          >
            <Text numberOfLines={1} style={styles.minQuickBtnText}>
              SELL
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Collapsible Top Handle Bar */}
      <TouchableOpacity
        style={styles.minimizeHandleBar}
        onPress={() => setIsMinimized(true)}
        accessibilityLabel="Minimize Order Ticket"
      >
        <View style={styles.handlePillGrip} />
        <Text numberOfLines={1} style={styles.minimizeHandleText}>
          ⌄ Minimize Ticket
        </Text>
      </TouchableOpacity>

      {/* Row 1: Buy/Sell, 1-Click/Confirm Toggle, and Lots Counter */}
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

        {/* 1-Click vs Confirm Execution Mode Pill */}
        <TouchableOpacity
          style={[
            styles.modeTogglePill,
            oneClickMode ? styles.modeOneClickActive : styles.modeConfirmActive,
          ]}
          onPress={onToggleOneClickMode}
          disabled={!onToggleOneClickMode}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.modeToggleText,
              oneClickMode ? styles.modeOneClickText : styles.modeConfirmText,
            ]}
          >
            {oneClickMode ? '⚡ 1-Click' : '✓ Confirm'}
          </Text>
        </TouchableOpacity>

        {/* Lots Counter */}
        <View style={styles.lotsContainer}>
          <View style={styles.counterRow}>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={() => setLots(Math.max(1, lots - 1))}
            >
              <Text style={styles.counterBtnText}>-</Text>
            </TouchableOpacity>
            <View style={styles.lotDisplay}>
              <Text numberOfLines={1} style={styles.lotText}>{lots}L</Text>
              <Text numberOfLines={1} style={styles.qtySubtext}>{totalQty}</Text>
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

      {/* Row 2: Order Type (LIMIT / MKT) & Quick R:R Target Snap Presets */}
      <View style={styles.controlsRow}>
        <View style={styles.orderTypeToggle}>
          <TouchableOpacity
            style={[
              styles.orderTypePill,
              !isMarketOrder && styles.orderTypePillActive,
            ]}
            onPress={() => setOrderType('LIMIT')}
          >
            <Text
              style={[
                styles.orderTypeText,
                !isMarketOrder && styles.orderTypeTextActive,
              ]}
            >
              LIMIT
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.orderTypePill,
              isMarketOrder && styles.orderTypePillActive,
            ]}
            onPress={() => setOrderType('MARKET')}
          >
            <Text
              style={[
                styles.orderTypeText,
                isMarketOrder && styles.orderTypeTextActive,
              ]}
            >
              MKT
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rrPresetsGroup}>
          <Text style={styles.rrGroupLabel}>R:R</Text>
          {RR_PRESETS.map((preset) => {
            const isMatched =
              isSlValid &&
              isTpValid &&
              Math.abs(numericRR - preset.multiplier) < 0.06;
            return (
              <TouchableOpacity
                key={preset.label}
                style={[
                  styles.rrPresetPill,
                  isMatched && styles.rrPresetPillActive,
                  !isSlValid && styles.rrPresetPillDisabled,
                ]}
                onPress={() => handleSnapRR(preset.multiplier)}
                disabled={!isSlValid}
              >
                <Text
                  style={[
                    styles.rrPresetText,
                    isMatched && styles.rrPresetTextActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Editable Level Cards (Inline Numeric Input + Nudge ±0.5) */}
      <View style={styles.levelTabsRow}>
        {/* ENTRY Card (Read-only MKT @ LTP in MARKET mode; editable in LIMIT mode) */}
        <View
          style={[
            styles.levelTab,
            !isMarketOrder && activeLineType === 'ENTRY' && styles.entryActiveTab,
            isMarketOrder && styles.mktEntryTab,
          ]}
        >
          <TouchableOpacity
            onPress={() => !isMarketOrder && setActiveLineType('ENTRY')}
            disabled={isMarketOrder}
          >
            <Text style={styles.levelTabLabel} numberOfLines={1}>
              {isMarketOrder ? 'Entry (MKT)' : 'Entry (LMT)'}
            </Text>
          </TouchableOpacity>

          {isMarketOrder ? (
            <View style={styles.mktReadOnlyRow}>
              <Text style={styles.mktBadge}>MKT</Text>
              <Text style={styles.mktPriceText} numberOfLines={1}>
                ₹{formatPriceText(entryPrice)}
              </Text>
            </View>
          ) : (
            <View style={styles.priceInputRow}>
              <TouchableOpacity
                style={styles.nudgeBtn}
                onPress={() => nudgeLevel('ENTRY', -NUDGE_STEP)}
              >
                <Text style={styles.nudgeBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.inputFieldWrap}>
                <Text style={styles.rupeePrefix}>₹</Text>
                <TextInput
                  style={styles.levelInput}
                  value={entryText}
                  onFocus={() => {
                    setFocusedField('ENTRY');
                    setActiveLineType('ENTRY');
                  }}
                  onChangeText={(txt) => setEntryText(cleanNumericInput(txt))}
                  onBlur={() => {
                    setFocusedField(null);
                    commitPriceField('ENTRY', entryText);
                  }}
                  onSubmitEditing={() => commitPriceField('ENTRY', entryText)}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  placeholder="0.0"
                  placeholderTextColor="#475569"
                />
              </View>
              <TouchableOpacity
                style={styles.nudgeBtn}
                onPress={() => nudgeLevel('ENTRY', NUDGE_STEP)}
              >
                <Text style={styles.nudgeBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* STOP LOSS Card */}
        <View
          style={[
            styles.levelTab,
            activeLineType === 'SL' && styles.slActiveTab,
            isSlInverted && styles.invalidLevelTab,
          ]}
        >
          <TouchableOpacity onPress={() => setActiveLineType('SL')}>
            <Text
              numberOfLines={1}
              style={[
                styles.levelTabLabel,
                { color: isSlInverted ? '#FBBF24' : '#F87171' },
              ]}
            >
              {isSlInverted ? '⚠️ Stop Loss' : 'Stop Loss'}
            </Text>
          </TouchableOpacity>
          <View style={styles.priceInputRow}>
            <TouchableOpacity
              style={styles.nudgeBtn}
              onPress={() => nudgeLevel('SL', -NUDGE_STEP)}
            >
              <Text style={styles.nudgeBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.inputFieldWrap}>
              <Text
                style={[
                  styles.rupeePrefix,
                  { color: isSlInverted ? '#F59E0B' : '#EF4444' },
                ]}
              >
                ₹
              </Text>
              <TextInput
                style={[
                  styles.levelInput,
                  { color: isSlInverted ? '#F59E0B' : '#EF4444' },
                ]}
                value={slText}
                onFocus={() => {
                  setFocusedField('SL');
                  setActiveLineType('SL');
                }}
                onChangeText={(txt) => setSlText(cleanNumericInput(txt))}
                onBlur={() => {
                  setFocusedField(null);
                  commitPriceField('SL', slText);
                }}
                onSubmitEditing={() => commitPriceField('SL', slText)}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                placeholder="Set"
                placeholderTextColor="#64748B"
              />
            </View>
            <TouchableOpacity
              style={styles.nudgeBtn}
              onPress={() => nudgeLevel('SL', NUDGE_STEP)}
            >
              <Text style={styles.nudgeBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* TARGET Card */}
        <View
          style={[
            styles.levelTab,
            activeLineType === 'TP' && styles.tpActiveTab,
            isTpInverted && styles.invalidLevelTab,
          ]}
        >
          <TouchableOpacity onPress={() => setActiveLineType('TP')}>
            <Text
              numberOfLines={1}
              style={[
                styles.levelTabLabel,
                { color: isTpInverted ? '#FBBF24' : '#34D399' },
              ]}
            >
              {isTpInverted ? '⚠️ Target' : 'Target'}
            </Text>
          </TouchableOpacity>
          <View style={styles.priceInputRow}>
            <TouchableOpacity
              style={styles.nudgeBtn}
              onPress={() => nudgeLevel('TP', -NUDGE_STEP)}
            >
              <Text style={styles.nudgeBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.inputFieldWrap}>
              <Text
                style={[
                  styles.rupeePrefix,
                  { color: isTpInverted ? '#F59E0B' : '#10B981' },
                ]}
              >
                ₹
              </Text>
              <TextInput
                style={[
                  styles.levelInput,
                  { color: isTpInverted ? '#F59E0B' : '#10B981' },
                ]}
                value={tpText}
                onFocus={() => {
                  setFocusedField('TP');
                  setActiveLineType('TP');
                }}
                onChangeText={(txt) => setTpText(cleanNumericInput(txt))}
                onBlur={() => {
                  setFocusedField(null);
                  commitPriceField('TP', tpText);
                }}
                onSubmitEditing={() => commitPriceField('TP', tpText)}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                placeholder="Set"
                placeholderTextColor="#64748B"
              />
            </View>
            <TouchableOpacity
              style={styles.nudgeBtn}
              onPress={() => nudgeLevel('TP', NUDGE_STEP)}
            >
              <Text style={styles.nudgeBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Risk-Reward & Compliance Metrics */}
      <View style={styles.metricsCard}>
        <View style={styles.metricCol}>
          <Text numberOfLines={1} style={styles.metricLabel}>Max Risk</Text>
          <Text
            numberOfLines={1}
            style={[
              styles.metricVal,
              { color: isSlInverted ? '#F59E0B' : '#EF4444' },
            ]}
          >
            {isSlInverted ? '⚠️ Check SL' : totalRisk > 0 ? `-₹${totalRisk}` : 'None'}
          </Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text numberOfLines={1} style={styles.metricLabel}>Target Reward</Text>
          <Text
            numberOfLines={1}
            style={[
              styles.metricVal,
              { color: isTpInverted ? '#F59E0B' : '#10B981' },
            ]}
          >
            {isTpInverted ? '⚠️ Check TP' : totalReward > 0 ? `+₹${totalReward}` : 'None'}
          </Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCol}>
          <Text numberOfLines={1} style={styles.metricLabel}>R : R</Text>
          <Text numberOfLines={1} style={[styles.metricVal, { color: '#38BDF8' }]}>
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
        <Text style={styles.submitBtnText} numberOfLines={1} adjustsFontSizeToFit>
          {isSubmitting
            ? 'SENDING ORDER...'
            : `${transactionType} ${isMarketOrder ? 'MKT' : 'LMT'} • ${lots} LOT (${totalQty} QTY) • ₹${estimatedCapital}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  minimizeHandleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    marginBottom: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  handlePillGrip: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#475569',
  },
  minimizeHandleText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  minimizedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  expandHandleBtn: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    flexShrink: 0,
  },
  expandHandleText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  minMetaGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  minBadge: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    flexShrink: 0,
  },
  minBadgeText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  minSlTpPill: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  minSlTpText: {
    color: '#94A3B8',
    fontSize: 9.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  minActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  minQuickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  minQuickBtnArmed: {
    borderColor: '#FFFFFF',
  },
  minQuickBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 3,
    flex: 1,
    maxWidth: 144,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 6,
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
    fontSize: 12,
  },
  textWhite: {
    color: '#FFFFFF',
  },
  modeTogglePill: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeOneClickActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: '#F59E0B',
  },
  modeConfirmActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderColor: '#38BDF8',
  },
  modeToggleText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  modeOneClickText: {
    color: '#FBBF24',
  },
  modeConfirmText: {
    color: '#7DD3FC',
  },
  lotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 2,
  },
  counterBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  counterBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  lotDisplay: {
    paddingHorizontal: 7,
    alignItems: 'center',
    minWidth: 36,
  },
  lotText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  qtySubtext: {
    color: '#64748B',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  orderTypeToggle: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 7,
    padding: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  orderTypePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderTypePillActive: {
    backgroundColor: '#38BDF8',
  },
  orderTypeText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  orderTypeTextActive: {
    color: '#0F172A',
  },
  rrPresetsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rrGroupLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginRight: 2,
  },
  rrPresetPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  rrPresetPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#10B981',
  },
  rrPresetPillDisabled: {
    opacity: 0.4,
  },
  rrPresetText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
  },
  rrPresetTextActive: {
    color: '#34D399',
  },
  levelTabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  levelTab: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#1E293B',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  entryActiveTab: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  mktEntryTab: {
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  mktReadOnlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 22,
    marginTop: 3,
    width: '100%',
  },
  mktBadge: {
    color: '#0F172A',
    backgroundColor: '#FBBF24',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  mktPriceText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  slActiveTab: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  tpActiveTab: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  invalidLevelTab: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  levelTabLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 3,
    gap: 2,
  },
  nudgeBtn: {
    width: 20,
    height: 22,
    borderRadius: 4,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nudgeBtnText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 15,
  },
  inputFieldWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 4,
    paddingHorizontal: 3,
    height: 22,
  },
  rupeePrefix: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    marginRight: 1,
  },
  levelInput: {
    flex: 1,
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
    paddingVertical: 0,
    paddingHorizontal: 1,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  levelTabValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
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
    fontVariant: ['tabular-nums'],
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
    fontVariant: ['tabular-nums'],
  },
});
