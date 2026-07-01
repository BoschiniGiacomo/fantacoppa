import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminMatchesService } from '../services/api';
import { TeamLogoImage } from './StableCachedImage';
import { formatVoteRating, normalizeVoteRating } from '../utils/voteRating';

function pickInitialDraft(links, side) {
  const current = links?.current?.[`${side}_matchday_id`];
  if (current != null && current !== '') return current;
  const sug = links?.suggestions?.[side];
  if (sug?.available && sug?.matchday_id) return sug.matchday_id;
  return null;
}

function findMatchday(matchdays, id) {
  if (id == null) return null;
  return (matchdays || []).find((m) => Number(m.id) === Number(id)) || null;
}

function VotePlayerRow({ player, vote, onSetRating, onUpdateRating, onToggleSV }) {
  const pv = vote || { rating: 0 };
  const isSV = pv.rating === 0;
  const [editingText, setEditingText] = useState(null);
  const isEditing = editingText !== null;
  const roleColors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };

  const handleBlur = () => {
    if (editingText !== null) {
      onSetRating(player.id, editingText);
      setEditingText(null);
    }
  };

  const displayValue = isEditing
    ? editingText
    : isSV
      ? ''
      : formatVoteRating(pv.rating, { empty: '' });

  return (
    <View style={styles.playerRow}>
      <View style={[styles.roleBadge, { backgroundColor: roleColors[player.role] || '#6c757d' }]}>
        <Text style={styles.roleBadgeText}>{player.role}</Text>
      </View>
      <Text style={styles.playerName} numberOfLines={1}>
        {player.first_name} {player.last_name}
      </Text>
      <TouchableOpacity
        style={[styles.svBtn, isSV && styles.svBtnActive]}
        onPress={() => onToggleSV(player.id)}
      >
        <Text style={[styles.svBtnText, isSV && styles.svBtnTextActive]}>S.V.</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.ratingBtn} onPress={() => onUpdateRating(player.id, -0.25)}>
        <Text style={styles.ratingBtnText}>−</Text>
      </TouchableOpacity>
      <TextInput
        style={[styles.ratingInput, isSV && styles.ratingInputSV]}
        value={displayValue}
        onFocus={() => {
          if (isSV) setEditingText('');
          else setEditingText(pv.rating % 1 === 0 ? String(pv.rating) : String(pv.rating));
        }}
        onChangeText={(text) => {
          const t = text.replace(',', '.');
          if (t === '' || /^\d*\.?\d{0,2}$/.test(t)) setEditingText(t);
        }}
        onBlur={handleBlur}
        placeholder={isSV ? 'S.V.' : '6'}
        placeholderTextColor={isSV ? '#dc3545' : '#bbb'}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
      <TouchableOpacity style={styles.ratingBtn} onPress={() => onUpdateRating(player.id, 0.25)}>
        <Text style={styles.ratingBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function GiornataChip({ matchday, isSuggested, compact }) {
  if (!matchday) {
    return (
      <View style={[styles.gChip, styles.gChipEmpty, compact && styles.gChipCompact]}>
        <Ionicons name="calendar-outline" size={14} color="#94a3b8" />
        <Text style={styles.gChipEmptyText}>—</Text>
      </View>
    );
  }
  const isGhost = Number(matchday.is_ghost) === 1;
  return (
    <View style={[styles.gChip, isSuggested && styles.gChipSuggested, compact && styles.gChipCompact]}>
      {isSuggested ? <Ionicons name="sparkles" size={11} color="#667eea" style={styles.gChipSparkle} /> : null}
      <Ionicons name="calendar" size={13} color={isSuggested ? '#667eea' : '#64748b'} />
      <Text style={[styles.gChipNum, isSuggested && styles.gChipNumSuggested]}>{matchday.giornata}</Text>
      {isGhost ? <Ionicons name="moon-outline" size={11} color="#7c6fd6" /> : null}
    </View>
  );
}

function TeamLinkRow({
  team,
  side,
  selectedId,
  suggestion,
  matchdays,
  onPressChip,
  onClear,
}) {
  const md = findMatchday(matchdays, selectedId);
  const isSuggested =
    suggestion?.available &&
    suggestion?.matchday_id != null &&
    Number(selectedId) === Number(suggestion.matchday_id);

  return (
    <View style={styles.teamLinkRow}>
      <View style={styles.teamLinkLeft}>
        <View style={styles.logoWrap}>
          <TeamLogoImage
            logoPath={team?.logo_path}
            style={styles.teamLogo}
            fallbackStyle={styles.teamLogoFallback}
            fallbackIconSize={16}
          />
        </View>
        <View style={styles.teamLinkMeta}>
          <Text style={styles.teamLinkName} numberOfLines={1}>{team?.name || '—'}</Text>
          {suggestion?.match_index ? (
            <View style={styles.matchIndexBadge}>
              <Ionicons name="football-outline" size={10} color="#94a3b8" />
              <Text style={styles.matchIndexText}>
                {suggestion.match_index}/{suggestion.total_matches}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons name="arrow-forward" size={14} color="#cbd5e1" style={styles.teamLinkArrow} />

      <TouchableOpacity
        style={styles.chipTap}
        onPress={onPressChip}
        activeOpacity={0.7}
      >
        <GiornataChip matchday={md} isSuggested={isSuggested} compact />
        <Ionicons name="chevron-down" size={14} color="#94a3b8" />
      </TouchableOpacity>

      {selectedId != null ? (
        <TouchableOpacity style={styles.clearLinkBtn} onPress={onClear} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color="#cbd5e1" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function MatchdayPickerModal({
  visible,
  team,
  matchdays,
  occupiedSlots,
  teamId,
  selectedId,
  suggestion,
  onSelect,
  onClose,
}) {
  const occupiedForTeam = new Set(
    (occupiedSlots || [])
      .filter((s) => Number(s.team_id) === Number(teamId))
      .map((s) => Number(s.matchday_id))
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTeamRow}>
              <TeamLogoImage
                logoPath={team?.logo_path}
                style={styles.modalTeamLogo}
                fallbackStyle={styles.modalTeamLogoFb}
                fallbackIconSize={14}
              />
              <Text style={styles.modalTeamName} numberOfLines={1}>{team?.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {suggestion?.available && suggestion?.matchday_id ? (
            <TouchableOpacity
              style={styles.suggestBanner}
              onPress={() => onSelect(suggestion.matchday_id)}
            >
              <Ionicons name="sparkles" size={16} color="#667eea" />
              <Text style={styles.suggestBannerText}>
                Consigliata · G.{suggestion.giornata}
                {suggestion.match_index ? ` (${suggestion.match_index}ª partita)` : ''}
              </Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[styles.mdOption, selectedId == null && styles.mdOptionSelected]}
              onPress={() => onSelect(null)}
            >
              <Ionicons name="remove-circle-outline" size={18} color="#94a3b8" />
              <Text style={styles.mdOptionText}>Nessuna</Text>
            </TouchableOpacity>
            {(matchdays || []).map((md) => {
              const id = Number(md.id);
              const occupied = occupiedForTeam.has(id);
              const isGhost = Number(md.is_ghost) === 1;
              const isRec = suggestion?.available && Number(suggestion.matchday_id) === id;
              return (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.mdOption,
                    selectedId === id && styles.mdOptionSelected,
                    occupied && styles.mdOptionDisabled,
                    isRec && styles.mdOptionRec,
                  ]}
                  disabled={occupied}
                  onPress={() => onSelect(id)}
                >
                  <View style={styles.mdOptionLeft}>
                    <Ionicons
                      name={isRec ? 'sparkles' : 'calendar-outline'}
                      size={17}
                      color={occupied ? '#cbd5e1' : isRec ? '#667eea' : '#64748b'}
                    />
                    <Text style={[styles.mdOptionText, occupied && styles.mdOptionTextDisabled]}>
                      G.{md.giornata}
                    </Text>
                    {isGhost ? <Ionicons name="moon-outline" size={13} color="#7c6fd6" /> : null}
                  </View>
                  {occupied ? (
                    <Ionicons name="lock-closed" size={14} color="#fca5a5" />
                  ) : selectedId === id ? (
                    <Ionicons name="checkmark-circle" size={18} color="#667eea" />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function MatchVotesTab({ matchId, canManageLinks, onLinksUpdated }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);
  const [error, setError] = useState('');
  const [linkData, setLinkData] = useState(null);
  const [votesData, setVotesData] = useState(null);
  const [votes, setVotes] = useState({});
  const [expandedTeams, setExpandedTeams] = useState({});
  const [picker, setPicker] = useState(null);
  const [draftHomeMd, setDraftHomeMd] = useState(null);
  const [draftAwayMd, setDraftAwayMd] = useState(null);
  const [feedback, setFeedback] = useState('');
  const savedSnapshot = useRef('');

  const applySuggestionsToDraft = useCallback((links) => {
    setDraftHomeMd(pickInitialDraft(links, 'home'));
    setDraftAwayMd(pickInitialDraft(links, 'away'));
  }, []);

  const loadAll = useCallback(async () => {
    if (!matchId) return;
    try {
      setLoading(true);
      setError('');
      const linksRes = await adminMatchesService.getMatchdayLinks(matchId);
      const links = linksRes.data || {};
      setLinkData(links);
      applySuggestionsToDraft(links);

      if (links.has_links) {
        const votesRes = await adminMatchesService.getMatchVotes(matchId);
        const vd = votesRes.data || {};
        setVotesData(vd);
        const v = vd.votes || {};
        setVotes(v);
        savedSnapshot.current = JSON.stringify(v);
        const exp = {};
        (vd.teams || []).forEach((t) => { exp[t.id] = true; });
        setExpandedTeams(exp);
      } else {
        setVotesData(null);
        setVotes({});
        savedSnapshot.current = '{}';
      }
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore caricamento');
    } finally {
      setLoading(false);
    }
  }, [matchId, applySuggestionsToDraft]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const applySuggestions = () => {
    const h = linkData?.suggestions?.home;
    const a = linkData?.suggestions?.away;
    setDraftHomeMd(h?.available ? h.matchday_id : null);
    setDraftAwayMd(a?.available ? a.matchday_id : null);
  };

  const handleSaveLinks = async () => {
    try {
      setSavingLinks(true);
      setError('');
      const res = await adminMatchesService.setMatchdayLinks(matchId, {
        home_matchday_id: draftHomeMd,
        away_matchday_id: draftAwayMd,
      });
      const data = res.data || {};
      setLinkData(data);
      setDraftHomeMd(data.current?.home_matchday_id ?? null);
      setDraftAwayMd(data.current?.away_matchday_id ?? null);
      if (onLinksUpdated) onLinksUpdated(data);
      setFeedback('Salvato');
      setTimeout(() => setFeedback(''), 2000);
      if (data.has_links) await loadAll();
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio');
    } finally {
      setSavingLinks(false);
    }
  };

  const updateRating = useCallback((playerId, change) => {
    setVotes((prev) => {
      const current = prev[playerId] || { rating: 0 };
      if (current.rating === 0) {
        if (change < 0) return prev;
        return { ...prev, [playerId]: { ...current, rating: 6 } };
      }
      let nr = normalizeVoteRating(current.rating + change);
      if (nr < 1) nr = 0;
      if (nr > 10) nr = 10;
      return { ...prev, [playerId]: { ...current, rating: nr } };
    });
  }, []);

  const setRatingValue = useCallback((playerId, value) => {
    let rating = value === '' || value == null ? 0 : parseFloat(String(value).replace(',', '.'));
    if (isNaN(rating)) return;
    if (rating < 1) rating = 0;
    if (rating > 10) rating = 10;
    rating = normalizeVoteRating(rating);
    setVotes((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), rating },
    }));
  }, []);

  const toggleSV = useCallback((playerId) => {
    setVotes((prev) => {
      const current = prev[playerId] || { rating: 0 };
      const next = current.rating === 0 ? 6 : 0;
      return { ...prev, [playerId]: { ...current, rating: next } };
    });
  }, []);

  const handleSaveTeam = async (teamId) => {
    try {
      setSaving(true);
      setError('');
      const res = await adminMatchesService.saveMatchVotes(matchId, { ratings: votes, team_id: teamId });
      const fresh = res.data?.votes || votes;
      setVotes(fresh);
      savedSnapshot.current = JSON.stringify(fresh);
      setFeedback('Salvato');
      setTimeout(() => setFeedback(''), 2000);
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    try {
      setSaving(true);
      setError('');
      const res = await adminMatchesService.saveMatchVotes(matchId, { ratings: votes });
      const fresh = res.data?.votes || votes;
      setVotes(fresh);
      savedSnapshot.current = JSON.stringify(fresh);
      setFeedback('Salvato');
      setTimeout(() => setFeedback(''), 2000);
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  const teams = votesData?.teams || [];
  const linksChanged =
    draftHomeMd !== (linkData?.current?.home_matchday_id ?? null) ||
    draftAwayMd !== (linkData?.current?.away_matchday_id ?? null);
  const hasAnySuggestion =
    linkData?.suggestions?.home?.available || linkData?.suggestions?.away?.available;

  return (
    <View style={styles.wrap}>
      {canManageLinks ? (
        <View style={styles.linkCard}>
          <View style={styles.linkToolbar}>
            <View style={styles.linkToolbarLeft}>
              <Ionicons name="git-branch-outline" size={18} color="#667eea" />
            </View>
            <View style={styles.linkToolbarActions}>
              {hasAnySuggestion ? (
                <TouchableOpacity style={styles.toolBtn} onPress={applySuggestions} hitSlop={6}>
                  <Ionicons name="sparkles" size={18} color="#667eea" />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.toolBtn, styles.toolBtnSave, (!linksChanged || savingLinks) && styles.toolBtnDisabled]}
                disabled={!linksChanged || savingLinks}
                onPress={handleSaveLinks}
              >
                {savingLinks ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <TeamLinkRow
            team={linkData?.home_team}
            side="home"
            selectedId={draftHomeMd}
            suggestion={linkData?.suggestions?.home}
            matchdays={linkData?.matchdays}
            onPressChip={() => setPicker({ side: 'home', teamId: linkData?.home_team?.id })}
            onClear={() => setDraftHomeMd(null)}
          />

          <View style={styles.linkDivider} />

          <TeamLinkRow
            team={linkData?.away_team}
            side="away"
            selectedId={draftAwayMd}
            suggestion={linkData?.suggestions?.away}
            matchdays={linkData?.matchdays}
            onPressChip={() => setPicker({ side: 'away', teamId: linkData?.away_team?.id })}
            onClear={() => setDraftAwayMd(null)}
          />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color="#dc3545" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {feedback ? (
        <View style={styles.feedbackBox}>
          <Ionicons name="checkmark-circle" size={16} color="#198754" />
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}

      {!linkData?.has_links && !linksChanged ? (
        <View style={styles.emptyBox}>
          <Ionicons name="link-outline" size={36} color="#e2e8f0" />
          {!canManageLinks ? (
            <Text style={styles.emptySub}>In attesa del collegamento</Text>
          ) : null}
        </View>
      ) : null}

      {(linkData?.has_links || (canManageLinks && (draftHomeMd || draftAwayMd))) ? (
        <>
          {linkData?.has_links ? (
            <>
              <View style={styles.votesHeader}>
                <Ionicons name="create-outline" size={18} color="#334155" />
                <TouchableOpacity
                  style={[styles.saveAllBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSaveAll}
                  disabled={saving}
                >
                  <Ionicons name="save-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>

              {teams.map((team) => {
                const isOpen = !!expandedTeams[team.id];
                const voted = team.players.filter((p) => (votes[p.id]?.rating || 0) > 0).length;
                const linkTeam =
                  team.side === 'home' ? linkData?.home_team : linkData?.away_team;
                return (
                  <View key={team.id} style={styles.teamCard}>
                    <TouchableOpacity
                      style={styles.teamHeader}
                      onPress={() => setExpandedTeams((e) => ({ ...e, [team.id]: !e[team.id] }))}
                    >
                      <View style={styles.teamHeaderLeft}>
                        <TeamLogoImage
                          logoPath={linkTeam?.logo_path}
                          style={styles.votesTeamLogo}
                          fallbackStyle={styles.votesTeamLogoFb}
                          fallbackIconSize={12}
                        />
                        <GiornataChip
                          matchday={findMatchday(linkData?.matchdays, team.matchday_id) || {
                            giornata: team.giornata,
                            is_ghost: team.is_ghost,
                          }}
                          compact
                        />
                        <Text style={styles.votedCount}>{voted}/{team.players.length}</Text>
                      </View>
                      <View style={styles.teamHeaderRight}>
                        <TouchableOpacity
                          style={styles.teamSaveBtn}
                          onPress={(e) => { e.stopPropagation(); void handleSaveTeam(team.id); }}
                          disabled={saving}
                        >
                          <Ionicons name="save-outline" size={15} color="#fff" />
                        </TouchableOpacity>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
                      </View>
                    </TouchableOpacity>
                    {isOpen ? (
                      <View style={styles.playersList}>
                        {team.players.map((p) => (
                          <VotePlayerRow
                            key={p.id}
                            player={p}
                            vote={votes[p.id]}
                            onSetRating={setRatingValue}
                            onUpdateRating={updateRating}
                            onToggleSV={toggleSV}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : canManageLinks && linksChanged ? (
            <View style={styles.pendingHint}>
              <Ionicons name="information-circle-outline" size={16} color="#667eea" />
              <Text style={styles.pendingHintText}>Conferma i collegamenti per inserire i voti</Text>
            </View>
          ) : null}
        </>
      ) : null}

      <MatchdayPickerModal
        visible={!!picker}
        team={picker?.side === 'home' ? linkData?.home_team : linkData?.away_team}
        matchdays={linkData?.matchdays}
        occupiedSlots={linkData?.occupied_slots}
        teamId={picker?.teamId}
        selectedId={picker?.side === 'home' ? draftHomeMd : draftAwayMd}
        suggestion={picker?.side === 'home' ? linkData?.suggestions?.home : linkData?.suggestions?.away}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker?.side === 'home') setDraftHomeMd(id);
          else setDraftAwayMd(id);
          setPicker(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 16 },
  centered: { paddingVertical: 40, alignItems: 'center' },
  linkCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2ff',
  },
  linkToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  linkToolbarLeft: {},
  linkToolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnSave: { backgroundColor: '#667eea' },
  toolBtnDisabled: { opacity: 0.4 },
  teamLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  teamLinkLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  teamLogo: { width: 30, height: 30 },
  teamLogoFallback: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLinkMeta: { flex: 1, minWidth: 0 },
  teamLinkName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  matchIndexBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  matchIndexText: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  teamLinkArrow: { marginHorizontal: 6 },
  chipTap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearLinkBtn: { marginLeft: 6 },
  linkDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f1f5f9',
    marginVertical: 4,
    marginLeft: 46,
  },
  gChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  gChipCompact: { paddingHorizontal: 8, paddingVertical: 4 },
  gChipSuggested: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  gChipEmpty: { opacity: 0.7 },
  gChipEmptyText: { fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  gChipSparkle: { marginRight: -2 },
  gChipNum: { fontSize: 14, fontWeight: '800', color: '#475569' },
  gChipNumSuggested: { color: '#667eea' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  errorText: { flex: 1, color: '#dc3545', fontSize: 12 },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  feedbackText: { color: '#198754', fontWeight: '600', fontSize: 12 },
  emptyBox: { alignItems: 'center', paddingVertical: 20 },
  emptySub: { fontSize: 12, color: '#94a3b8', marginTop: 8 },
  pendingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  pendingHintText: { fontSize: 12, color: '#667eea', fontWeight: '500' },
  votesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  saveAllBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#198754',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  teamHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  votesTeamLogo: { width: 22, height: 22 },
  votesTeamLogoFb: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  teamHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  votedCount: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  teamSaveBtn: {
    backgroundColor: '#667eea',
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersList: { paddingHorizontal: 8, paddingBottom: 6 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 5,
  },
  roleBadge: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  roleBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  playerName: { flex: 1, fontSize: 13, color: '#334155' },
  svBtn: {
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  svBtnActive: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  svBtnText: { fontSize: 9, fontWeight: '700', color: '#94a3b8' },
  svBtnTextActive: { color: '#dc3545' },
  ratingBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtnText: { fontSize: 15, fontWeight: '700', color: '#475569' },
  ratingInput: {
    width: 40,
    height: 30,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    backgroundColor: '#fff',
  },
  ratingInputSV: { borderColor: '#fecaca', color: '#dc3545' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  modalTeamLogo: { width: 28, height: 28 },
  modalTeamLogoFb: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  modalTeamName: { fontSize: 16, fontWeight: '700', color: '#1e293b', flex: 1 },
  suggestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  suggestBannerText: { fontSize: 13, fontWeight: '600', color: '#667eea', flex: 1 },
  modalList: { maxHeight: 320 },
  mdOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 2,
  },
  mdOptionSelected: { backgroundColor: '#eef2ff' },
  mdOptionRec: { borderWidth: 1, borderColor: '#c7d2fe' },
  mdOptionDisabled: { opacity: 0.45 },
  mdOptionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mdOptionText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  mdOptionTextDisabled: { color: '#94a3b8' },
});
