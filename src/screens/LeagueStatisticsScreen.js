import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { leagueService } from '../services/api';
import { FantasyTeamLogoImage, PlayerPhotoImage } from '../components/StableCachedImage';
import { formatVoteRating } from '../utils/voteRating';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };

function playerLabel(player) {
  const first = String(player?.first_name || '').trim();
  const last = String(player?.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || 'Giocatore';
}

function StatSection({ title, subtitle, icon, accentColor, children, emptyText }) {
  const hasContent = React.Children.count(children) > 0;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconWrap, { backgroundColor: `${accentColor}18` }]}>
          <Ionicons name={icon} size={20} color={accentColor} />
        </View>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.sectionBody}>
        {hasContent ? children : (
          <Text style={styles.emptyText}>{emptyText}</Text>
        )}
      </View>
    </View>
  );
}

function PlayerRow({ rank, player, valueLabel, valueColor = '#667eea' }) {
  const role = String(player?.role || '').trim().toUpperCase();
  const roleColor = ROLE_COLORS[role] || '#6c757d';
  return (
    <View style={styles.playerRow}>
      <Text style={styles.rankBadge}>{rank}</Text>
      {player?.photo_path ? (
        <View style={styles.playerPhotoCol}>
          <PlayerPhotoImage photoPath={player.photo_path} style={styles.playerPhotoBadge} />
          <View style={[styles.playerPhotoRoleOverlay, { backgroundColor: roleColor }]}>
            <Text style={styles.playerPhotoRoleText}>{role}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.roleBadgeCol}>
          <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
            <Text style={styles.roleBadgeMiniText}>{role}</Text>
          </View>
        </View>
      )}
      <View style={styles.playerInfo}>
        <Text style={styles.playerName} numberOfLines={1}>{playerLabel(player)}</Text>
        {player?.team_name ? (
          <Text style={styles.playerTeam} numberOfLines={1}>{player.team_name}</Text>
        ) : null}
      </View>
      <View style={styles.valueWrap}>
        <Text style={[styles.valueText, { color: valueColor }]}>{valueLabel}</Text>
        {player?.giornata ? (
          <Text style={styles.giornataHint}>G.{player.giornata}</Text>
        ) : null}
      </View>
    </View>
  );
}

function TeamHighlightCard({ item, variant }) {
  if (!item) return null;
  const isBest = variant === 'best';
  const accent = isBest ? '#2e7d32' : '#c62828';
  return (
    <View style={[styles.teamHighlight, { borderColor: `${accent}55` }]}>
      <View style={[styles.teamHighlightAccent, { backgroundColor: accent }]} />
      <FantasyTeamLogoImage teamLogo={item.team_logo} style={styles.teamLogo} />
      <View style={styles.teamHighlightBody}>
        <Text style={styles.teamHighlightName} numberOfLines={1}>{item.team_name}</Text>
        <Text style={styles.teamHighlightMeta}>
          {item.giornata}ª giornata · somma titolari
        </Text>
      </View>
      <Text style={[styles.teamHighlightScore, { color: accent }]}>
        {formatVoteRating(item.total_fantavoto)}
      </Text>
    </View>
  );
}

