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
import { formatVoteRating, normalizeVoteRating } from '../utils/voteRating';

function VotePlayerRow({ player, vote, onSetRating, onUpdateRating, onToggleSV }) {
  const pv = vote || { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
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

function MatchdayPickerModal({ visible, title, matchdays, occupiedSlots, teamId, selectedId, onSelect, onClose }) {
  const occupiedForTeam = new Set(
    (occupiedSlots || [])
      .filter((s) => Number(s.team_id) === Number(teamId))
      .map((s) => Number(s.matchday_id))
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[styles.mdOption, selectedId == null && styles.mdOptionSelected]}
              onPress={() => onSelect(null)}
            >
              <Text style={styles.mdOptionText}>Nessuna giornata</Text>
            </TouchableOpacity>
            {(matchdays || []).map((md) => {
              const id = Number(md.id);
              const occupied = occupiedForTeam.has(id);
              const isGhost = Number(md.is_ghost) === 1;
              return (
                <TouchableOpacity
                  key={id}
                  style={[
                    styles.mdOption,
                    selectedId === id && styles.mdOptionSelected,
                    occupied && styles.mdOptionDisabled,
                  ]}
                  disabled={occupied}
                  onPress={() => onSelect(id)}
                >
                  <View style={styles.mdOptionRow}>
                    <Text style={[styles.mdOptionText, occupied && styles.mdOptionTextDisabled]}>
                      Giornata {md.giornata}
                      {md.deadline_date ? ` · ${md.deadline_date}` : ''}
                    </Text>
                    {isGhost ? (
                      <View style={styles.ghostPill}>
                        <Ionicons name="moon-outline" size={11} color="#7c6fd6" />
                        <Text style={styles.ghostPillText}>Fantasma</Text>
                      </View>
                    ) : null}
                  </View>
                  {occupied ? (
                    <Text style={styles.mdOccupiedHint}>Squadra già collegata su questa giornata</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
            <Text style={styles.modalCloseBtnText}>Chiudi</Text>
          </TouchableOpacity>
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

  const loadAll = useCallback(async () => {
    if (!matchId) return;
    try {
      setLoading(true);
      setError('');
      const linksRes = await adminMatchesService.getMatchdayLinks(matchId);
      const links = linksRes.data || {};
      setLinkData(links);
      setDraftHomeMd(links.current?.home_matchday_id ?? null);
      setDraftAwayMd(links.current?.away_matchday_id ?? null);

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
  }, [matchId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const matchdayLabel = (id) => {
    const md = (linkData?.matchdays || []).find((m) => Number(m.id) === Number(id));
    if (!md) return 'Seleziona giornata';
    const ghost = Number(md.is_ghost) === 1 ? ' · Fantasma' : '';
    return `Giornata ${md.giornata}${ghost}`;
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
      setFeedback('Collegamenti salvati');
      setTimeout(() => setFeedback(''), 2500);
      if (data.has_links) await loadAll();
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio collegamenti');
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
      setFeedback('Voti salvati');
      setTimeout(() => setFeedback(''), 2500);
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio voti');
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
      setFeedback('Tutti i voti salvati');
      setTimeout(() => setFeedback(''), 2500);
    } catch (e) {
      setError(e?.response?.data?.message || 'Errore salvataggio voti');
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

  return (
    <View style={styles.wrap}>
      {canManageLinks ? (
        <View style={styles.linkCard}>
          <View style={styles.linkCardHeader}>
            <Ionicons name="link-outline" size={20} color="#667eea" />
            <Text style={styles.linkCardTitle}>Collega alle giornate del calendario</Text>
          </View>
          <Text style={styles.linkCardHint}>
            Ogni squadra può essere associata a una giornata diversa. Una squadra non può avere due partite sulla stessa giornata.
          </Text>

          <Text style={styles.teamLinkLabel}>{linkData?.home_team?.name || 'Casa'}</Text>
          <TouchableOpacity
            style={styles.mdSelectBtn}
            onPress={() => setPicker({ side: 'home', teamId: linkData?.home_team?.id })}
          >
            <Text style={styles.mdSelectBtnText}>{matchdayLabel(draftHomeMd)}</Text>
            <Ionicons name="chevron-down" size={18} color="#667eea" />
          </TouchableOpacity>

          <Text style={[styles.teamLinkLabel, { marginTop: 12 }]}>{linkData?.away_team?.name || 'Trasferta'}</Text>
          <TouchableOpacity
            style={styles.mdSelectBtn}
            onPress={() => setPicker({ side: 'away', teamId: linkData?.away_team?.id })}
          >
            <Text style={styles.mdSelectBtnText}>{matchdayLabel(draftAwayMd)}</Text>
            <Ionicons name="chevron-down" size={18} color="#667eea" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveLinksBtn, (!linksChanged || savingLinks) && styles.saveLinksBtnDisabled]}
            disabled={!linksChanged || savingLinks}
            onPress={handleSaveLinks}
          >
            {savingLinks ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.saveLinksBtnText}>Salva collegamenti</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#dc3545" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {feedback ? (
        <View style={styles.feedbackBox}>
          <Ionicons name="checkmark-circle" size={18} color="#198754" />
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}

      {!linkData?.has_links ? (
        <View style={styles.emptyBox}>
          <Ionicons name="calendar-outline" size={40} color="#cbd5e1" />
          <Text style={styles.emptyTitle}>Nessun collegamento attivo</Text>
          <Text style={styles.emptySub}>
            {canManageLinks
              ? 'Collega almeno una squadra a una giornata del calendario ufficiale per abilitare l\'inserimento voti.'
              : 'Il superamministratore deve collegare questa partita a una giornata del calendario.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.votesHeader}>
            <Text style={styles.votesHeaderTitle}>Inserisci voti</Text>
            <TouchableOpacity
              style={[styles.saveAllBtn, saving && { opacity: 0.6 }]}
              onPress={handleSaveAll}
              disabled={saving}
            >
              <Ionicons name="save-outline" size={16} color="#fff" />
              <Text style={styles.saveAllBtnText}>Salva tutto</Text>
            </TouchableOpacity>
          </View>

          {teams.map((team) => {
            const isOpen = !!expandedTeams[team.id];
            const voted = team.players.filter((p) => (votes[p.id]?.rating || 0) > 0).length;
            return (
              <View key={team.id} style={styles.teamCard}>
                <TouchableOpacity
                  style={styles.teamHeader}
                  onPress={() => setExpandedTeams((e) => ({ ...e, [team.id]: !e[team.id] }))}
                >
                  <View style={styles.teamHeaderLeft}>
                    <Text style={styles.teamName}>{team.name}</Text>
                    <View style={styles.giornataPill}>
                      <Text style={styles.giornataPillText}>G.{team.giornata}</Text>
                      {team.is_ghost ? (
                        <Ionicons name="moon-outline" size={12} color="#7c6fd6" style={{ marginLeft: 4 }} />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.teamHeaderRight}>
                    <Text style={styles.votedCount}>{voted}/{team.players.length}</Text>
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
      )}

      <MatchdayPickerModal
        visible={!!picker}
        title={picker?.side === 'home' ? 'Giornata squadra casa' : 'Giornata squadra trasferta'}
        matchdays={linkData?.matchdays}
        occupiedSlots={linkData?.occupied_slots}
        teamId={picker?.teamId}
        selectedId={picker?.side === 'home' ? draftHomeMd : draftAwayMd}
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
  wrap: { paddingBottom: 24 },
  centered: { paddingVertical: 40, alignItems: 'center' },
  linkCard: {
    backgroundColor: '#f8f9ff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  linkCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  linkCardTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  linkCardHint: { fontSize: 13, color: '#64748b', lineHeight: 18, marginBottom: 14 },
  teamLinkLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  mdSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  mdSelectBtnText: { fontSize: 14, color: '#1e293b', fontWeight: '500' },
  saveLinksBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#667eea',
    borderRadius: 10,
    paddingVertical: 12,
  },
  saveLinksBtnDisabled: { opacity: 0.45 },
  saveLinksBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { flex: 1, color: '#dc3545', fontSize: 13 },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ecfdf3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  feedbackText: { color: '#198754', fontWeight: '600', fontSize: 13 },
  emptyBox: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#64748b', marginTop: 12 },
  emptySub: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 8, lineHeight: 19 },
  votesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  votesHeaderTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  saveAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#198754',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveAllBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  teamHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 8 },
  teamName: { fontSize: 15, fontWeight: '700', color: '#1e293b', flexShrink: 1 },
  giornataPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  giornataPillText: { fontSize: 11, fontWeight: '700', color: '#667eea' },
  teamHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  votedCount: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  teamSaveBtn: {
    backgroundColor: '#667eea',
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersList: { paddingHorizontal: 10, paddingBottom: 8 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 6,
  },
  roleBadge: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  roleBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  playerName: { flex: 1, fontSize: 13, color: '#334155' },
  svBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  svBtnActive: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  svBtnText: { fontSize: 10, fontWeight: '700', color: '#94a3b8' },
  svBtnTextActive: { color: '#dc3545' },
  ratingBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtnText: { fontSize: 16, fontWeight: '700', color: '#475569' },
  ratingInput: {
    width: 44,
    height: 32,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    backgroundColor: '#fff',
  },
  ratingInputSV: { borderColor: '#fecaca', color: '#dc3545' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  modalList: { maxHeight: 360 },
  mdOption: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  mdOptionSelected: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  mdOptionDisabled: { opacity: 0.5 },
  mdOptionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mdOptionText: { fontSize: 14, color: '#334155', fontWeight: '500' },
  mdOptionTextDisabled: { color: '#94a3b8' },
  mdOccupiedHint: { fontSize: 11, color: '#dc3545', marginTop: 4 },
  ghostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f3f0ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ghostPillText: { fontSize: 10, color: '#7c6fd6', fontWeight: '700' },
  modalCloseBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
  },
  modalCloseBtnText: { fontWeight: '700', color: '#475569' },
});
