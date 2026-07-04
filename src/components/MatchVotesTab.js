import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminMatchesService } from '../services/api';
import { TeamLogoImage } from './StableCachedImage';
import VotesPlayerRow, { EMPTY_VOTE, buildRatingsPayload, DEFAULT_BONUS_SETTINGS } from './VotesPlayerRow';
import { normalizeVoteRating } from '../utils/voteRating';

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

function GiornataChip({ matchday, compact }) {
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
    <View style={[styles.gChip, compact && styles.gChipCompact]}>
      <Ionicons name="calendar" size={13} color="#64748b" />
      <Text style={styles.gChipNum}>{matchday.giornata}</Text>
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
        <GiornataChip matchday={md} compact />
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
              <Ionicons name="calendar" size={16} color="#667eea" />
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
                      name="calendar-outline"
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

function LinkEditorPanel({
  linkData,
  draftHomeMd,
  draftAwayMd,
  linksChanged,
  savingLinks,
  onPressHomeChip,
  onPressAwayChip,
  onClearHome,
  onClearAway,
  onSave,
  onClose,
  inModal,
}) {
  return (
    <View style={[styles.linkCard, inModal && styles.linkCardModal]}>
      <View style={styles.linkToolbar}>
        <View style={styles.linkToolbarLeft}>
          <Ionicons name="git-branch-outline" size={18} color="#667eea" />
        </View>
        <View style={styles.linkToolbarActions}>
          {inModal && onClose ? (
            <TouchableOpacity style={styles.toolBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#64748b" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.toolBtn, styles.toolBtnSave, (!linksChanged || savingLinks) && styles.toolBtnDisabled]}
            disabled={!linksChanged || savingLinks}
            onPress={onSave}
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
        selectedId={draftHomeMd}
        suggestion={linkData?.suggestions?.home}
        matchdays={linkData?.matchdays}
        onPressChip={onPressHomeChip}
        onClear={onClearHome}
      />

      <View style={styles.linkDivider} />

      <TeamLinkRow
        team={linkData?.away_team}
        selectedId={draftAwayMd}
        suggestion={linkData?.suggestions?.away}
        matchdays={linkData?.matchdays}
        onPressChip={onPressAwayChip}
        onClear={onClearAway}
      />
    </View>
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
  const [bonusSettings, setBonusSettings] = useState(DEFAULT_BONUS_SETTINGS);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [picker, setPicker] = useState(null);
  const [draftHomeMd, setDraftHomeMd] = useState(null);
  const [draftAwayMd, setDraftAwayMd] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
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
        setBonusSettings(vd.bonus_settings || DEFAULT_BONUS_SETTINGS);
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
      if (data.has_links) {
        setLinkEditorOpen(false);
        await loadAll();
      }
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio');
    } finally {
      setSavingLinks(false);
    }
  };

  const openLinkEditor = () => {
    if (linkData) {
      setDraftHomeMd(linkData.current?.home_matchday_id ?? pickInitialDraft(linkData, 'home'));
      setDraftAwayMd(linkData.current?.away_matchday_id ?? pickInitialDraft(linkData, 'away'));
    }
    setLinkEditorOpen(true);
  };

  const closeLinkEditor = () => {
    if (linkData) {
      setDraftHomeMd(linkData.current?.home_matchday_id ?? null);
      setDraftAwayMd(linkData.current?.away_matchday_id ?? null);
    }
    setLinkEditorOpen(false);
  };

  const updateRating = useCallback((playerId, change) => {
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      if (current.rating === 0) {
        if (change < 0) return prev;
        return { ...prev, [playerId]: { ...current, rating: 6 } };
      }
      let nr = normalizeVoteRating(current.rating + change);
      if (nr < 1) nr = 0;
      if (nr > 10) nr = 10;
      return {
        ...prev,
        [playerId]: {
          ...current,
          rating: nr,
          goals: nr === 0 ? 0 : current.goals,
          assists: nr === 0 ? 0 : current.assists,
          yellow_cards: nr === 0 ? 0 : current.yellow_cards,
          red_cards: nr === 0 ? 0 : current.red_cards,
        },
      };
    });
  }, []);

  const setRatingValue = useCallback((playerId, value) => {
    let rating = value === '' || value == null ? 0 : parseFloat(String(value).replace(',', '.'));
    if (isNaN(rating)) return;
    if (rating < 1) rating = 0;
    if (rating > 10) rating = 10;
    rating = normalizeVoteRating(rating);
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      return {
        ...prev,
        [playerId]: {
          ...current,
          rating,
          goals: rating === 0 ? 0 : current.goals,
          assists: rating === 0 ? 0 : current.assists,
          yellow_cards: rating === 0 ? 0 : current.yellow_cards,
          red_cards: rating === 0 ? 0 : current.red_cards,
        },
      };
    });
  }, []);

  const toggleSV = useCallback((playerId) => {
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      const isSV = current.rating === 0;
      return {
        ...prev,
        [playerId]: isSV
          ? { ...current, rating: 6 }
          : { ...EMPTY_VOTE },
      };
    });
  }, []);

  const updateBonus = useCallback((playerId, field, value) => {
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      if (current.rating === 0) return prev;
      return { ...prev, [playerId]: { ...current, [field]: value } };
    });
  }, []);

  const incrementBonus = useCallback((playerId, field) => {
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      if (current.rating === 0) return prev;
      return { ...prev, [playerId]: { ...current, [field]: (current[field] || 0) + 1 } };
    });
  }, []);

  const decrementBonus = useCallback((playerId, field) => {
    setVotes((prev) => {
      const current = prev[playerId] || { ...EMPTY_VOTE };
      if (current.rating === 0) return prev;
      const val = (current[field] || 0) - 1;
      return { ...prev, [playerId]: { ...current, [field]: val < 0 ? 0 : val } };
    });
  }, []);

  const buildSavePayload = useCallback((teamId = null) => {
    const teamList = votesData?.teams || [];
    const players = [];
    if (teamId) {
      const team = teamList.find((t) => t.id === teamId);
      if (team) players.push(...team.players);
    } else {
      teamList.forEach((t) => players.push(...t.players));
    }
    return buildRatingsPayload(players, votes);
  }, [votesData?.teams, votes]);

  const handleSaveTeam = async (teamId) => {
    try {
      setSaving(true);
      setError('');
      const res = await adminMatchesService.saveMatchVotes(matchId, {
        ratings: buildSavePayload(teamId),
        team_id: teamId,
      });
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

  const teamHasSavedVotes = useCallback((team) => {
    try {
      const saved = JSON.parse(savedSnapshot.current || '{}');
      return (team?.players || []).some((p) => {
        const sv = saved[p.id];
        return sv && sv.rating > 0;
      });
    } catch {
      return false;
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  const teams = votesData?.teams || [];
  const bonusEnabled = bonusSettings && Number(bonusSettings.enable_bonus_malus) === 1 && (
    Number(bonusSettings.enable_goal) === 1
    || Number(bonusSettings.enable_assist) === 1
    || Number(bonusSettings.enable_yellow_card) === 1
    || Number(bonusSettings.enable_red_card) === 1
    || Number(bonusSettings.enable_goals_conceded) === 1
    || Number(bonusSettings.enable_own_goal) === 1
    || Number(bonusSettings.enable_penalty_missed) === 1
    || Number(bonusSettings.enable_penalty_saved) === 1
    || Number(bonusSettings.enable_clean_sheet) === 1
    || Number(bonusSettings.enable_pallone_fuori) === 1
    || Number(bonusSettings.enable_briso) === 1
    || Number(bonusSettings.enable_no_divisa) === 1
  );
  const linksChanged =
    draftHomeMd !== (linkData?.current?.home_matchday_id ?? null) ||
    draftAwayMd !== (linkData?.current?.away_matchday_id ?? null);
  const showInlineLinkEditor = canManageLinks && !linkData?.has_links;
  const showCompactLinkBtn = canManageLinks && !!linkData?.has_links;

  const linkEditorProps = {
    linkData,
    draftHomeMd,
    draftAwayMd,
    linksChanged,
    savingLinks,
    onPressHomeChip: () => setPicker({ side: 'home', teamId: linkData?.home_team?.id }),
    onPressAwayChip: () => setPicker({ side: 'away', teamId: linkData?.away_team?.id }),
    onClearHome: () => setDraftHomeMd(null),
    onClearAway: () => setDraftAwayMd(null),
    onSave: handleSaveLinks,
  };

  return (
    <View style={styles.wrap}>
      {showInlineLinkEditor ? (
        <LinkEditorPanel {...linkEditorProps} />
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
              {showCompactLinkBtn ? (
                <View style={styles.votesToolbar}>
                  <TouchableOpacity style={styles.linkCompactBtn} onPress={openLinkEditor} activeOpacity={0.7}>
                    <Ionicons name="git-branch-outline" size={18} color="#667eea" />
                  </TouchableOpacity>
                </View>
              ) : null}

              {teams.map((team) => {
                const isOpen = !!expandedTeams[team.id];
                const voted = team.players.filter((p) => (votes[p.id]?.rating || 0) > 0).length;
                const linkTeam =
                  team.side === 'home' ? linkData?.home_team : linkData?.away_team;
                const hasSaved = teamHasSavedVotes(team);
                return (
                  <View
                    key={team.id}
                    style={[styles.teamCard, hasSaved ? styles.teamCardSaved : styles.teamCardUnsaved]}
                  >
                    <TouchableOpacity
                      style={styles.teamHeader}
                      onPress={() => setExpandedTeams((e) => ({ ...e, [team.id]: !e[team.id] }))}
                      activeOpacity={0.7}
                    >
                      <View style={styles.teamHeaderLeft}>
                        <View style={styles.votesTeamLogoWrap}>
                          <TeamLogoImage
                            logoPath={linkTeam?.logo_path}
                            style={styles.votesTeamLogo}
                            fallbackStyle={styles.votesTeamLogoFb}
                            fallbackIconSize={16}
                          />
                        </View>
                        <Text style={styles.teamName} numberOfLines={1}>
                          {linkTeam?.name || team.name}
                        </Text>
                        <GiornataChip
                          matchday={findMatchday(linkData?.matchdays, team.matchday_id) || {
                            giornata: team.giornata,
                            is_ghost: team.is_ghost,
                          }}
                          compact
                        />
                        <View style={[styles.progressBadge, hasSaved && styles.progressBadgeSaved]}>
                          <Text style={[styles.progressText, hasSaved && styles.progressTextSaved]}>
                            {voted}/{team.players.length}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.teamHeaderRight}>
                        <TouchableOpacity
                          style={[
                            styles.teamSaveBtn,
                            { backgroundColor: hasSaved ? '#198754' : '#e6a800' },
                            saving && { opacity: 0.5 },
                          ]}
                          onPress={(e) => { e.stopPropagation(); void handleSaveTeam(team.id); }}
                          disabled={saving}
                        >
                          <Ionicons name={hasSaved ? 'checkmark' : 'save-outline'} size={16} color="#fff" />
                        </TouchableOpacity>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
                      </View>
                    </TouchableOpacity>
                    {isOpen ? (
                      <View style={styles.playersList}>
                        {team.players.map((p) => (
                          <VotesPlayerRow
                            key={p.id}
                            player={p}
                            playerVote={votes[p.id] || EMPTY_VOTE}
                            bonusSettings={bonusSettings}
                            bonusEnabled={bonusEnabled}
                            onSetRating={setRatingValue}
                            onUpdateRating={updateRating}
                            onToggleSV={toggleSV}
                            onUpdateBonus={updateBonus}
                            onIncrementBonus={incrementBonus}
                            onDecrementBonus={decrementBonus}
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

      <Modal visible={linkEditorOpen} transparent animationType="slide" onRequestClose={closeLinkEditor}>
        <View style={styles.linkModalOverlay}>
          <Pressable style={styles.linkModalBackdrop} onPress={closeLinkEditor} />
          <View style={styles.linkModalSheet}>
            <LinkEditorPanel {...linkEditorProps} inModal onClose={closeLinkEditor} />
          </View>
        </View>
      </Modal>

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
  wrap: { paddingBottom: 16, width: '100%' },
  centered: { paddingVertical: 40, alignItems: 'center' },
  linkCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eef2ff',
  },
  linkCardModal: {
    marginBottom: 0,
    borderWidth: 0,
    padding: 0,
  },
  linkModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  linkModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  linkModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  linkCompactBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  linkCompactBtnSpacer: { width: 36 },
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
  gChipEmpty: { opacity: 0.7 },
  gChipEmptyText: { fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  gChipNum: { fontSize: 14, fontWeight: '800', color: '#475569' },
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
  votesToolbar: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  teamCardSaved: {
    borderLeftWidth: 3,
    borderLeftColor: '#198754',
  },
  teamCardUnsaved: {
    borderLeftWidth: 3,
    borderLeftColor: '#e6a800',
  },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
    minHeight: 44,
  },
  teamHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    marginRight: 6,
  },
  votesTeamLogoWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
  },
  votesTeamLogo: { width: 28, height: 28 },
  votesTeamLogoFb: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  teamName: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    minWidth: 0,
  },
  progressBadge: {
    backgroundColor: '#fff8e1',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    flexShrink: 0,
  },
  progressBadgeSaved: {
    backgroundColor: '#e8f5e9',
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#e6a800',
  },
  progressTextSaved: {
    color: '#198754',
  },
  teamHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  teamSaveBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersList: { paddingBottom: 8, width: '100%' },
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