export default function LeagueStatisticsScreen({ route }) {
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [league, setLeague] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setError(null);
      const [leagueRes, statsRes] = await Promise.all([
        leagueService.getById(leagueId),
        leagueService.getStatistics(leagueId),
      ]);
      const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
      setLeague(leagueData);
      setStats(statsRes.data || null);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Impossibile caricare le statistiche';
      setError(msg);
      setStats(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !stats) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }} />
          <View style={{ flex: 2, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Statistiche</Text>
            {league?.name ? <Text style={styles.leagueName}>{league.name}</Text> : null}
          </View>
          <View style={{ flex: 1 }} />
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
            tintColor="#667eea"
          />
        )}
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#c62828" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <StatSection
          title="Più acquistati"
          subtitle="Top 5 giocatori con più proprietari"
          icon="bag-outline"
          accentColor="#667eea"
          emptyText="Nessun dato sul mercato."
        >
          {(stats?.most_purchased || []).map((player, index) => (
            <PlayerRow
              key={`most-${player.player_id}`}
              rank={index + 1}
              player={player}
              valueLabel={`${player.purchase_count}`}
              valueColor="#667eea"
            />
          ))}
        </StatSection>

        {(stats?.least_purchased || []).length > 0 ? (
          <StatSection
            title="Meno acquistati"
            subtitle="Top 5 con meno proprietari"
            icon="trending-down-outline"
            accentColor="#6c757d"
            emptyText="Nessun dato."
          >
            {(stats?.least_purchased || []).map((player, index) => (
              <PlayerRow
                key={`least-${player.player_id}`}
                rank={index + 1}
                player={player}
                valueLabel={`${player.purchase_count}`}
                valueColor="#6c757d"
              />
            ))}
          </StatSection>
        ) : null}

        <StatSection
          title="Miglior giornata di squadra"
          subtitle="Somma fantavoto titolari in una singola giornata"
          icon="trophy-outline"
          accentColor="#2e7d32"
          emptyText="Calcola almeno una giornata per vedere questo dato."
        >
          {stats?.best_team_matchday ? (
            <TeamHighlightCard item={stats.best_team_matchday} variant="best" />
          ) : null}
        </StatSection>

        <StatSection
          title="Peggior giornata di squadra"
          subtitle="Somma fantavoto titolari in una singola giornata"
          icon="sad-outline"
          accentColor="#c62828"
          emptyText="Nessuna giornata con punteggio valido (escluse le formazioni a 0)."
        >
          {stats?.worst_team_matchday ? (
            <TeamHighlightCard item={stats.worst_team_matchday} variant="worst" />
          ) : null}
        </StatSection>

        <StatSection
          title="Fantavoti più alti"
          subtitle="Migliori prestazioni singole per giornata"
          icon="arrow-up-circle-outline"
          accentColor="#2e7d32"
          emptyText="Inserisci voti e calcola le giornate per vedere questo dato."
        >
          {(stats?.top_fantavoti || []).map((player, index) => (
            <PlayerRow
              key={`top-${player.player_id}-${player.giornata}`}
              rank={index + 1}
              player={player}
              valueLabel={formatVoteRating(player.fantavoto)}
              valueColor="#2e7d32"
            />
          ))}
        </StatSection>

        <StatSection
          title="Fantavoti più bassi"
          subtitle="Peggiori prestazioni singole per giornata"
          icon="arrow-down-circle-outline"
          accentColor="#c62828"
          emptyText="Inserisci voti e calcola le giornate per vedere questo dato."
        >
          {(stats?.bottom_fantavoti || []).map((player, index) => (
            <PlayerRow
              key={`bottom-${player.player_id}-${player.giornata}`}
              rank={index + 1}
              player={player}
              valueLabel={formatVoteRating(player.fantavoto)}
              valueColor="#c62828"
            />
          ))}
        </StatSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  leagueName: {
    fontSize: 13,
    color: '#888',
    marginTop: 1,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fce4ec',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: '#c62828',
    fontSize: 14,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderText: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#888',
  },
  sectionBody: {
    padding: 10,
    gap: 8,
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafbfc',
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  rankBadge: {
    width: 22,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
  },
  playerPhotoCol: {
    width: 56,
    height: 56,
    position: 'relative',
  },
  playerPhotoBadge: {
    width: 56,
    height: 56,
  },
  playerPhotoRoleOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  playerPhotoRoleText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  roleBadgeCol: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMini: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMiniText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  playerTeam: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  valueWrap: {
    alignItems: 'flex-end',
    minWidth: 48,
  },
  valueText: {
    fontSize: 16,
    fontWeight: '700',
  },
  giornataHint: {
    marginTop: 2,
    fontSize: 11,
    color: '#999',
  },
  teamHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafbfc',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 12,
    gap: 12,
  },
  teamHighlightAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  teamLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 4,
  },
  teamHighlightBody: {
    flex: 1,
    minWidth: 0,
  },
  teamHighlightName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  teamHighlightMeta: {
    marginTop: 3,
    fontSize: 12,
    color: '#888',
  },
  teamHighlightScore: {
    fontSize: 22,
    fontWeight: '800',
  },
});
