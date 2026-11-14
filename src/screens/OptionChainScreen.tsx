import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { OptionChainTable } from '../components/OptionChainTable';
import { DhanApiService } from '../services/dhanApi';
import { OptionChainData, OptionContract } from '../types/dhan';

interface OptionChainScreenProps {
  onSelectStrike: (contract: OptionContract, type: 'CALL' | 'PUT') => void;
}

export const OptionChainScreen: React.FC<OptionChainScreenProps> = ({
  onSelectStrike,
}) => {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY');
  const [chainData, setChainData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadChain = async (indexKey: string, expiry?: string) => {
    try {
      setLoading(true);
      const data = await DhanApiService.getOptionChain(indexKey, expiry);
      setChainData(data);
    } catch (e) {
      console.error('Failed to load option chain:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChain(selectedIndex);
  }, [selectedIndex]);

  const handleSelectExpiry = (exp: string) => {
    loadChain(selectedIndex, exp);
  };

  if (loading && !chainData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {chainData && (
        <OptionChainTable
          chainData={chainData}
          selectedIndex={selectedIndex}
          onSelectIndex={(idx) => setSelectedIndex(idx)}
          onSelectExpiry={handleSelectExpiry}
          onSelectStrike={onSelectStrike}
        />
      )}
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
    alignItems: 'center',
    justifyContent: 'center',
  },
});
