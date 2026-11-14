import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { OptionChainData, OptionContract } from '../types/dhan';
import { SUPPORTED_INDICES } from '../constants/indices';

interface OptionChainTableProps {
  chainData: OptionChainData;
  selectedIndex: string;
  onSelectIndex: (index: string) => void;
  onSelectExpiry: (expiry: string) => void;
  onSelectStrike: (contract: OptionContract, type: 'CALL' | 'PUT') => void;
}

export const OptionChainTable: React.FC<OptionChainTableProps> = ({
  chainData,
  selectedIndex,
  onSelectIndex,
  onSelectExpiry,
  onSelectStrike,
}) => {
  return (
    <View style={styles.container}>
      {/* Index Selector Bar */}
      <View style={styles.indexBar}>
        {Object.keys(SUPPORTED_INDICES).map((key) => {
          const isSelected = selectedIndex === key;
          const idx = SUPPORTED_INDICES[key];
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.indexChip,
                isSelected && { backgroundColor: idx.color },
              ]}
              onPress={() => onSelectIndex(key)}
            >
              <Text
                style={[
                  styles.indexChipText,
                  isSelected && styles.textWhite,
                ]}
              >
                {idx.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Spot Price & Expiry Selector Bar */}
      <View style={styles.metaBar}>
        <View>
          <Text style={styles.spotLabel}>{selectedIndex} SPOT</Text>
          <Text style={styles.spotValue}>₹{chainData.underlyingLtp.toLocaleString('en-IN')}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.expiryList}
        >
          {chainData.expiryDates.map((exp) => {
            const isSelected = chainData.selectedExpiry === exp;
            return (
              <TouchableOpacity
                key={exp}
                style={[styles.expiryChip, isSelected && styles.expiryChipActive]}
                onPress={() => onSelectExpiry(exp)}
              >
                <Text
                  style={[
                    styles.expiryChipText,
                    isSelected && styles.textWhite,
                  ]}
                >
                  {exp.slice(5)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Table Column Headers */}
      <View style={styles.headerRow}>
        <View style={styles.callCol}>
          <Text style={styles.colHeaderCall}>CALLS (CE)</Text>
          <View style={styles.subHeaderRow}>
            <Text style={styles.subHeaderText}>OI</Text>
            <Text style={styles.subHeaderText}>LTP</Text>
          </View>
        </View>

        <View style={styles.strikeCol}>
          <Text style={styles.colHeaderStrike}>STRIKE</Text>
        </View>

        <View style={styles.putCol}>
          <Text style={styles.colHeaderPut}>PUTS (PE)</Text>
          <View style={styles.subHeaderRow}>
            <Text style={styles.subHeaderText}>LTP</Text>
            <Text style={styles.subHeaderText}>OI</Text>
          </View>
        </View>
      </View>

      {/* Strike Ladder Rows */}
      <ScrollView style={styles.strikeList}>
        {chainData.strikes.map((row) => {
          const isITMCall = row.strikePrice < chainData.underlyingLtp;
          const isITMPut = row.strikePrice > chainData.underlyingLtp;

          return (
            <View
              key={row.strikePrice}
              style={[
                styles.dataRow,
                row.isATM && styles.atmRow,
              ]}
            >
              {/* Call Side */}
              <TouchableOpacity
                style={[
                  styles.sideCell,
                  styles.callCol,
                  isITMCall && styles.itmCallBg,
                ]}
                onPress={() => onSelectStrike(row.call, 'CALL')}
              >
                <Text style={styles.oiText}>{(row.call.oi / 100000).toFixed(1)}L</Text>
                <Text style={styles.ltpCallText}>₹{row.call.ltp.toFixed(1)}</Text>
              </TouchableOpacity>

              {/* Middle Strike Price */}
              <View style={[styles.strikeCell, styles.strikeCol]}>
                <Text
                  style={[
                    styles.strikeText,
                    row.isATM && styles.atmStrikeText,
                  ]}
                >
                  {row.strikePrice}
                </Text>
                {row.isATM && <Text style={styles.atmBadge}>ATM</Text>}
              </View>

              {/* Put Side */}
              <TouchableOpacity
                style={[
                  styles.sideCell,
                  styles.putCol,
                  isITMPut && styles.itmPutBg,
                ]}
                onPress={() => onSelectStrike(row.put, 'PUT')}
              >
                <Text style={styles.ltpPutText}>₹{row.put.ltp.toFixed(1)}</Text>
                <Text style={styles.oiText}>{(row.put.oi / 100000).toFixed(1)}L</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  indexBar: {
    flexDirection: 'row',
    padding: 8,
    gap: 6,
    backgroundColor: '#1E293B',
  },
  indexChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  indexChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  metaBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  spotLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
  },
  spotValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  expiryList: {
    gap: 6,
    alignItems: 'center',
  },
  expiryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  expiryChipActive: {
    backgroundColor: '#38BDF8',
  },
  expiryChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  callCol: {
    flex: 2,
    alignItems: 'center',
  },
  strikeCol: {
    flex: 1.2,
    alignItems: 'center',
  },
  putCol: {
    flex: 2,
    alignItems: 'center',
  },
  colHeaderCall: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 11,
  },
  colHeaderStrike: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 11,
  },
  colHeaderPut: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 11,
  },
  subHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '90%',
    marginTop: 2,
  },
  subHeaderText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '600',
  },
  strikeList: {
    flex: 1,
  },
  dataRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    minHeight: 44,
  },
  atmRow: {
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  sideCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  itmCallBg: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  itmPutBg: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  strikeCell: {
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#334155',
  },
  strikeText: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 13,
  },
  atmStrikeText: {
    color: '#F59E0B',
  },
  atmBadge: {
    backgroundColor: '#F59E0B',
    color: '#000000',
    fontSize: 8,
    fontWeight: '900',
    paddingHorizontal: 4,
    borderRadius: 3,
    marginTop: 1,
  },
  oiText: {
    color: '#64748B',
    fontSize: 11,
  },
  ltpCallText: {
    color: '#34D399',
    fontWeight: '700',
    fontSize: 13,
  },
  ltpPutText: {
    color: '#F87171',
    fontWeight: '700',
    fontSize: 13,
  },
});
