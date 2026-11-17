import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import { OptionChainTable } from '../components/OptionChainTable';
import { DhanApiService } from '../services/dhanApi';
import {
  DhanWebSocketService,
  BatchInstrument,
  MarketTick,
} from '../services/dhanWebSocket';
import { OptionChainData, OptionContract } from '../types/dhan';
import { SUPPORTED_INDICES } from '../constants/indices';

const WS_UI_FLUSH_MS = 120;          // 120ms coalesced UI flush for 60 FPS zero-lag streaming
const OI_GREEKS_REFRESH_MS = 15000;  // Silent background REST sync for OI & Greeks every 15s

interface OptionChainScreenProps {
  onSelectStrike: (contract: OptionContract, type: 'CALL' | 'PUT') => void;
}

function formatTimeHHMMSS(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function applyTickToContract(contract: OptionContract, tick: MarketTick): OptionContract {
  const nextLtp = tick.ltp;
  const prevClose = contract.previousClose > 0 ? contract.previousClose : nextLtp;
  const nextChange = Number((nextLtp - prevClose).toFixed(2));
  const nextChangePct =
    prevClose > 0 ? Number(((nextChange / prevClose) * 100).toFixed(2)) : contract.changePercent;

  return {
    ...contract,
    ltp: nextLtp,
    change: nextChange,
    changePercent: nextChangePct,
    volume: tick.volume !== undefined ? tick.volume : contract.volume,
    oi: tick.oi !== undefined ? tick.oi : contract.oi,
  };
}

export const OptionChainScreen: React.FC<OptionChainScreenProps> = ({
  onSelectStrike,
}) => {
  const [selectedIndex, setSelectedIndex] = useState('NIFTY');
  const [chainData, setChainData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLiveWs, setIsLiveWs] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const isFetchingRef = useRef(false);
  const requestVersionRef = useRef(0);
  const selectedExpiryRef = useRef<string | undefined>(undefined);
  const pendingTicksRef = useRef<Map<string, MarketTick>>(new Map());
  const latestLiveLtpMapRef = useRef<Map<string, number>>(new Map());
  const spotSecurityIdRef = useRef<string>('');
  const latestSpotLtpRef = useRef<number | null>(null);

  const loadChain = useCallback(
    async (indexKey: string, expiry?: string, silentOiRefresh: boolean = false) => {
      if (silentOiRefresh && isFetchingRef.current) {
        return;
      }

      const reqVersion = ++requestVersionRef.current;
      isFetchingRef.current = true;

      if (!silentOiRefresh) {
        setLoading(true);
      }

      try {
        const isDemo = await DhanApiService.isDemoMode();

        // In Demo mode during 15s background OI refresh, keep live WS LTPs & subtly refresh OI
        if (silentOiRefresh && isDemo) {
          if (reqVersion === requestVersionRef.current) {
            setChainData((prev) => {
              if (!prev || prev.underlying !== indexKey) return prev;
              return {
                ...prev,
                strikes: prev.strikes.map((row) => {
                  const ceOiDelta = Math.round((Math.random() - 0.45) * 4500);
                  const peOiDelta = Math.round((Math.random() - 0.45) * 4500);
                  return {
                    ...row,
                    call: {
                      ...row.call,
                      oi: Math.max(0, row.call.oi + ceOiDelta),
                      oiChange: row.call.oiChange + ceOiDelta,
                    },
                    put: {
                      ...row.put,
                      oi: Math.max(0, row.put.oi + peOiDelta),
                      oiChange: row.put.oiChange + peOiDelta,
                    },
                  };
                }),
              };
            });
          }
          return;
        }

        const rawData = await DhanApiService.getOptionChain(indexKey, expiry);
        if (reqVersion !== requestVersionRef.current) return;

        // Deduplicate expiryDates defensively so React keys are always unique
        const data: OptionChainData = {
          ...rawData,
          expiryDates: Array.from(new Set(rawData.expiryDates || [])),
        };

        selectedExpiryRef.current = expiry || data.selectedExpiry;

        if (silentOiRefresh) {
          // Merge fresh REST OI & Greeks while preserving the latest zero-lag WS LTPs
          const mergedStrikes = data.strikes.map((row) => {
            const liveCe = latestLiveLtpMapRef.current.get(row.call.securityId);
            const livePe = latestLiveLtpMapRef.current.get(row.put.securityId);
            return {
              ...row,
              call:
                liveCe !== undefined
                  ? applyTickToContract(row.call, {
                      securityId: row.call.securityId,
                      exchangeSegment: row.call.exchangeSegment,
                      ltp: liveCe,
                    })
                  : row.call,
              put:
                livePe !== undefined
                  ? applyTickToContract(row.put, {
                      securityId: row.put.securityId,
                      exchangeSegment: row.put.exchangeSegment,
                      ltp: livePe,
                    })
                  : row.put,
            };
          });

          setChainData({
            ...data,
            underlyingLtp:
              latestSpotLtpRef.current !== null ? latestSpotLtpRef.current : data.underlyingLtp,
            strikes: mergedStrikes,
          });
        } else {
          // Fresh index or expiry switch: clear stale WS buffers
          pendingTicksRef.current.clear();
          latestLiveLtpMapRef.current.clear();
          latestSpotLtpRef.current = null;
          setChainData(data);
          setLastUpdated(formatTimeHHMMSS(new Date()));
        }
      } catch (e) {
        if (!silentOiRefresh) {
          console.error('Failed to load option chain:', e);
        }
      } finally {
        isFetchingRef.current = false;
        if (!silentOiRefresh && reqVersion === requestVersionRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  // Load REST snapshot ONCE on mount & index switch
  useEffect(() => {
    selectedExpiryRef.current = undefined;
    loadChain(selectedIndex, undefined, false);
  }, [selectedIndex, loadChain]);

  // Silent 15-second background REST refresh for OI & Greeks only
  useEffect(() => {
    if (!isLiveWs) return;

    const timer = setInterval(() => {
      loadChain(selectedIndex, selectedExpiryRef.current, true);
    }, OI_GREEKS_REFRESH_MS);

    return () => clearInterval(timer);
  }, [isLiveWs, selectedIndex, loadChain]);

  // Stable key representing the active strike subscription set (does NOT change on LTP ticks!)
  const subscriptionSignature = useMemo(() => {
    if (!chainData || chainData.strikes.length === 0) return '';
    const ids = chainData.strikes
      .map((r) => `${r.call.securityId}:${r.put.securityId}`)
      .join(',');
    return `${chainData.underlying}|${chainData.selectedExpiry}|${ids}`;
  }, [
    chainData?.underlying,
    chainData?.selectedExpiry,
    // Re-evaluate only when strike count or boundary securityIds change
    chainData?.strikes.length,
    chainData?.strikes[0]?.call.securityId,
    chainData?.strikes[chainData?.strikes.length - 1]?.put.securityId,
  ]);

  const subscribedContractCount = chainData ? chainData.strikes.length * 2 : 0;

  // Keep latest chain snapshot in ref for building initial BatchInstrument list on signature change
  const chainSnapshotRef = useRef<OptionChainData | null>(null);
  chainSnapshotRef.current = chainData;

  // Zero-lag WebSocket batch subscription for ALL visible CE + PE strikes + underlying spot
  useEffect(() => {
    if (!isLiveWs || !subscriptionSignature) return;
    const snapshot = chainSnapshotRef.current;
    if (!snapshot || snapshot.strikes.length === 0) return;

    DhanWebSocketService.connect();

    const idxConfig = SUPPORTED_INDICES[snapshot.underlying] || SUPPORTED_INDICES.NIFTY;
    const isMockChain = snapshot.strikes[0]?.call.securityId.startsWith('MOCK_') ?? false;
    const spotSecId = isMockChain
      ? `MOCK_${snapshot.underlying}_SPOT`
      : idxConfig.underlyingSecurityId;
    spotSecurityIdRef.current = spotSecId;

    const batchInstruments: BatchInstrument[] = [
      {
        securityId: spotSecId,
        exchangeSegment: 'IDX_I',
        seedPrice: snapshot.underlyingLtp,
        requestCode: 15,
      },
    ];

    for (const row of snapshot.strikes) {
      batchInstruments.push({
        securityId: row.call.securityId,
        exchangeSegment: row.call.exchangeSegment,
        seedPrice: row.call.ltp,
        requestCode: 15,
      });
      batchInstruments.push({
        securityId: row.put.securityId,
        exchangeSegment: row.put.exchangeSegment,
        seedPrice: row.put.ltp,
        requestCode: 15,
      });
    }

    const handleTick = (tick: MarketTick) => {
      if (!tick || !Number.isFinite(tick.ltp) || tick.ltp <= 0) return;
      pendingTicksRef.current.set(tick.securityId, tick);
      if (tick.securityId === spotSecurityIdRef.current) {
        latestSpotLtpRef.current = tick.ltp;
      } else {
        latestLiveLtpMapRef.current.set(tick.securityId, tick.ltp);
      }
    };

    const unsubscribe = DhanWebSocketService.subscribeMany(batchInstruments, handleTick);

    // 120ms coalesced UI flush for buttery 60 FPS scrolling & zero-lag LTP streaming
    const flushTimer = setInterval(() => {
      if (pendingTicksRef.current.size === 0) return;

      const batch = new Map(pendingTicksRef.current);
      pendingTicksRef.current.clear();

      setChainData((prev) => {
        if (!prev) return prev;

        const spotTick = batch.get(spotSecurityIdRef.current);
        let changed = !!spotTick;

        const nextStrikes = prev.strikes.map((row) => {
          const ceTick = batch.get(row.call.securityId);
          const peTick = batch.get(row.put.securityId);
          if (!ceTick && !peTick) return row;

          changed = true;
          return {
            ...row,
            call: ceTick ? applyTickToContract(row.call, ceTick) : row.call,
            put: peTick ? applyTickToContract(row.put, peTick) : row.put,
          };
        });

        if (!changed) return prev;

        return {
          ...prev,
          underlyingLtp: spotTick ? spotTick.ltp : prev.underlyingLtp,
          strikes: nextStrikes,
        };
      });

      setLastUpdated(formatTimeHHMMSS(new Date()));
    }, WS_UI_FLUSH_MS);

    // Auto-unsubscribe previous index/expiry strikes cleanly on switch or unmount
    return () => {
      clearInterval(flushTimer);
      pendingTicksRef.current.clear();
      unsubscribe();
    };
  }, [isLiveWs, subscriptionSignature]);

  const handleSelectIndex = (idx: string) => {
    if (idx === selectedIndex) return;
    setSelectedIndex(idx);
  };

  const handleSelectExpiry = (exp: string) => {
    selectedExpiryRef.current = exp;
    loadChain(selectedIndex, exp, false);
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
      {/* Zero-Lag WebSocket Live Status Bar */}
      <View style={styles.liveBar}>
        <Text style={styles.liveMetaText}>
          {subscribedContractCount > 0 ? `${subscribedContractCount} strikes` : 'Option Chain'}
          {lastUpdated ? ` • ${lastUpdated}` : ''}
        </Text>

        <View style={styles.liveActions}>
          <TouchableOpacity
            style={[
              styles.livePill,
              isLiveWs ? styles.livePillActive : styles.livePillPaused,
            ]}
            onPress={() => setIsLiveWs((prev) => !prev)}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.livePillText,
                isLiveWs ? styles.livePillTextActive : styles.livePillTextPaused,
              ]}
            >
              {isLiveWs ? '⚡ LIVE WS' : '○ PAUSED'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {chainData && (
        <OptionChainTable
          chainData={chainData}
          selectedIndex={selectedIndex}
          onSelectIndex={handleSelectIndex}
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
  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0B1220',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  liveMetaText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  liveActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  livePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  livePillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: 'rgba(16, 185, 129, 0.55)',
  },
  livePillPaused: {
    backgroundColor: 'rgba(100, 116, 139, 0.16)',
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  livePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  livePillTextActive: {
    color: '#10B981',
  },
  livePillTextPaused: {
    color: '#94A3B8',
  },
});
