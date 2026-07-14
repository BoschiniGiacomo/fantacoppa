import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminMatchesService } from '../services/api';
import { TeamLogoImage } from './StableCachedImage';
import VotesPlayerRow, {
  EMPTY_VOTE,
  applyVoteInputCommitToVote,
  buildRatingsPayload,
  DEFAULT_BONUS_SETTINGS,
  LIVE_DIRECT_VOTE_FIELDS,
} from './VotesPlayerRow';
import ConfirmAlertModal from './ConfirmAlertModal';
import { normalizeVoteRating, isSvVoteRating, SV_VOTE_RATING } from '../utils/voteRating';
import { useScrollInputAboveKeyboard, VOTE_INPUT_FIXED_ABOVE_KEYBOARD } from '../utils/scrollInputAboveKeyboard';

function pickInitialDraft(links, side) {
  const current = links?.current?.[`${side}_matchday_id`];
  if (current != null && current !== '') return current;
  const sug = links?.suggestions?.[side];
  if (sug?.available && sug?.matchday_id) return sug.matchday_id;
  return null;
}

function getVoteUiMode(playerId, vote, savedVotePlayerIds, explicitNdPlayerIds) {
  const pid = Number(playerId);
  const rating = Number(vote?.rating ?? 0);
  if (rating > 0) return 'has_vote';
  if (isSvVoteRating(rating)) return 'has_sv';
  if (savedVotePlayerIds.has(pid)) return 'saved_nd';
  if (explicitNdPlayerIds.has(pid)) return 'draft_nd';
  return 'unset';
}

function clearsBonusFields(rating) {
  return rating === 0 || isSvVoteRating(rating);
}

/** Pagellatore: giocatori senza voto salvato partono da S.V. (solo UI/stato locale). */
function applyDefaultSvForUnsetPlayers(teams, votes, { savedPlayerIds, unavailablePlayerIds, svEnabled }) {
  if (!svEnabled) return votes;
  const out = { ...votes };
  const saved = savedPlayerIds instanceof Set ? savedPlayerIds : new Set(savedPlayerIds || []);
  const unavailable = unavailablePlayerIds instanceof Set
    ? unavailablePlayerIds
    : new Set(unavailablePlayerIds || []);
  (teams || []).forEach((team) => {
    (team.players || []).forEach((p) => {
      const pid = Number(p.id);
      if (!Number.isFinite(pid) || saved.has(pid) || unavailable.has(pid)) return;
      const cur = out[pid] || out[String(pid)];
      const r = Number(cur?.rating ?? 0);
      if (r !== 0) return;
      out[pid] = { ...EMPTY_VOTE, ...(cur || {}), rating: SV_VOTE_RATING };
    });
  });
  return out;
}

function countTeamSavedVotes(team, savedVotePlayerIds) {
  return (team?.players || []).filter((p) => savedVotePlayerIds.has(Number(p.id))).length;
}

