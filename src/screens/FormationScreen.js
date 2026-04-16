import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Modal, FlatList, Dimensions, Animated, PanResponder,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { formationService, leagueService, squadService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');

// ============================================================
// Moduli formazione (D-C-A) — portiere sempre 1, escluso dalla notazione
// Chiave = "D-C-A", valore = [D, C, A]
// ============================================================
const ALL_MODULES = {
  // 4 titolari (3 di movimento)
  '1-1-1': [1,1,1],
  // 5 titolari (4 di movimento)
  '1-1-2': [1,1,2], '1-2-1': [1,2,1], '2-1-1': [2,1,1],
  // 6 titolari
  '1-2-2': [1,2,2], '2-2-1': [2,2,1], '2-1-2': [2,1,2], '3-1-1': [3,1,1],
  // 7 titolari
  '2-2-2': [2,2,2], '3-2-1': [3,2,1], '2-3-1': [2,3,1], '1-3-2': [1,3,2], '3-1-2': [3,1,2],
  // 8 titolari
  '3-2-2': [3,2,2], '2-3-2': [2,3,2], '2-2-3': [2,2,3], '4-2-1': [4,2,1], '3-3-1': [3,3,1], '4-3-1': [4,3,1],
  // 9 titolari
  '3-3-2': [3,3,2], '3-2-3': [3,2,3], '2-3-3': [2,3,3], '4-2-2': [4,2,2],
  // 10 titolari
  '3-3-3': [3,3,3], '4-2-3': [4,2,3], '3-4-2': [3,4,2], '2-4-3': [2,4,3], '5-2-2': [5,2,2],
  '4-3-2': [4,3,2], '2-5-2': [2,5,2], '3-5-1': [3,5,1], '4-4-1': [4,4,1],
  // 11 titolari (classici)
  '4-4-2': [4,4,2], '4-3-3': [4,3,3], '3-5-2': [3,5,2], '4-5-1': [4,5,1], '5-3-2': [5,3,2],
  '5-4-1': [5,4,1], '5-2-3': [5,2,3], '3-4-3': [3,4,3], '3-6-1': [3,6,1],
  '6-3-1': [6,3,1], '6-2-2': [6,2,2],
  '2-5-3': [2,5,3], '7-2-1': [7,2,1],
};

const ROLE_COLOR = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
const ROLE_LABEL = { P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' };
const FIELD_H = 420;

// Tronca al centro: "Moscatelli" → "Mos...lli"
const midTruncate = (str, max = 9) => {
  if (!str || str.length <= max) return str || '';
  const tail = 3;
  const head = max - tail - 3; // 3 = "..."
  return str.slice(0, head) + '...' + str.slice(-tail);
};

// ============================================================
export default function FormationScreen({ route }) {
  const { user } = useAuth();
  const { markDone } = useOnboarding();
  const leagueId = route?.params?.leagueId || 1;

  // --- State ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [league, setLeague] = useState(null);
  const [matchdays, setMatchdays] = useState([]);
  const [selectedMatchday, setSelectedMatchday] = useState(null);
  const [squad, setSquad] = useState([]);          // rosa giocatori utente
  const [numeroTitolari, setNumeroTitolari] = useState(11);
  const [autoLineup, setAutoLineup] = useState(false);

  // Formazione corrente
  const [modulo, setModulo] = useState(null);       // string "4-4-2"
  const [starters, setStarters] = useState([]);     // array di player objects o null per slot vuoti
  const [bench, setBench] = useState([]);           // array di player objects

  // Deadline
  const [deadlineStr, setDeadlineStr] = useState(null);
  const [isExpired, setIsExpired] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);   // true se esiste già una formazione salvata
  const [countdown, setCountdown] = useState(null);  // { days, hours, mins, secs } o null

  // UI
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerRole, setPickerRole] = useState(null);    // ruolo filtro ('P','D','C','A' o null per panchina)
  const [pickerSlotIdx, setPickerSlotIdx] = useState(null); // indice nello starters array, o 'bench'

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  const parseIdList = (value) => {
    if (Array.isArray(value)) {
      return value.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? [Number(value)] : [];
    }
    if (typeof value !== 'string') return [];

    const raw = value.trim();
    if (!raw) return [];

    const candidates = [raw];
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      candidates.push(raw.slice(1, -1).trim());
    }
    if (raw.includes('\\"') || raw.includes('\\\\')) {
      candidates.push(raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim());
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        const ids = parseIdList(parsed);
        if (ids.length > 0) return ids;
      } catch (_) {}

      if (candidate.includes(',')) {
        const csvIds = candidate
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((s) => Number(String(s).trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (csvIds.length > 0) return csvIds;
      }
    }

    const regexIds = raw
      .match(/\d+/g)
      ?.map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    return regexIds || [];
  };

  // --- Moduli disponibili in base al numero titolari ---
  const availableModules = useMemo(() => {
    const movSlots = numeroTitolari - 1; // 1 portiere fisso
    return Object.entries(ALL_MODULES)
      .filter(([, arr]) => arr[0] + arr[1] + arr[2] === movSlots)
      .map(([key, arr]) => ({ key, d: arr[0], c: arr[1], a: arr[2] }));
  }, [numeroTitolari]);

  // Mappa id->player per lookup veloce
  const playerById = useMemo(() => {
    const m = {};
    squad.forEach(p => { m[p.id] = p; });
    return m;
  }, [squad]);

  // Set di id gia' selezionati
  const starterIds = useMemo(() => {
    const s = new Set();
    starters.forEach(p => { if (p) s.add(p.id); });
    return s;
  }, [starters]);

  const benchIds = useMemo(() => {
    const s = new Set();
    bench.forEach(p => { if (p) s.add(p.id); });
    return s;
  }, [bench]);

  const usedIds = useMemo(() => {
    return new Set([...starterIds, ...benchIds]);
  }, [starterIds, benchIds]);

  // Giocatori disponibili per ruolo
  // Per titolari: mostra anche i panchinari (verranno spostati automaticamente)
  // Per panchina: mostra solo chi non è né titolare né panchinaro
  const availableForRole = useCallback((role) => {
    return squad.filter(p => {
      if (role && p.role !== role) return false;
      if (role) {
        // Selezione titolare: escludi solo altri titolari
        if (starterIds.has(p.id)) return false;
      } else {
        // Selezione panchina: escludi titolari e panchinari
        if (usedIds.has(p.id)) return false;
      }
      return true;
    });
  }, [squad, starterIds, usedIds]);

  // --- Parsing modulo -> slot array ---
  const moduleParts = useMemo(() => {
    if (!modulo || !ALL_MODULES[modulo]) return null;
    const [d, c, a] = ALL_MODULES[modulo];
    return { d, c, a };
  }, [modulo]);

  // Costruisce l'array di slot titolari dalla struttura modulo
  const buildStarterSlots = useCallback((mod, prevStarters) => {
    if (!mod || !ALL_MODULES[mod]) return [];
    const [d, c, a] = ALL_MODULES[mod];
    const total = 1 + d + c + a;
    const roles = ['P', ...Array(d).fill('D'), ...Array(c).fill('C'), ...Array(a).fill('A')];
    const newSlots = roles.map((role, i) => {
      // Riusa giocatore precedente se stesso ruolo e indice
      if (prevStarters[i] && prevStarters[i].role === role) return prevStarters[i];
      return null;
    });
    return newSlots;
  }, []);

  // ============================================================
  // LOAD DATA
  // ============================================================
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [matchdaysRes, leagueRes, squadRes, settingsRes] = await Promise.all([
        formationService.getMatchdays(leagueId),
        leagueService.getById(leagueId).catch(() => ({ data: null })),
        squadService.getSquad(leagueId).catch(() => ({ data: { players: [] } })),
        leagueService.getSettings(leagueId).catch(() => ({ data: {} })),
      ]);

      const md = matchdaysRes.data || [];
      setMatchdays(md);

      if (leagueRes?.data) {
        const ld = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
        setLeague(ld);
      }

      const players = squadRes?.data?.players || [];
      setSquad(players);

      const nt = settingsRes?.data?.numero_titolari || 11;
      const al = !!(settingsRes?.data?.auto_lineup_mode);
      setNumeroTitolari(nt);
      setAutoLineup(al);

      // Seleziona giornata default: la prima con scadenza futura, altrimenti l'ultima
      if (md.length > 0) {
        const now = new Date();
        const futureMatchday = md.find(m => m.deadline && new Date(m.deadline) > now);
        const defaultMd = futureMatchday ? futureMatchday.giornata : md[md.length - 1].giornata;
        setSelectedMatchday(defaultMd);
        await loadFormationForMatchday(defaultMd, players);
      }
    } catch (error) {
      console.error('FormationScreen loadInitialData:', error);
      showToast('Impossibile caricare i dati');
    } finally {
      setLoading(false);
    }
  };

  const loadFormationForMatchday = async (giornata, squadOverride) => {
    try {
      const res = await formationService.getFormation(leagueId, giornata);
      const data = res.data || {};
      setDeadlineStr(data.deadline || null);
      setIsExpired(!!data.isExpired);

      const playersMap = {};
      (squadOverride || squad).forEach(p => { playersMap[p.id] = p; });

      const saved = data.formation;
      if (saved && saved.modulo) {
        setModulo(saved.modulo);
        // Parse titolari (compat con vecchi formati/stringhe escape)
        const titIds = parseIdList(saved.titolari);
        // Ricostruisci starters con oggetti player
        const mod = ALL_MODULES[saved.modulo];
        if (mod) {
          const [d, c, a] = mod;
          const roles = ['P', ...Array(d).fill('D'), ...Array(c).fill('C'), ...Array(a).fill('A')];
          const newStarters = roles.map((role, i) => {
            const pid = titIds[i];
            if (pid && playersMap[pid]) return playersMap[pid];
            return null;
          });
          setStarters(newStarters);
        }
        // Parse panchina (compat con vecchi formati/stringhe escape)
        const benchIds = parseIdList(saved.panchina);
        setBench(benchIds.map(id => playersMap[id] || null).filter(Boolean));
        setHasSaved(true);
        markDone('submitted_formation');
      } else {
        // Nessuna formazione salvata — prova default modulo
        setModulo(null);
        setStarters([]);
        setBench([]);
        setHasSaved(false);
      }
    } catch (error) {
      console.error('loadFormation error:', error);
    }
  };

  useFocusEffect(
    useCallback(() => { loadInitialData(); }, [leagueId])
  );

  // Countdown live
  useEffect(() => {
    if (!deadlineStr) { setCountdown(null); return; }
    const tick = () => {
      const now = Date.now();
      const target = new Date(deadlineStr).getTime();
      const diff = target - now;
      if (diff <= 0) {
        setCountdown(null);
        setIsExpired(true);
        return false; // stop
      }
      const days  = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      const secs  = Math.floor((diff % 60000) / 1000);
      setCountdown({ days, hours, mins, secs });
      return true; // continue
    };
    if (!tick()) return;
    const id = setInterval(() => { if (!tick()) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [deadlineStr]);

  // Quando cambia giornata
  const handleMatchdayChange = async (giornata) => {
    setSelectedMatchday(giornata);
    await loadFormationForMatchday(giornata);
  };

  // Quando cambia modulo
  const handleModuleChange = (mod) => {
    setModulo(mod);
    setStarters(buildStarterSlots(mod, starters));
  };

  // --- Player selection ---
  const openPicker = (role, slotIdx) => {
    setPickerRole(role);
    setPickerSlotIdx(slotIdx);
    setPickerVisible(true);
  };

  const selectPlayer = (player) => {
    if (pickerSlotIdx === 'bench') {
      setBench(prev => [...prev, player]);
    } else if (typeof pickerSlotIdx === 'number') {
      // Se il giocatore era in panchina, rimuovilo automaticamente
      setBench(prev => prev.filter(p => p.id !== player.id));
      setStarters(prev => {
        const arr = [...prev];
        arr[pickerSlotIdx] = player;
        return arr;
      });
    }
    setPickerVisible(false);
  };

  const removeStarter = (idx) => {
    setStarters(prev => {
      const arr = [...prev];
      arr[idx] = null;
      return arr;
    });
  };

  const removeBench = (idx) => {
    setBench(prev => prev.filter((_, i) => i !== idx));
  };

  // --- Drag-to-reorder bench (3-column grid) ---
  const BENCH_COLS = 3;
  const BENCH_GAP = 8;
  const BENCH_CARD_W = (SCREEN_W - 28 - BENCH_GAP * (BENCH_COLS - 1)) / BENCH_COLS;
  const BENCH_CARD_H = 52;

  const [dragState, setDragState] = useState({ active: false, fromIdx: null, toIdx: null });
  const dragPos = useRef(new Animated.ValueXY()).current;
  const lastTarget = useRef(null);
  const benchRef = useRef(bench);
  benchRef.current = bench;

  const calcTarget = useCallback((index, dx, dy) => {
    const colOff = Math.round(dx / (BENCH_CARD_W + BENCH_GAP));
    const rowOff = Math.round(dy / (BENCH_CARD_H + BENCH_GAP));
    return Math.max(0, Math.min(benchRef.current.length - 1, index + rowOff * BENCH_COLS + colOff));
  }, [BENCH_CARD_W]);

  // Un singolo PanResponder condiviso — l'indice viene passato nel grant
  const dragIndexRef = useRef(null);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: () => {
      const idx = dragIndexRef.current;
      if (idx === null) return;
      lastTarget.current = idx;
      dragPos.setValue({ x: 0, y: 0 });
      setDragState({ active: true, fromIdx: idx, toIdx: idx });
    },
    onPanResponderMove: (_, g) => {
      dragPos.setValue({ x: g.dx, y: g.dy });
      const idx = dragIndexRef.current;
      if (idx === null) return;
      const target = calcTarget(idx, g.dx, g.dy);
      if (target !== lastTarget.current) {
        lastTarget.current = target;
        setDragState(prev => ({ ...prev, toIdx: target }));
      }
    },
    onPanResponderRelease: (_, g) => {
      const idx = dragIndexRef.current;
      if (idx === null) return;
      const newIdx = calcTarget(idx, g.dx, g.dy);
      if (newIdx !== idx) {
        setBench(prev => {
          const arr = [...prev];
          const [item] = arr.splice(idx, 1);
          arr.splice(newIdx, 0, item);
          return arr;
        });
      }
      setDragState({ active: false, fromIdx: null, toIdx: null });
      dragPos.setValue({ x: 0, y: 0 });
      dragIndexRef.current = null;
    },
    onPanResponderTerminate: () => {
      setDragState({ active: false, fromIdx: null, toIdx: null });
      dragPos.setValue({ x: 0, y: 0 });
      dragIndexRef.current = null;
    },
  }), [calcTarget]);

  // --- Save ---
  const doSave = async () => {
    const titolariIds = starters.map(p => p ? p.id : 0);
    const panchinaIds = bench.map(p => p.id);
    try {
      setSaving(true);
      await formationService.saveFormation(leagueId, selectedMatchday, {
        modulo,
        titolari: titolariIds,
        panchina: panchinaIds,
      });
      markDone('submitted_formation');
      setHasSaved(true);
      showToast('Formazione salvata!', 'success');
    } catch (error) {
      showToast(error.response?.data?.message || error.response?.data?.error || 'Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!modulo) {
      showToast('Seleziona un modulo');
      return;
    }
    if (isExpired) {
      showToast('La scadenza per questa giornata è passata');
      return;
    }
    if (hasSaved) {
      setConfirmModal({
        title: 'Sovrascrivere formazione?',
        message: 'Hai già una formazione salvata per questa giornata. Vuoi sovrascriverla?',
        confirmText: 'Sovrascrivi',
        destructive: true,
        onConfirm: () => { setConfirmModal(null); doSave(); },
      });
    } else {
      doSave();
    }
  };

  // ============================================================
  // RENDER HELPERS
  // ============================================================
  const formatDeadlineDate = (dl) => {
    if (!dl) return '';
    const d = new Date(dl);
    const day = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return `${day} alle ${time}`;
  };

  // --- Loading ---
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  // --- Empty ---
  if (matchdays.length === 0) {
    return (
      <View style={s.center}>
        <Ionicons name="calendar-outline" size={64} color="#ccc" />
        <Text style={s.emptyTitle}>Nessuna giornata disponibile</Text>
        <Text style={s.emptySub}>L'admin deve prima definire le giornate</Text>
      </View>
    );
  }

  // --- Slots per il campo ---
  const fieldRows = [];
  if (moduleParts) {
    let idx = 1; // 0 = portiere
    fieldRows.push({ role: 'A', slots: starters.slice(idx + moduleParts.d + moduleParts.c, idx + moduleParts.d + moduleParts.c + moduleParts.a), startIdx: idx + moduleParts.d + moduleParts.c });
    fieldRows.push({ role: 'C', slots: starters.slice(idx + moduleParts.d, idx + moduleParts.d + moduleParts.c), startIdx: idx + moduleParts.d });
    fieldRows.push({ role: 'D', slots: starters.slice(idx, idx + moduleParts.d), startIdx: idx });
    fieldRows.push({ role: 'P', slots: [starters[0]], startIdx: 0 });
  }

  // ============================================================
  // MAIN RENDER
  // ============================================================
  return (
    <View style={s.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: autoLineup ? 80 : 175 }}>
        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.title}>Formazione</Text>
          {league && <Text style={s.leagueName}>{league.name}</Text>}
        </View>

        {/* ── Matchday selector ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.mdRow} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
          {matchdays.map(m => {
            const active = m.giornata === selectedMatchday;
            const past = m.deadline && new Date(m.deadline) < new Date();
            return (
              <TouchableOpacity
                key={m.giornata}
                style={[s.mdChip, active && s.mdChipActive, past && !active && s.mdChipPast]}
                onPress={() => handleMatchdayChange(m.giornata)}
              >
                <Text style={[s.mdChipText, active && s.mdChipTextActive]}>{m.giornata}ª G</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── Auto lineup banner ── */}
        {autoLineup && (
          <View style={s.bannerGreen}>
            <Ionicons name="flash" size={16} color="#2e7d32" />
            <Text style={s.bannerGreenText}>Formazione automatica attiva</Text>
          </View>
        )}

        {/* ── Deadline countdown ── */}
        {!autoLineup && deadlineStr && (
          isExpired ? (
            <View style={s.deadlineExpired}>
              <Ionicons name="lock-closed" size={18} color="#c62828" />
              <Text style={s.deadlineExpiredText}>Scadenza passata — formazione bloccata</Text>
            </View>
          ) : countdown ? (() => {
            const totalMins = countdown.days * 1440 + countdown.hours * 60 + countdown.mins;
            const showSecs = totalMins < 5;
            const urgent = totalMins < 60;
            const parts = [];
            if (countdown.days > 0) parts.push({ val: countdown.days, unit: 'g' });
            if (countdown.hours > 0 || countdown.days > 0) parts.push({ val: countdown.hours, unit: 'h' });
            parts.push({ val: countdown.mins, unit: 'm' });
            if (showSecs) parts.push({ val: countdown.secs, unit: 's' });
            return (
              <View style={[s.deadlineBox, urgent && s.deadlineBoxUrgent]}>
                <View style={s.deadlineTop}>
                  <Ionicons name="time-outline" size={15} color={urgent ? '#e53935' : '#667eea'} />
                  <Text style={s.deadlineLabel}>{formatDeadlineDate(deadlineStr)}</Text>
                </View>
                <View style={s.countdownRow}>
                  {parts.map((p, i) => (
                    <View key={p.unit} style={s.countdownCell}>
                      <Text style={[s.countdownNum, urgent && s.countdownNumUrgent]}>{p.val}</Text>
                      <Text style={[s.countdownUnit, urgent && s.countdownUnitUrgent]}>{p.unit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })() : null
        )}

        {/* ── Auto lineup: non mostrare il resto ── */}
        {autoLineup ? (
          <View style={s.autoInfo}>
            <Ionicons name="information-circle-outline" size={22} color="#666" />
            <Text style={s.autoInfoText}>La formazione viene schierata automaticamente ad ogni giornata in base ai voti dei tuoi giocatori.</Text>
          </View>
        ) : (
          <>
            {/* ── Selettore modulo ── */}
            <View style={s.sectionLabel}>
              <Text style={s.sectionLabelText}>Modulo</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.moduleRow} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
              {availableModules.map(m => {
                const active = modulo === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[s.moduleChip, active && s.moduleChipActive]}
                    onPress={() => handleModuleChange(m.key)}
                    disabled={isExpired}
                  >
                    <Text style={[s.moduleChipText, active && s.moduleChipTextActive]}>{m.key}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ── Campo da calcio ── */}
            {modulo && moduleParts ? (
              <View style={s.fieldWrapper}>
                <View style={s.field}>
                  {/* Linee del campo */}
                  <View style={s.fieldCenter} />
                  <View style={s.fieldCircle} />
                  <View style={s.fieldAreaTop} />
                  <View style={s.fieldAreaBottom} />

                  {/* Righe giocatori */}
                  {fieldRows.map((row, ri) => {
                    const count = row.slots.length;
                    // Centrocampo più basso quando 4 giocatori; > 4 gestito dallo sfasamento
                    const topPct = ri === 0 ? 6
                      : ri === 1 ? (count <= 4 ? 35 : 30)
                      : ri === 2 ? 58 : 82;
                    // Cerchi sempre 70px — sfasamento verticale forte permette sovrapposizione
                    const slotSize = 70;
                    const fontSize = 11;
                    const teamFontSize = 8;
                    const truncLen = 10;
                    const iconSize = 18;
                    const slotMarginH = count >= 7 ? -10 : count >= 6 ? -8 : count >= 5 ? -3 : 0;

                    return (
                      <View key={ri} style={[s.fieldRow, { top: `${topPct}%` }, count >= 5 && { justifyContent: 'center', marginHorizontal: 4 }, count === 4 && { justifyContent: 'center', gap: 4 }]}>
                        {row.slots.map((player, si) => {
                          const globalIdx = row.startIdx + si;
                          const roleColor = ROLE_COLOR[row.role];
                          // Sfasamento verticale: laterali molto in alto, centrali molto in basso
                          let yOffset = 0;
                          if (count >= 5) {
                            const center = (count - 1) / 2;
                            const dist = Math.abs(si - center) / center; // 1 = esterno, 0 = centro
                            const up = count >= 7 ? -130 : count >= 6 ? -120 : -110;
                            const down = count >= 7 ? 20 : count >= 6 ? 18 : 15;
                            yOffset = Math.round(up * dist + down * (1 - dist));
                          }

                          const dynSlot = {
                            width: slotSize, height: slotSize, borderRadius: slotSize / 2,
                            ...(yOffset !== 0 ? { marginTop: yOffset } : {}),
                            ...(slotMarginH !== 0 ? { marginHorizontal: slotMarginH } : {}),
                          };

                          if (player) {
                            return (
                              <TouchableOpacity
                                key={globalIdx}
                                style={[s.playerSlot, { borderColor: roleColor, backgroundColor: roleColor }, dynSlot]}
                                onPress={() => !isExpired && removeStarter(globalIdx)}
                                disabled={isExpired}
                              >
                                <Text style={[s.playerSlotName, { fontSize }]} numberOfLines={1}>{midTruncate(player.last_name, truncLen)}</Text>
                                <Text style={[s.playerSlotTeam, { fontSize: teamFontSize }]} numberOfLines={1}>{midTruncate(player.team_name, truncLen)}</Text>
                              </TouchableOpacity>
                            );
                          }
                          return (
                            <TouchableOpacity
                              key={globalIdx}
                              style={[s.emptySlot, { borderColor: roleColor }, dynSlot]}
                              onPress={() => !isExpired && openPicker(row.role, globalIdx)}
                              disabled={isExpired}
                            >
                              <Ionicons name="add" size={iconSize} color={roleColor} />
                              <Text style={[s.emptySlotLabel, { color: roleColor, fontSize: teamFontSize }]}>{row.role}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={s.noModule}>
                <Ionicons name="football-outline" size={40} color="#bbb" />
                <Text style={s.noModuleText}>Seleziona un modulo per iniziare</Text>
              </View>
            )}

            {/* ── Panchina ── */}
            <View style={s.sectionLabel}>
              <Text style={s.sectionLabelText}>Panchina ({bench.length})</Text>
              <Text style={s.sectionLabelHint}>Trascina per riordinare</Text>
            </View>
            <View style={s.benchGrid}>
              {bench.map((player, i) => {
                const isDragging = dragState.active && dragState.fromIdx === i;
                const isTarget = dragState.active && dragState.toIdx === i && dragState.fromIdx !== i;
                return (
                  <View
                    key={player.id}
                    onTouchStart={() => { dragIndexRef.current = i; }}
                    {...panResponder.panHandlers}
                    style={[
                      s.benchCard,
                      { borderTopColor: ROLE_COLOR[player.role], width: BENCH_CARD_W },
                      isTarget && s.benchCardTarget,
                      isDragging && s.benchCardPlaceholder,
                    ]}
                  >
                    {!isDragging && (
                      <>
                        <TouchableOpacity
                          onPress={() => !isExpired && removeBench(i)}
                          disabled={isExpired}
                          style={s.benchRemoveBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={15} color="#ccc" />
                        </TouchableOpacity>
                        <View style={s.benchCardBody}>
                          <View style={[s.benchRoleBadge, { backgroundColor: ROLE_COLOR[player.role] }]}>
                            <Text style={s.benchRoleBadgeText}>{player.role}</Text>
                          </View>
                          <View style={s.benchInfo}>
                            <Text style={s.benchName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{player.last_name}</Text>
                            <Text style={s.benchTeam} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{player.team_name}</Text>
                          </View>
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
              {availableForRole(null).length > 0 && (
                <TouchableOpacity
                  style={[s.benchAddBtn, { width: BENCH_CARD_W }]}
                  onPress={() => !isExpired && openPicker(null, 'bench')}
                  disabled={isExpired}
                >
                  <Ionicons name="add" size={22} color="#999" />
                </TouchableOpacity>
              )}

              {/* Ghost: item trascinato che segue il dito */}
              {dragState.active && bench[dragState.fromIdx] && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    s.benchCard,
                    s.benchCardGhost,
                    {
                      borderTopColor: ROLE_COLOR[bench[dragState.fromIdx].role],
                      width: BENCH_CARD_W,
                      left: (dragState.fromIdx % BENCH_COLS) * (BENCH_CARD_W + BENCH_GAP),
                      top: Math.floor(dragState.fromIdx / BENCH_COLS) * (BENCH_CARD_H + BENCH_GAP),
                      transform: [{ translateX: dragPos.x }, { translateY: dragPos.y }],
                    },
                  ]}
                >
                  <View style={s.benchCardBody}>
                    <View style={[s.benchRoleBadge, { backgroundColor: ROLE_COLOR[bench[dragState.fromIdx].role] }]}>
                      <Text style={s.benchRoleBadgeText}>{bench[dragState.fromIdx].role}</Text>
                    </View>
                    <View style={s.benchInfo}>
                      <Text style={s.benchName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{bench[dragState.fromIdx].last_name}</Text>
                      <Text style={s.benchTeam} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{bench[dragState.fromIdx].team_name}</Text>
                    </View>
                  </View>
                </Animated.View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Pulsante Salva (sempre visibile in basso) ── */}
      {!autoLineup && (
        <View style={s.saveBar}>
          <TouchableOpacity
            style={[s.saveBtn, hasSaved && s.saveBtnSaved, (isExpired || saving) && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isExpired || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name={hasSaved ? "checkmark-circle-outline" : "save-outline"} size={18} color="#fff" />
                <Text style={s.saveBtnText}>{hasSaved ? 'Aggiorna Formazione' : 'Salva Formazione'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Toast ── */}
      {toastMsg && (
        <View style={[s.toast, toastMsg.type === 'success' ? s.toastSuccess : s.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={s.toastText}>{toastMsg.text}</Text>
        </View>
      )}

      {/* ── Confirm Modal ── */}
      <Modal visible={!!confirmModal} transparent animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={s.confirmOverlay}>
          <View style={s.confirmContent}>
            <View style={[s.confirmIconWrap, !confirmModal?.destructive && { backgroundColor: '#eef0fb' }]}>
              <Ionicons name={confirmModal?.destructive ? 'warning' : 'information-circle'} size={40} color={confirmModal?.destructive ? '#e53935' : '#667eea'} />
            </View>
            <Text style={s.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={s.confirmMessage}>{confirmModal?.message}</Text>
            <View style={s.confirmButtons}>
              <TouchableOpacity style={s.confirmBtnCancel} onPress={() => setConfirmModal(null)}>
                <Text style={s.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtnAction, confirmModal?.destructive && { backgroundColor: '#e53935' }]} onPress={() => confirmModal?.onConfirm?.()}>
                <Text style={s.confirmBtnActionText}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modale selezione giocatore ── */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {pickerRole ? `Seleziona ${ROLE_LABEL[pickerRole] || 'Giocatore'}` : 'Seleziona Giocatore'}
              </Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={availableForRole(pickerRole)}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => {
                const isOnBench = benchIds.has(item.id);
                return (
                  <TouchableOpacity style={s.modalRow} onPress={() => selectPlayer(item)}>
                    <View style={[s.modalRoleBadge, { backgroundColor: ROLE_COLOR[item.role] }]}>
                      <Text style={s.modalRoleText}>{item.role}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.modalPlayerName}>{item.first_name} {item.last_name}</Text>
                      <Text style={s.modalPlayerTeam}>{item.team_name}{isOnBench ? '  ·  in panchina' : ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <Text style={{ color: '#999' }}>Nessun giocatore disponibile</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================
// STYLES
// ============================================================
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f5f5f5' },
  emptyTitle: { fontSize: 18, color: '#999', marginTop: 16, fontWeight: '600' },
  emptySub: { fontSize: 14, color: '#ccc', marginTop: 8, textAlign: 'center' },

  // Header
  header: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  leagueName: { fontSize: 13, color: '#888', marginTop: 2 },

  // Matchday chips
  mdRow: { marginTop: 10, maxHeight: 44 },
  mdChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0' },
  mdChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  mdChipPast: { backgroundColor: '#f0f0f0' },
  mdChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  mdChipTextActive: { color: '#fff' },

  // Banners
  bannerGreen: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e8f5e9', borderRadius: 10, marginHorizontal: 14, marginTop: 10, padding: 12, gap: 8 },
  bannerGreenText: { fontSize: 13, color: '#2e7d32', fontWeight: '600' },
  // Deadline countdown
  deadlineBox: { marginHorizontal: 14, marginTop: 10, backgroundColor: '#f5f7ff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e0e5ff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deadlineBoxUrgent: { backgroundColor: '#fff5f5', borderColor: '#fcc' },
  deadlineTop: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  deadlineLabel: { fontSize: 12.5, color: '#555', fontWeight: '600' },
  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  countdownCell: { flexDirection: 'row', alignItems: 'baseline' },
  countdownNum: { fontSize: 20, fontWeight: '800', color: '#333', fontVariant: ['tabular-nums'] },
  countdownNumUrgent: { color: '#e53935' },
  countdownUnit: { fontSize: 12, color: '#999', fontWeight: '700', marginRight: 4 },
  countdownUnitUrgent: { color: '#e57373' },
  deadlineExpired: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fce4ec', borderRadius: 12, marginHorizontal: 14, marginTop: 10, padding: 12, gap: 8 },
  deadlineExpiredText: { fontSize: 13, color: '#c62828', fontWeight: '600', flex: 1 },

  autoInfo: { flexDirection: 'row', margin: 14, padding: 16, backgroundColor: '#fff', borderRadius: 12, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
  autoInfoText: { flex: 1, fontSize: 14, color: '#666', lineHeight: 20 },

  // Section labels
  sectionLabel: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  sectionLabelText: { fontSize: 14, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionLabelHint: { fontSize: 11, color: '#aaa', fontStyle: 'italic' },

  // Module chips
  moduleRow: { maxHeight: 42 },
  moduleChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ddd' },
  moduleChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  moduleChipText: { fontSize: 14, fontWeight: '700', color: '#555' },
  moduleChipTextActive: { color: '#fff' },

  // Soccer field
  fieldWrapper: { marginHorizontal: 14, marginTop: 10, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  field: { height: FIELD_H, backgroundColor: '#2e8b57', position: 'relative' },
  fieldCenter: { position: 'absolute', top: '49%', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  fieldCircle: { position: 'absolute', top: '50%', left: '50%', width: 70, height: 70, borderRadius: 35, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', marginLeft: -35, marginTop: -35 },
  fieldAreaTop: { position: 'absolute', top: 0, left: '25%', right: '25%', height: 40, borderWidth: 2, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  fieldAreaBottom: { position: 'absolute', bottom: 0, left: '25%', right: '25%', height: 40, borderWidth: 2, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  fieldRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },

  // Player slots
  playerSlot: { borderWidth: 2, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  playerSlotName: { color: '#fff', fontWeight: '700', textAlign: 'center', paddingHorizontal: 2 },
  playerSlotTeam: { color: 'rgba(255,255,255,0.75)', marginTop: 1, textAlign: 'center' },
  emptySlot: { borderWidth: 2, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  emptySlotLabel: { fontWeight: '700', marginTop: 1 },

  // No module
  noModule: { margin: 14, padding: 40, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', gap: 10 },
  noModuleText: { fontSize: 14, color: '#999' },

  // Bench (3-col grid with drag reorder)
  benchGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 14, gap: 8 },
  benchCard: { backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 6, borderRadius: 10, borderTopWidth: 3, position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  benchRemoveBtn: { position: 'absolute', top: 2, right: 2, zIndex: 2, padding: 2 },
  benchCardBody: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  benchRoleBadge: { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  benchRoleBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  benchInfo: { flex: 1 },
  benchName: { fontSize: 13, fontWeight: '600', color: '#333' },
  benchTeam: { fontSize: 10, color: '#888', marginTop: 1 },
  benchCardPlaceholder: { backgroundColor: '#eee', opacity: 0.5 },
  benchCardTarget: { backgroundColor: '#dce7ff' },
  benchCardGhost: { position: 'absolute', zIndex: 100, elevation: 12, shadowOpacity: 0.3, shadowRadius: 6, backgroundColor: '#fff', opacity: 0.92 },
  benchAddBtn: { height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#ccc', backgroundColor: '#fff' },

  // Save bar
  saveBar: { position: 'absolute', bottom: 95, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.95)', paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#eee' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#667eea', paddingVertical: 14, borderRadius: 10, gap: 8 },
  saveBtnSaved: { backgroundColor: '#2e7d32' },
  saveBtnDisabled: { backgroundColor: '#bbb' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Toast
  toast: { position: 'absolute', top: 60, left: 20, right: 20, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 10, zIndex: 999 },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },

  // Confirm modal
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  confirmContent: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '85%', alignItems: 'center' },
  confirmIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff5f5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  confirmTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  confirmMessage: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f0f0f0' },
  confirmBtnCancelText: { color: '#333', fontSize: 16, fontWeight: '600' },
  confirmBtnAction: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#667eea' },
  confirmBtnActionText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '65%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#333' },
  modalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', gap: 10 },
  modalRoleBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  modalRoleText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  modalPlayerName: { fontSize: 15, fontWeight: '600', color: '#333' },
  modalPlayerTeam: { fontSize: 12, color: '#888', marginTop: 1 },
});
