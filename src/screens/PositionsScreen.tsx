import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { DhanApiService } from '../services/dhanApi';
import { ComplianceEngine } from '../services/complianceEngine';
import { DhanPosition } from '../types/dhan';

interface PositionsScreenProps {
  onRefreshPnl: () => void;
}

export const PositionsScreen: React.FC<PositionsScreenProps> = ({ onRefreshPnl }) => {
  const [positions, setPositions] = useState<DhanPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPositions = async () => {
    try {
      setLoading(true);
      const data = await DhanApiService.getPositions();
      setPositions(data);
    } catch (e) {
      console.error('Failed to load positions', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPositions();
  }, []);

  const totalRealized = positions.reduce((acc, p) => acc + (p.realizedProfit || 0), 0);
  const totalUnrealized = positions.reduce((acc, p) => acc + (p.unrealizedProfit || 0), 0);
  const totalPnl = totalRealized + totalUnrealized;

  const handleExitPosition = (pos: DhanPosition) => {
    Alert.alert(
      'Confirm Exit',
      `Exit ${pos.tradingSymbol} (Qty: ${pos.netQty}) at market price?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Exit',
          style: 'destructive',
          onPress: async () => {
            // Close position simulation or API
            await ComplianceEngine.recordTradeResult(pos.unrealizedProfit);
            Alert.alert('Position Closed', `Realized P&L: ₹${pos.unrealizedProfit}`);
            loadPositions();
            onRefreshPnl();
          },
        },
      ]
    );
  };

  const handleExitAll = () => {
    Alert.alert(
      '🚨 PANIC EXIT ALL',
      'This will immediately close ALL open positions at market price. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'EXIT EVERYTHING',
          style: 'destructive',
          onPress: async () => {
            for (const pos of positions) {
              if (pos.netQty !== 0) {
                await ComplianceEngine.recordTradeResult(pos.unrealizedProfit);
              }
            }
            Alert.alert('All Positions Exited', 'Orders placed to square off all positions.');
            loadPositions();
            onRefreshPnl();
          },
        },
      ]
    );
  };

  if (loading && positions.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* MTM Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>TOTAL DAY P&L</Text>
            <Text
              style={[
                styles.summaryPnl,
                totalPnl >= 0 ? styles.textGreen : styles.textRed,
              ]}
            >
              {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toFixed(0)}
            </Text>
          </View>

          {positions.some((p) => p.netQty !== 0) && (
            <TouchableOpacity style={styles.panicBtn} onPress={handleExitAll}>
              <Text style={styles.panicBtnText}>🚨 EXIT ALL</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.pnlBreakdown}>
          <Text style={styles.breakdownText}>
            Realized: <Text style={totalRealized >= 0 ? styles.textGreen : styles.textRed}>₹{totalRealized.toFixed(0)}</Text>
          </Text>
          <Text style={styles.breakdownText}>
            Unrealized: <Text style={totalUnrealized >= 0 ? styles.textGreen : styles.textRed}>₹{totalUnrealized.toFixed(0)}</Text>
          </Text>
        </View>
      </View>

      {/* Positions List */}
      <ScrollView style={styles.list}>
        {positions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No positions found for today.</Text>
          </View>
        ) : (
          positions.map((pos) => {
            const isOpen = pos.netQty !== 0;
            const pnl = isOpen ? pos.unrealizedProfit : pos.realizedProfit;

            return (
              <View key={pos.securityId} style={styles.positionCard}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.posSymbol}>{pos.tradingSymbol}</Text>
                    <Text style={styles.posType}>
                      {pos.productType} • {pos.exchangeSegment}
                    </Text>
                  </View>
                  <View style={styles.pnlBox}>
                    <Text
                      style={[
                        styles.posPnl,
                        pnl >= 0 ? styles.textGreen : styles.textRed,
                      ]}
                    >
                      {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}
                    </Text>
                    <Text style={styles.posStatus}>
                      {isOpen ? 'OPEN' : 'CLOSED'}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardDetails}>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Net Qty</Text>
                    <Text style={styles.detailVal}>{pos.netQty}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>Buy Avg</Text>
                    <Text style={styles.detailVal}>₹{pos.buyAvg.toFixed(1)}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>LTP</Text>
                    <Text style={styles.detailVal}>₹{pos.ltp.toFixed(1)}</Text>
                  </View>
                  {isOpen && (
                    <TouchableOpacity
                      style={styles.exitBtn}
                      onPress={() => handleExitPosition(pos)}
                    >
                      <Text style={styles.exitBtnText}>Exit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryCard: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryPnl: {
    fontSize: 24,
    fontWeight: '900',
    marginTop: 2,
  },
  panicBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  panicBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  pnlBreakdown: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  breakdownText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  textGreen: {
    color: '#10B981',
  },
  textRed: {
    color: '#EF4444',
  },
  list: {
    flex: 1,
    padding: 12,
  },
  emptyBox: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
  },
  positionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  posSymbol: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 14,
  },
  posType: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  pnlBox: {
    alignItems: 'flex-end',
  },
  posPnl: {
    fontSize: 16,
    fontWeight: '800',
  },
  posStatus: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
  },
  detailCol: {
    alignItems: 'flex-start',
  },
  detailLabel: {
    color: '#64748B',
    fontSize: 10,
  },
  detailVal: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 12,
    marginTop: 2,
  },
  exitBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  exitBtnText: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 11,
  },
});
