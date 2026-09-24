import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import Svg, {
  Path,
  Circle,
  Rect,
  Defs,
  LinearGradient,
  Stop,
  G,
} from 'react-native-svg';

/**
 * Scudetto / feed LED: Rosa libera vs Lega ufficiale.
 * Stesso linguaggio immersivo di accesso/tornelli, metafora nuova (crest + segnale).
 */
function CrestGlyph({ lit = false, size = 56, gid = 'crest' }) {
  const stroke = lit ? '#1e3a8a' : '#94a3b8';
  const fill = lit ? `url(#${gid})` : '#f1f5f9';
  const star = lit ? '#fbbf24' : '#cbd5e1';

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#818cf8" />
          <Stop offset="1" stopColor="#4338ca" />
        </LinearGradient>
      </Defs>
      <Path
        d="M32 6 C22 6 14 10 12 14 L12 34 C12 46 20 54 32 58 C44 54 52 46 52 34 L52 14 C50 10 42 6 32 6 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={lit ? 2.2 : 1.8}
      />
      {lit ? (
        <G>
          <Path
            d="M32 18 L34.2 24.2 L40.8 24.4 L35.6 28.4 L37.4 34.8 L32 31.2 L26.6 34.8 L28.4 28.4 L23.2 24.4 L29.8 24.2 Z"
            fill={star}
          />
          <Rect x="24" y="40" width="16" height="3.5" rx="1.75" fill="#c7d2fe" opacity={0.9} />
        </G>
      ) : (
        <G opacity={0.55}>
          <Circle cx="32" cy="28" r="6" fill="none" stroke={stroke} strokeWidth={1.6} strokeDasharray="3 3" />
          <Rect x="24" y="40" width="16" height="3.5" rx="1.75" fill={stroke} opacity={0.35} />
        </G>
      )}
    </Svg>
  );
}

function SignalBars({ active }) {
  const heights = [8, 12, 16, 20];
  return (
    <View style={styles.signalRow}>
      {heights.map((h, i) => (
        <View
          key={`bar-${i}`}
          style={[
            styles.signalBar,
            { height: h },
            active ? styles.signalBarOn : styles.signalBarOff,
            active && i < 3 ? null : active ? { opacity: 0.35 } : null,
          ]}
        />
      ))}
    </View>
  );
}

