import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface HeaderProps {
  isDemoMode: boolean;
  todayPnl: number;
  hasUpdate: boolean;
  onPressUpdate?: () => void;
  onPressSettings: () => void;
  activeScreenTitle: string;
}

export const Header: React.FC<HeaderProps> = ({
  isDemoMode,
  todayPnl,
  hasUpdate,
  onPressUpdate,
  onPressSettings,
  activeScreenTitle,
}) => {
  const isPnlPositive = todayPnl >= 0;

  return (
    <View style={styles.header}>
      {/* Left: App Title and Live/Demo badge */}
      <View style={styles.leftSection}>
        <Text style={styles.title} numberOfLines={1}>
          DHAN TRADER
        </Text>
        <View
          style={[
            styles.modeBadge,
            isDemoMode ? styles.demoBadge : styles.liveBadge,
          ]}
        >
          <View
            style={[
              styles.modeDot,
              isDemoMode ? styles.demoDot : styles.liveDot,
            ]}
          />
          <Text
            style={[
              styles.modeText,
              isDemoMode ? styles.demoText : styles.liveText,
            ]}
            numberOfLines={1}
          >
            {isDemoMode ? 'DEMO' : 'LIVE'}
          </Text>
        </View>
      </View>

      {/* Middle: Screen Title */}
      <Text style={styles.screenTitle} numberOfLines={1} ellipsizeMode="tail">
        {activeScreenTitle}
      </Text>

      {/* Right: P&L + Update pill + Settings */}
      <View style={styles.rightSection}>
        {hasUpdate && (
          <TouchableOpacity style={styles.updateBadge} onPress={onPressUpdate}>
            <Text style={styles.updateBadgeText} numberOfLines={1}>
              ⚡ UPDATE
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.pnlBox}>
          <Text style={styles.pnlLabel} numberOfLines={1}>
            DAY MTM
          </Text>
          <Text
            style={[
              styles.pnlValue,
              isPnlPositive ? styles.profitText : styles.lossText,
            ]}
            numberOfLines={1}
          >
            {isPnlPositive ? '+' : ''}₹{todayPnl.toFixed(0)}
          </Text>
        </View>

        <TouchableOpacity style={styles.iconBtn} onPress={onPressSettings}>
          <Text style={styles.iconBtnText} numberOfLines={1}>
            ⚙️
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 52,
    flexShrink: 0,
    overflow: 'hidden',
    backgroundColor: '#0B1120',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
  },
  title: {
    color: '#F8FAFC',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.4,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  liveBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  demoBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveDot: {
    backgroundColor: '#10B981',
  },
  demoDot: {
    backgroundColor: '#F59E0B',
  },
  modeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  liveText: {
    color: '#10B981',
  },
  demoText: {
    color: '#F59E0B',
  },
  screenTitle: {
    flex: 1,
    flexShrink: 1,
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 6,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
  },
  updateBadge: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  updateBadgeText: {
    color: '#0F172A',
    fontSize: 9,
    fontWeight: '900',
  },
  pnlBox: {
    alignItems: 'flex-end',
    minWidth: 58,
  },
  pnlLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 10,
  },
  pnlValue: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 15,
    minWidth: 58,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  profitText: {
    color: '#10B981',
  },
  lossText: {
    color: '#EF4444',
  },
  iconBtn: {
    padding: 5,
    backgroundColor: '#1E293B',
    borderRadius: 6,
  },
  iconBtnText: {
    fontSize: 14,
    lineHeight: 16,
  },
});
