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
 * Switch Libera/Ufficiale + pagina/i a fianco.
 * Con più leghe: tutte le carte in lista, selezionabili.
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

function TeamPip({ team, size = 26 }) {
  const path = String(team?.logo_path || '').trim();
  const dim = { width: size, height: size, borderRadius: Math.round(size * 0.27) };
  if (path) {
    return (
      <TeamLogoImage
        logoPath={path}
        style={dim}
        fallbackStyle={[styles.logoFallback, dim, { backgroundColor: `${team.jersey_color || '#667eea'}22` }]}
        fallbackIconSize={Math.round(size * 0.5)}
      />
    );
  }
  const color = team?.jersey_color || '#667eea';
  return (
    <View style={[styles.logoFallback, dim, { backgroundColor: `${color}28`, borderColor: `${color}55` }]}>
      <View style={[styles.logoDot, { backgroundColor: color }]} />
    </View>
  );
}

function LeaguePageCard({ league, selected, onPress, compact }) {
  const logos = Array.isArray(league?.team_logos) ? league.team_logos.slice(0, compact ? 5 : 8) : [];
  const players = Number(league?.player_count) || 0;
  const teams = Number(league?.team_count) || 0;
  const logoSize = compact ? 22 : 26;

  return (
    <TouchableOpacity
      style={[styles.page, styles.pageSheet, selected && styles.pageSelected]}
      onPress={onPress}
      activeOpacity={onPress ? 0.88 : 1}
      disabled={!onPress}
    >
      <View style={styles.pageInner}>
        <View style={styles.pageTopRow}>
          <View style={styles.pageTitleCol}>
            <Text style={styles.pageTitle} numberOfLines={1}>
              {league?.name || 'Lega ufficiale'}
            </Text>
            {league?.official_group_name ? (
              <Text style={styles.pageGroup} numberOfLines={1}>
                {league.official_group_name}
              </Text>
            ) : null}
          </View>
          {onPress ? (
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
          ) : null}
        </View>

        <View style={styles.logoGrid}>
          {logos.length > 0
            ? logos.map((t, i) => (
                <TeamPip key={`${t.name || 't'}-${i}`} team={t} size={logoSize} />
              ))
            : Array.from({ length: Math.min(6, Math.max(teams, 4)) }).map((_, i) => (
                <View key={`ph-${i}`} style={[styles.logoFallback, { width: logoSize, height: logoSize }]}>
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
    </TouchableOpacity>
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
  const list = Array.isArray(leagues) ? leagues : [];
  const selected = useMemo(
    () => list.find((l) => l.id === selectedId) || list[0] || null,
    [list, selectedId]
  );
  const multi = list.length > 1;

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

        <View style={styles.pagesCol}>
          {!enabled ? (
            <View style={[styles.page, styles.pageSheet]}>
              <BlankPage />
            </View>
          ) : loading && list.length === 0 ? (
            <View style={[styles.page, styles.pageSheet, styles.pageCenter]}>
              <ActivityIndicator size="small" color="#78716c" />
            </View>
          ) : list.length === 0 ? (
            <View style={[styles.page, styles.pageSheet, styles.pageCenter]}>
              <Text style={styles.emptyMini}>Nessuna lega</Text>
            </View>
          ) : multi ? (
            list.map((league) => {
              const isOn = selected?.id === league.id;
              return (
                <LeaguePageCard
                  key={league.id}
                  league={league}
                  selected={isOn}
                  compact
                  onPress={() => onSelect?.(league)}
                />
              );
            })
          ) : (
            <LeaguePageCard league={selected} selected />
          )}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

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
    alignSelf: 'stretch',
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
  pagesCol: {
    flex: 1,
    gap: 8,
  },
  page: {
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    minHeight: 120,
  },
  pageSheet: {
    backgroundColor: '#fffef8',
    borderColor: '#e7e2d6',
  },
  pageSelected: {
    borderColor: '#a8a29e',
    backgroundColor: '#f7f3ea',
  },
  pageCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  pageInner: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  pageTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  pageTitleCol: {
    flex: 1,
    minWidth: 0,
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
    marginTop: 14,
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
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#d6d0c0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: {
    borderColor: '#78716c',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#57534e',
  },
  logoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  logoFallback: {
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
    fontSize: 12,
    fontWeight: '600',
    color: '#a8a29e',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