export default function OfficialFeedBoard({
  enabled,
  onToggle,
  leagues = [],
  loading = false,
  selectedId,
  onSelect,
  error,
}) {
  const pulse = useRef(new Animated.Value(enabled ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(pulse, {
      toValue: enabled ? 1 : 0,
      friction: 8,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [enabled, pulse]);

  const boardScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.segBtn, !enabled && styles.segBtnOnFree]}
          onPress={() => onToggle(false)}
          activeOpacity={0.85}
        >
          <View style={[styles.miniCrest, !enabled && styles.miniCrestFree]}>
            <CrestGlyph lit={false} size={36} gid="crestMiniFree" />
          </View>
          <Text style={[styles.segTitle, !enabled && styles.segTitleOnFree]}>Libera</Text>
          <Text style={[styles.segSub, !enabled && styles.segSubOnFree]}>Rosa tua</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segBtn, enabled && styles.segBtnOnOfficial]}
          onPress={() => onToggle(true)}
          activeOpacity={0.85}
        >
          <View style={[styles.miniCrest, enabled && styles.miniCrestOfficial]}>
            <CrestGlyph lit size={36} gid="crestMiniOfficial" />
          </View>
          <Text style={[styles.segTitle, enabled && styles.segTitleOnOfficial]}>Ufficiale</Text>
          <Text style={[styles.segSub, enabled && styles.segSubOnOfficial]}>Voti e rosa</Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        style={[
          styles.board,
          enabled ? styles.boardOn : styles.boardOff,
          { transform: [{ scale: boardScale }] },
        ]}
      >
        <View style={styles.boardTop}>
          <View style={styles.boardLedRow}>
            <View style={[styles.ledDot, enabled && styles.ledDotOn]} />
            <View style={[styles.ledDot, enabled && styles.ledDotOn]} />
            <View style={[styles.ledDot, enabled && styles.ledDotOn]} />
          </View>
          <Text style={[styles.boardEyebrow, enabled && styles.boardEyebrowOn]}>
            {enabled ? 'FEED CAMPIONATO' : 'SENZA FEED'}
          </Text>
          <SignalBars active={enabled} />
        </View>

        <View style={styles.boardBody}>
          <CrestGlyph lit={enabled} size={64} gid="crestBoardMain" />
          <View style={styles.boardCopy}>
            <Text style={[styles.boardTitle, enabled && styles.boardTitleOn]}>
              {enabled ? 'Collegata al tabellone' : 'Rosa indipendente'}
            </Text>
            <Text style={styles.boardHint}>
              {enabled
                ? 'Giocatori e voti dalla lega ufficiale'
                : 'Niente collegamento al campionato'}
            </Text>
          </View>
        </View>

        {enabled ? (
          <View style={styles.channels}>
            {loading ? (
              <ActivityIndicator size="small" color="#4338ca" style={{ paddingVertical: 14 }} />
            ) : leagues.length === 0 ? (
              <Text style={styles.empty}>Nessuna lega ufficiale disponibile</Text>
            ) : (
              leagues.map((league) => {
                const selected = selectedId === league.id;
                return (
                  <TouchableOpacity
                    key={league.id}
                    style={[styles.channel, selected && styles.channelOn]}
                    onPress={() => onSelect?.(league)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.channelPip, selected && styles.channelPipOn]} />
                    <View style={styles.channelCopy}>
                      <Text style={[styles.channelName, selected && styles.channelNameOn]}>
                        {league.name}
                      </Text>
                      {league.official_group_name ? (
                        <Text style={styles.channelGroup}>{league.official_group_name}</Text>
                      ) : null}
                      <Text style={styles.channelMeta}>
                        {league.team_count} squadre · {league.player_count} giocatori
                      </Text>
                    </View>
                    <Text style={[styles.channelMark, selected && styles.channelMarkOn]}>
                      {selected ? 'ON' : '—'}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        ) : null}
      </Animated.View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  segment: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  segBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  segBtnOnFree: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  segBtnOnOfficial: {
    borderColor: '#a5b4fc',
    backgroundColor: '#eef2ff',
  },
  miniCrest: {
    marginBottom: 6,
    opacity: 0.55,
  },
  miniCrestFree: {
    opacity: 1,
  },
  miniCrestOfficial: {
    opacity: 1,
  },
  segTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#94a3b8',
  },
  segTitleOnFree: {
    color: '#166534',
  },
  segTitleOnOfficial: {
    color: '#1e3a8a',
  },
  segSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  segSubOnFree: {
    color: '#4ade80',
  },
  segSubOnOfficial: {
    color: '#818cf8',
  },
  board: {
    borderRadius: 16,
    borderWidth: 1.5,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  boardOff: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  boardOn: {
    backgroundColor: '#0f172a',
    borderColor: '#312e81',
  },
  boardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  boardLedRow: {
    flexDirection: 'row',
    gap: 4,
  },
  ledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
  },
  ledDotOn: {
    backgroundColor: '#4ade80',
  },
  boardEyebrow: {
    flex: 1,
    marginHorizontal: 10,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#94a3b8',
  },
  boardEyebrowOn: {
    color: '#a5b4fc',
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 20,
  },
  signalBar: {
    width: 4,
    borderRadius: 2,
  },
  signalBarOff: {
    backgroundColor: '#cbd5e1',
  },
  signalBarOn: {
    backgroundColor: '#34d399',
  },
  boardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  boardCopy: {
    flex: 1,
  },
  boardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 2,
  },
  boardTitleOn: {
    color: '#f8fafc',
  },
  boardHint: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
    lineHeight: 16,
  },
  channels: {
    marginTop: 12,
    gap: 8,
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(165,180,252,0.25)',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  channelOn: {
    backgroundColor: 'rgba(99,102,241,0.22)',
    borderColor: '#818cf8',
  },
  channelPip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#475569',
  },
  channelPipOn: {
    backgroundColor: '#4ade80',
  },
  channelCopy: {
    flex: 1,
  },
  channelName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  channelNameOn: {
    color: '#fff',
  },
  channelGroup: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#a5b4fc',
  },
  channelMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
  },
  channelMark: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  channelMarkOn: {
    color: '#4ade80',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
