import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TeamLogoImage } from '../StableCachedImage';

/**
 * Switch Libera/Ufficiale + pagina a fianco.
 * Con più leghe: indice sotto, stessa carta crema (niente chip blu).
 */
function BlankPage() {
  return (
    <View style={styles.pageInner}>
      <Text style={styles.blankCopy}>
        Crea e gestisci i tuoi giocatori, squadre e voti
      </Text>

      <View style={styles.emptySlots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={`slot-${i}`} style={styles.emptySlot}>
            <Ionicons name="add" size={12} color="#c4bda8" />
          </View>
        ))}
      </View>

      <View style={styles.ruledBlock}>
        {[0.88, 0.7, 0.5].map((w, i) => (
          <View
            key={`line-${i}`}
            style={[styles.ruledLine, { width: `${w * 100}%` }]}
          />
        ))}
      </View>
    </View>
  );
}

function TeamPip({ team }) {
  const path = String(team?.logo_path || '').trim();
  if (path) {
    return (
      <TeamLogoImage
        logoPath={path}
        style={styles.logo}
        fallbackStyle={[styles.logoFallback, { backgroundColor: `${team.jersey_color || '#667eea'}22` }]}
        fallbackIconSize={14}
      />
    );
  }
  const color = team?.jersey_color || '#667eea';
  return (
    <View style={[styles.logoFallback, { backgroundColor: `${color}28`, borderColor: `${color}55` }]}>
      <View style={[styles.logoDot, { backgroundColor: color }]} />
    </View>
  );
}

