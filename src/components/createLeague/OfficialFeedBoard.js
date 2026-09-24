import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { TeamLogoImage } from '../StableCachedImage';

/**
 * Switch custom Libera/Ufficiale + “pagina” a fianco:
 * vuota (righe da scrivere) oppure piena (loghi + n. giocatori).
 */
function BlankPage() {
  return (
    <View style={styles.pageInner}>
      <View style={styles.pageHeaderLine} />
      {[0.92, 0.78, 0.85, 0.55, 0.7].map((w, i) => (
        <View
          key={`line-${i}`}
          style={[styles.ruledLine, { width: `${w * 100}%`, marginTop: i === 0 ? 14 : 10 }]}
        />
      ))}
      <Text style={styles.blankHint}>Pagina vuota</Text>
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

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {/* Switch custom verticale */}
        <View style={styles.switchRail}>
          <TouchableOpacity
            style={[styles.switchOpt, !enabled && styles.switchOptOnFree]}
            onPress={() => onToggle(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.switchText, !enabled && styles.switchTextOnFree]}>Libera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.switchOpt, enabled && styles.switchOptOnOff]}
            onPress={() => onToggle(true)}
            activeOpacity={0.85}
          >
            <Text style={[styles.switchText, enabled && styles.switchTextOnOff]}>Ufficiale</Text>
          </TouchableOpacity>
        </View>

        {/* Pagina finta */}
        <View style={[styles.page, enabled ? styles.pageFilled : styles.pageBlank]}>
          {enabled ? (
            loading && !selected ? (
              <ActivityIndicator size="small" color="#667eea" style={{ marginTop: 28 }} />
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

      {enabled && leagues.length > 1 ? (
        <View style={styles.chips}>
          {leagues.map((league) => {
            const on = selectedId === league.id;
            return (
              <TouchableOpacity
                key={league.id}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => onSelect?.(league)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                  {league.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
    width: 92,
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
  pageBlank: {
    backgroundColor: '#fffef8',
    borderColor: '#e7e2d6',
  },
  pageFilled: {
    backgroundColor: '#fff',
    borderColor: '#c7d2fe',
  },
  pageInner: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  pageHeaderLine: {
    height: 8,
    width: '42%',
    borderRadius: 4,
    backgroundColor: '#e8e4d8',
  },
  ruledLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ded8ca',
  },
  blankHint: {
    marginTop: 'auto',
    fontSize: 11,
    fontWeight: '600',
    color: '#b0a890',
  },
  pageTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  pageGroup: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#818cf8',
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
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94a3b8',
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
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  statSep: {
    fontSize: 12,
    color: '#cbd5e1',
    marginHorizontal: 2,
  },
  emptyMini: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    maxWidth: '48%',
  },
  chipOn: {
    backgroundColor: '#eef2ff',
    borderColor: '#a5b4fc',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  chipTextOn: {
    color: '#1e3a8a',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