function teamHasAnySavedVotes(team, savedVotePlayerIds) {
  return countTeamSavedVotes(team, savedVotePlayerIds) > 0;
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

export default function MatchVotesTab({ matchId, canManageLinks, onLinksUpdated, onVotesSaved, scrollViewRef, scrollYRef }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [linkData, setLinkData] = useState(null);
  const [votesData, setVotesData] = useState(null);
  const [votes, _setVotes] = useState({});
  const votesRef = useRef(votes);
  const setVotes = useCallback((updater) => {
    if (typeof updater === 'function') {
      _setVotes((prev) => {
        const next = updater(prev);
        votesRef.current = next;
        return next;
      });
    } else {
      votesRef.current = updater;
      _setVotes(updater);
    }
  }, []);
  votesRef.current = votes;
  const [savedVotePlayerIds, setSavedVotePlayerIds] = useState(() => new Set());
  const [explicitNdPlayerIds, setExplicitNdPlayerIds] = useState(() => new Set());
  const [bonusSettings, setBonusSettings] = useState(DEFAULT_BONUS_SETTINGS);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [picker, setPicker] = useState(null);
  const [draftHomeMd, setDraftHomeMd] = useState(null);
  const [draftAwayMd, setDraftAwayMd] = useState(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const savedSnapshot = useRef('');
  const toastTimerRef = useRef(null);
  const inputRefsMap = useRef({});
  const playerRowRefsMap = useRef({});
  const voteRowRefsMap = useRef({});
  const scrollInputIntoView = useScrollInputAboveKeyboard(scrollViewRef, scrollYRef);

  const showToast = useCallback((text, type = 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2500);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const enableOfficialSvVote = Number(bonusSettings?.enable_official_sv_vote) === 1;

  const focusablePlayerEntries = useMemo(() => {
    const entries = [];
    (votesData?.teams || []).forEach((team) => {
      (team.players || []).forEach((p) => {
        const playerVote = votes[p.id] || votes[String(p.id)] || EMPTY_VOTE;
        const mode = getVoteUiMode(p.id, playerVote, savedVotePlayerIds, explicitNdPlayerIds);
        if (mode === 'saved_nd' || mode === 'draft_nd') return;
        entries.push({ playerId: Number(p.id), teamId: Number(team.id) });
      });
    });
    return entries;
  }, [votesData?.teams, votes, savedVotePlayerIds, explicitNdPlayerIds]);

  const focusablePlayerEntriesRef = useRef(focusablePlayerEntries);
  focusablePlayerEntriesRef.current = focusablePlayerEntries;

  const expandedTeamsRef = useRef(expandedTeams);
  expandedTeamsRef.current = expandedTeams;

  const getInputRef = useCallback((playerId) => (ref) => {
    inputRefsMap.current[playerId] = ref;
  }, []);

  const getRowRef = useCallback((playerId) => (ref) => {
    playerRowRefsMap.current[playerId] = ref;
  }, []);

  const getVoteRowRef = useCallback((playerId) => (ref) => {
    voteRowRefsMap.current[playerId] = ref;
  }, []);

  const scrollToPlayer = useCallback((playerId) => {
    const row = playerRowRefsMap.current[playerId];
    const input = inputRefsMap.current[playerId];
    const node = row || input;
    if (!node) return;
    scrollInputIntoView(node, {
      fixedAboveKeyboard: VOTE_INPUT_FIXED_ABOVE_KEYBOARD,
      fallbackHeight: 52,
    });
  }, [scrollInputIntoView]);

  const focusNextPlayer = useCallback((currentPlayerId) => {
    const entries = focusablePlayerEntriesRef.current;
    const idx = entries.findIndex((e) => e.playerId === Number(currentPlayerId));
    if (idx < 0) return;
    if (idx >= entries.length - 1) {
      Keyboard.dismiss();
      return;
    }
    const next = entries[idx + 1];
    const needsExpand = !expandedTeamsRef.current[next.teamId];
    if (needsExpand) {
      setExpandedTeams((prev) => ({ ...prev, [next.teamId]: true }));
    }
    setTimeout(() => {
      inputRefsMap.current[next.playerId]?.focus();
      scrollToPlayer(next.playerId);
    }, needsExpand ? 150 : 50);
  }, [scrollToPlayer]);

  const applySuggestionsToDraft = useCallback((links) => {
    setDraftHomeMd(pickInitialDraft(links, 'home'));
    setDraftAwayMd(pickInitialDraft(links, 'away'));
  }, []);

  const applyTabPayload = useCallback((payload) => {
    const data = payload || {};
    setLinkData(data);
    applySuggestionsToDraft(data);

    if (data.has_links) {
      setVotesData(data);
      const v = data.votes || {};
      const normalizedVotes = {};
      Object.entries(v).forEach(([k, vote]) => {
        normalizedVotes[Number(k)] = vote;
      });
      const bonus = data.bonus_settings || DEFAULT_BONUS_SETTINGS;
      const svEnabled = Number(bonus.enable_official_sv_vote) === 1;
      const savedIds = new Set(
        (data.saved_vote_player_ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0)
      );
      const votesWithDefaults = applyDefaultSvForUnsetPlayers(data.teams, normalizedVotes, {
        savedPlayerIds: savedIds,
        unavailablePlayerIds: data.unavailable_player_ids,
        svEnabled,
      });
      setVotes(votesWithDefaults);
      setBonusSettings(bonus);
      setSavedVotePlayerIds(savedIds);
      setExplicitNdPlayerIds(new Set());
      savedSnapshot.current = JSON.stringify(v);
      const exp = {};
      (data.teams || []).forEach((t) => { exp[t.id] = true; });
      setExpandedTeams(exp);
    } else {
      setVotesData(null);
      setVotes({});
      setSavedVotePlayerIds(new Set());
      setExplicitNdPlayerIds(new Set());
      savedSnapshot.current = '{}';
    }
  }, [applySuggestionsToDraft]);

  const loadAll = useCallback(async () => {
    if (!matchId) return;
    try {
      setLoading(true);
      setToastMsg(null);
      const res = await adminMatchesService.getVotesTab(matchId);
      applyTabPayload(res.data);
    } catch (e) {
      showToast(e?.response?.data?.message || 'Impossibile caricare i voti');
    } finally {
      setLoading(false);
    }
  }, [matchId, applyTabPayload, showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveLinks = async () => {
    try {
      setSavingLinks(true);
      setToastMsg(null);
      const res = await adminMatchesService.setMatchdayLinks(matchId, {
        home_matchday_id: draftHomeMd,
        away_matchday_id: draftAwayMd,
      });
      const data = res.data || {};
      setLinkData(data);
      setDraftHomeMd(data.current?.home_matchday_id ?? null);
      setDraftAwayMd(data.current?.away_matchday_id ?? null);
      if (onLinksUpdated) onLinksUpdated(data);
      showToast('Collegamenti salvati', 'success');
      if (data.has_links) {
        setLinkEditorOpen(false);
        await loadAll();
      }
    } catch (e) {
      showToast(e?.response?.data?.message || 'Impossibile salvare i collegamenti');
    } finally {
      setSavingLinks(false);
    }
  };

  const openLinkEditor = async () => {
    try {
      if (linkData?.links_lite) {
        const res = await adminMatchesService.getMatchdayLinks(matchId, { full: '1' });
        const data = res.data || {};
        setLinkData(data);
        setDraftHomeMd(data.current?.home_matchday_id ?? pickInitialDraft(data, 'home'));
        setDraftAwayMd(data.current?.away_matchday_id ?? pickInitialDraft(data, 'away'));
      } else if (linkData) {
        setDraftHomeMd(linkData.current?.home_matchday_id ?? pickInitialDraft(linkData, 'home'));
        setDraftAwayMd(linkData.current?.away_matchday_id ?? pickInitialDraft(linkData, 'away'));
      }
      setLinkEditorOpen(true);
    } catch (e) {
      showToast(e?.response?.data?.message || 'Impossibile caricare i collegamenti');
    }
  };

  const closeLinkEditor = () => {
    if (linkData) {
      setDraftHomeMd(linkData.current?.home_matchday_id ?? null);
      setDraftAwayMd(linkData.current?.away_matchday_id ?? null);
    }
    setLinkEditorOpen(false);
  };

  const isLiveDirectField = useCallback((field) => (
    LIVE_DIRECT_VOTE_FIELDS.includes(field)
  ), []);

  const clearExplicitNd = useCallback((playerId) => {
    const pid = Number(playerId);
    setExplicitNdPlayerIds((prev) => {
      if (!prev.has(pid)) return prev;
      const next = new Set(prev);
      next.delete(pid);
      return next;
    });
  }, []);

  const updateRating = useCallback((playerId, change) => {
    const pid = Number(playerId);
    setVotes((prev) => {
      const current = prev[pid] || { ...EMPTY_VOTE };
      const r = Number(current.rating || 0);

      if (isSvVoteRating(r)) {
        if (change < 0) {
          setExplicitNdPlayerIds((existing) => new Set([...existing, pid]));
          return {
            ...prev,
            [pid]: {
              ...current,
              rating: 0,
              goals: 0,
              assists: 0,
              yellow_cards: 0,
              red_cards: 0,
            },
          };
        }
        if (change > 0) {
          clearExplicitNd(pid);
          return { ...prev, [pid]: { ...current, rating: 1 } };
        }
        return prev;
      }

      if (r === 0) {
        if (change < 0) return prev;
        setExplicitNdPlayerIds((existing) => {
          if (!existing.has(pid)) return existing;
          const next = new Set(existing);
          next.delete(pid);
          return next;
        });
        return { ...prev, [pid]: { ...current, rating: enableOfficialSvVote ? SV_VOTE_RATING : 6 } };
      }

      let nr = normalizeVoteRating(r + change);
      if (nr < 1) {
        if (enableOfficialSvVote && Math.abs(r - 1) < 0.001) {
          nr = SV_VOTE_RATING;
        } else {
          nr = 0;
        }
      }
      if (nr > 10) nr = 10;
      if (nr > 0 || isSvVoteRating(nr)) {
        setExplicitNdPlayerIds((existing) => {
          if (!existing.has(pid)) return existing;
          const next = new Set(existing);
          next.delete(pid);
          return next;
        });
      }
      const zeroBonus = clearsBonusFields(nr);
      return {
        ...prev,
        [pid]: {
          ...current,
          rating: nr,
          goals: zeroBonus ? 0 : current.goals,
          assists: zeroBonus ? 0 : current.assists,
          yellow_cards: zeroBonus ? 0 : current.yellow_cards,
          red_cards: zeroBonus ? 0 : current.red_cards,
        },
      };
    });
  }, [enableOfficialSvVote, clearExplicitNd]);

  const setRatingValue = useCallback((playerId, value) => {
    let rating = value === '' || value == null ? 0 : parseFloat(String(value).replace(',', '.'));
    if (isNaN(rating)) return;
    if (isSvVoteRating(rating)) {
      // keep S.V.
    } else if (rating < 1) {
      rating = 0;
    }
    if (rating > 10) rating = 10;
    if (!isSvVoteRating(rating)) rating = normalizeVoteRating(rating);
    const pid = Number(playerId);
    if (rating > 0 || isSvVoteRating(rating)) clearExplicitNd(pid);
    setVotes((prev) => {
      const current = prev[pid] || { ...EMPTY_VOTE };
      const zeroBonus = clearsBonusFields(rating);
      return {
        ...prev,
        [pid]: {
          ...current,
          rating,
          goals: zeroBonus ? 0 : current.goals,
          assists: zeroBonus ? 0 : current.assists,
          yellow_cards: zeroBonus ? 0 : current.yellow_cards,
          red_cards: zeroBonus ? 0 : current.red_cards,
        },
      };
    });
  }, [clearExplicitNd]);

  const activateND = useCallback((playerId) => {
    const pid = Number(playerId);
    setExplicitNdPlayerIds((prev) => new Set([...prev, pid]));
    setVotes((prev) => {
      const current = prev[pid] || prev[String(pid)] || { ...EMPTY_VOTE };
      const cleared = { ...EMPTY_VOTE };
      LIVE_DIRECT_VOTE_FIELDS.forEach((field) => {
        cleared[field] = current[field];
      });
      return { ...prev, [pid]: cleared };
    });
  }, []);

  const toggleND = useCallback((playerId) => {
    const pid = Number(playerId);
    clearExplicitNd(pid);
    const nextRating = enableOfficialSvVote ? SV_VOTE_RATING : 6;
    setVotes((prev) => {
      const current = prev[pid] || prev[String(pid)] || { ...EMPTY_VOTE };
      return { ...prev, [pid]: { ...current, rating: nextRating } };
    });
  }, [clearExplicitNd, enableOfficialSvVote]);

  const updateBonus = useCallback((playerId, field, value) => {
    if (isLiveDirectField(field)) return;
    setVotes((prev) => {
      const current = prev[playerId] || prev[String(playerId)] || { ...EMPTY_VOTE };
      if (clearsBonusFields(current.rating)) return prev;
      return { ...prev, [playerId]: { ...current, [field]: value } };
    });
  }, [isLiveDirectField]);

  const incrementBonus = useCallback((playerId, field) => {
    if (isLiveDirectField(field)) return;
    setVotes((prev) => {
      const current = prev[playerId] || prev[String(playerId)] || { ...EMPTY_VOTE };
      if (clearsBonusFields(current.rating)) return prev;
      return { ...prev, [playerId]: { ...current, [field]: (current[field] || 0) + 1 } };
    });
  }, [isLiveDirectField]);

  const decrementBonus = useCallback((playerId, field) => {
    if (isLiveDirectField(field)) return;
    setVotes((prev) => {
      const current = prev[playerId] || prev[String(playerId)] || { ...EMPTY_VOTE };
      if (clearsBonusFields(current.rating)) return prev;
      const val = (current[field] || 0) - 1;
      return { ...prev, [playerId]: { ...current, [field]: val < 0 ? 0 : val } };
    });
  }, [isLiveDirectField]);

  const flushPendingVoteInputs = useCallback((players) => {
    Keyboard.dismiss();
    let merged = votesRef.current;
    let changed = false;
    const ndPlayerIds = [];
    const ratedPlayerIds = [];

    (players || []).forEach((player) => {
      const pid = Number(player.id);
      const rowHandle = voteRowRefsMap.current[pid] || voteRowRefsMap.current[player.id];
      const commit = rowHandle?.getPendingCommit?.();
      if (!commit) return;

      const current = merged[pid] || merged[String(pid)] || EMPTY_VOTE;
      merged = { ...merged, [pid]: applyVoteInputCommitToVote(current, commit) };
      changed = true;

      if (commit.type === 'nd') ndPlayerIds.push(pid);
      else if (commit.type === 'rating' || commit.type === 'sv') ratedPlayerIds.push(pid);
    });

    if (ndPlayerIds.length) {
      setExplicitNdPlayerIds((prev) => new Set([...prev, ...ndPlayerIds]));
    }
    ratedPlayerIds.forEach((pid) => clearExplicitNd(pid));

    if (changed) {
      setVotes(merged);
    }
    return merged;
  }, [clearExplicitNd]);

  const buildSavePayload = useCallback((teamId = null, votesMap = votesRef.current) => {
    const teamList = votesData?.teams || [];
    const players = [];
    if (teamId) {
      const team = teamList.find((t) => t.id === teamId);
      if (team) players.push(...team.players);
    } else {
      teamList.forEach((t) => players.push(...t.players));
    }
    return buildRatingsPayload(players, votesMap);
  }, [votesData?.teams]);

  const handleSaveTeam = async (teamId) => {
    try {
      setSaving(true);
      setToastMsg(null);
      const teamList = votesData?.teams || [];
      const players = [];
      if (teamId) {
        const team = teamList.find((t) => t.id === teamId);
        if (team) players.push(...team.players);
      } else {
        teamList.forEach((t) => players.push(...t.players));
      }
      const votesToSave = flushPendingVoteInputs(players);
      const res = await adminMatchesService.saveMatchVotes(matchId, {
        ratings: buildSavePayload(teamId, votesToSave),
        team_id: teamId,
      });
      const freshRaw = res.data?.votes || votesToSave;
      const fresh = {};
      Object.entries(freshRaw).forEach(([k, vote]) => {
        fresh[Number(k)] = vote;
      });
      setVotes((prev) => {
        const merged = { ...prev, ...fresh };
        savedSnapshot.current = JSON.stringify(merged);
        return merged;
      });
      const savedIds = res.data?.saved_vote_player_ids;
      if (Array.isArray(savedIds)) {
        setSavedVotePlayerIds((prev) => new Set([
          ...prev,
          ...savedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0),
        ]));
        setExplicitNdPlayerIds((prev) => {
          const next = new Set(prev);
          savedIds.forEach((id) => next.delete(Number(id)));
          return next;
        });
      }
      showToast('Voti salvati', 'success');
      if (onVotesSaved) onVotesSaved();
    } catch (e) {
      showToast(e?.response?.data?.message || 'Impossibile salvare i voti');
    } finally {
      setSaving(false);
    }
  };

  const teamHasSavedVotes = useCallback((team) => (
    teamHasAnySavedVotes(team, savedVotePlayerIds)
  ), [savedVotePlayerIds]);

  const requestSaveTeam = useCallback((team) => {
    if (!team?.id || saving) return;
    const linkTeam = team.side === 'home' ? linkData?.home_team : linkData?.away_team;
    const teamName = linkTeam?.name || team.name || 'Squadra';
    if (teamHasSavedVotes(team)) {
      setConfirmModal({
        title: 'Conferma salvataggio',
        message: `La squadra "${teamName}" ha già voti salvati. Vuoi sovrascriverli con i voti attuali?`,
        confirmText: 'Salva',
        onConfirm: () => {
          setConfirmModal(null);
          void handleSaveTeam(team.id);
        },
      });
      return;
    }
    void handleSaveTeam(team.id);
  }, [saving, linkData, teamHasSavedVotes, handleSaveTeam]);

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
  const lastFocusablePlayerId = focusablePlayerEntries.length
    ? focusablePlayerEntries[focusablePlayerEntries.length - 1].playerId
    : null;

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
                const savedCount = countTeamSavedVotes(team, savedVotePlayerIds);
                const hasSaved = savedCount > 0;
                const linkTeam =
                  team.side === 'home' ? linkData?.home_team : linkData?.away_team;
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
                            {savedCount}/{team.players.length}
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
                          onPress={(e) => { e.stopPropagation(); requestSaveTeam(team); }}
                          disabled={saving}
                        >
                          <Ionicons name={hasSaved ? 'checkmark' : 'save-outline'} size={16} color="#fff" />
                        </TouchableOpacity>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
                      </View>
                    </TouchableOpacity>
                    {isOpen ? (
                      <View style={styles.playersList}>
                        {team.players.map((p) => {
                          const playerVote = votes[p.id] || votes[String(p.id)] || EMPTY_VOTE;
                          const voteUiMode = getVoteUiMode(
                            p.id,
                            playerVote,
                            savedVotePlayerIds,
                            explicitNdPlayerIds
                          );
                          return (
                          <VotesPlayerRow
                            key={p.id}
                            ref={getVoteRowRef(p.id)}
                            player={p}
                            playerVote={playerVote}
                            voteUiMode={voteUiMode}
                            bonusSettings={bonusSettings}
                            bonusEnabled={bonusEnabled}
                            enableOfficialSvVote={enableOfficialSvVote}
                            liveDirectFields={LIVE_DIRECT_VOTE_FIELDS}
                            onSetRating={setRatingValue}
                            onUpdateRating={updateRating}
                            onActivateND={activateND}
                            onToggleND={toggleND}
                            onUpdateBonus={updateBonus}
                            onIncrementBonus={incrementBonus}
                            onDecrementBonus={decrementBonus}
                            inputRef={getInputRef(p.id)}
                            rowRef={getRowRef(p.id)}
                            onSubmitNext={() => focusNextPlayer(p.id)}
                            onInputFocus={scrollToPlayer}
                            isLastInput={Number(p.id) === lastFocusablePlayerId}
                          />
                          );
                        })}
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

      <ConfirmAlertModal
        visible={!!confirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        confirmText={confirmModal?.confirmText}
        onCancel={() => setConfirmModal(null)}
        onConfirm={() => confirmModal?.onConfirm?.()}
      />

      {toastMsg ? (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 16, width: '100%', position: 'relative' },
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
  toast: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
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