function MiniLogos({ league, max = 4 }) {
  const logos = Array.isArray(league?.team_logos) ? league.team_logos.slice(0, max) : [];
  if (logos.length === 0) {
    return (
      <View style={styles.miniLogoRow}>
        {[0, 1, 2].map((i) => (
          <View key={`m-${i}`} style={styles.miniLogoPh} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.miniLogoRow}>
      {logos.map((t, i) => (
        <View key={`${t.name || 't'}-${i}`} style={styles.miniLogoWrap}>
          <TeamPip team={t} />
        </View>
      ))}
    </View>
  );
}

function FilledPage({ league }) {
  const logos = Array.isArray(league?.team_logos) ? league.team_logos.slice(0, 8) : [];
  const players = Number(league?.player_count) || 0;
  const teams = Number(league?.team_count) || 0;

  return (
    <View style={styles.pageInner}>
      <Text style={styles.pageTitle} numberOfLines={1}>
        {league?.name || 'Lega ufficiale'}
      </Text>
      {league?.official_group_name ? (
        <Text style={styles.pageGroup} numberOfLines={1}>
          {league.official_group_name}
        </Text>
      ) : null}

      <View style={styles.logoGrid}>
        {logos.length > 0
          ? logos.map((t, i) => (
              <TeamPip key={`${t.name || 't'}-${i}`} team={t} />
            ))
          : Array.from({ length: Math.min(6, Math.max(teams, 4)) }).map((_, i) => (
              <View key={`ph-${i}`} style={styles.logoFallback}>
                <View style={styles.logoDot} />
              </View>
            ))}
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statValue}>{players}</Text>
        <Text style={styles.statLabel}>giocatori</Text>
        <Text style={styles.statSep}>·</Text>
        <Text style={styles.statValue}>{teams}</Text>
        <Text style={styles.statLabel}>squadre</Text>
      </View>
    </View>
  );
}

function LeagueIndex({ leagues, selectedId, onSelect }) {
  return (
    <View style={styles.indexSheet}>
      <Text style={styles.indexLabel}>Scegli quale collegare</Text>
      {leagues.map((league, idx) => {
        const on = selectedId === league.id || (!selectedId && idx === 0);
        const players = Number(league.player_count) || 0;
        return (
          <TouchableOpacity
            key={league.id}
            style={[
              styles.indexRow,
              on && styles.indexRowOn,
              idx === leagues.length - 1 && styles.indexRowLast,
            ]}
            onPress={() => onSelect?.(league)}
            activeOpacity={0.85}
          >
            <View style={[styles.indexMark, on && styles.indexMarkOn]} />
            <View style={styles.indexCopy}>
              <Text style={[styles.indexName, on && styles.indexNameOn]} numberOfLines={1}>
                {league.name}
              </Text>
              <Text style={styles.indexMeta} numberOfLines={1}>
                {[league.official_group_name, players ? `${players} giocatori` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <MiniLogos league={league} />
          </TouchableOpacity>
        );
      })}
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
  const selected = useMemo(
    () => leagues.find((l) => l.id === selectedId) || leagues[0] || null,
    [leagues, selectedId]
  );
  const multi = enabled && leagues.length > 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.switchRail}>
          <TouchableOpacity
            style={[styles.switchOpt, !enabled && styles.switchOptOnFree]}
            onPress={() => onToggle(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.switchText, !enabled && styles.switchTextOnFree]}>Libera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchOpt, styles.switchOptRow, enabled && styles.switchOptOnOff]}
            onPress={() => onToggle(true)}
            activeOpacity={0.85}
          >
            <Ionicons
              name="link"
              size={14}
              color={enabled ? '#1e3a8a' : '#94a3b8'}
            />
            <Text style={[styles.switchText, enabled && styles.switchTextOnOff]}>Ufficiale</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.page, styles.pageSheet]}>
          {enabled ? (
            loading && !selected ? (
              <ActivityIndicator size="small" color="#78716c" style={{ marginTop: 28 }} />
            ) : selected ? (
              <FilledPage league={selected} />
            ) : (
              <Text style={styles.emptyMini}>Nessuna lega</Text>
            )
          ) : (
            <BlankPage />
          )}
        </View>
      </View>

      {multi ? (
        <LeagueIndex
          leagues={leagues}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const PAGE_H = 132;

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  switchRail: {
    width: 100,
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 4,
    justifyContent: 'space-between',
  },
  switchOpt: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  switchOptRow: {
    flexDirection: 'row',
    gap: 4,
  },
  switchOptOnFree: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#86efac',
  },
  switchOptOnOff: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#a5b4fc',
  },
  switchText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
  },
  switchTextOnFree: {
    color: '#166534',
  },
  switchTextOnOff: {
    color: '#1e3a8a',
  },
  page: {
    flex: 1,
    minHeight: PAGE_H,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  pageSheet: {
    backgroundColor: '#fffef8',
    borderColor: '#e7e2d6',
  },
  pageInner: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  blankCopy: {
    fontSize: 13,
    fontWeight: '600',
    color: '#78716c',
    lineHeight: 18,
  },
  emptySlots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  emptySlot: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#d6d0c0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#faf8f1',
  },
  ruledBlock: {
    marginTop: 'auto',
    paddingTop: 10,
    gap: 8,
  },
  ruledLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ded8ca',
  },
  pageTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#57534e',
  },
  pageGroup: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#a8a29e',
  },
  logoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  logo: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  logoFallback: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#faf8f1',
    borderWidth: 1,
    borderColor: '#e7e2d6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a8a29e',
  },
  statRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingTop: 8,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#57534e',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#a8a29e',
  },
  statSep: {
    fontSize: 12,
    color: '#d6d3d1',
    marginHorizontal: 2,
  },
  emptyMini: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 12,
    fontWeight: '600',
    color: '#a8a29e',
  },
  indexSheet: {
    marginTop: 8,
    backgroundColor: '#fffef8',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e7e2d6',
    paddingTop: 10,
    paddingBottom: 4,
    overflow: 'hidden',
  },
  indexLabel: {
    paddingHorizontal: 12,
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#a8a29e',
    letterSpacing: 0.2,
  },
  indexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e7e2d6',
  },
  indexRowOn: {
    backgroundColor: '#f5f0e6',
  },
  indexRowLast: {},
  indexMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#d6d0c0',
    backgroundColor: 'transparent',
  },
  indexMarkOn: {
    backgroundColor: '#78716c',
    borderColor: '#78716c',
  },
  indexCopy: {
    flex: 1,
    minWidth: 0,
  },
  indexName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78716c',
  },
  indexNameOn: {
    color: '#44403c',
  },
  indexMeta: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '500',
    color: '#a8a29e',
  },
  miniLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniLogoWrap: {
    marginLeft: -4,
    transform: [{ scale: 0.85 }],
  },
  miniLogoPh: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: '#ebe6da',
    marginLeft: 3,
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
