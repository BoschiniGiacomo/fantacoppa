import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MatchMinuteRing from '../components/MatchMinuteRing';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { adminMatchesService, matchesService, publicAssetUrl } from '../services/api';
import BonusIcon from '../components/BonusIcon';
import {
  computeLiveHeroClock,
  continuationCumulativeMinute,
  extraFirstHalfMinutes,
  extraSecondHalfMinutes,
  formatHHmm,
  getLastLivePhaseEvent,
  heroRunningAdjustedSegmentSec,
  heroRunningMinuteStr,
  parseEventCreatedAtMs,
  regulationHalfMinutes,
} from '../utils/officialMatchLiveClock';
import { parseAppDate } from '../utils/dateTime';

const MONTH_SHORT_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Data in Panoramica: Oggi/Ieri/Domani, altrimenti "15 Apr" o "15 Apr 2027" se anno ≠ corrente; opzionale ora. */
function formatOverviewKickoffLine(dateStr) {
  if (dateStr == null || String(dateStr).trim() === '') return '-';
  const d = parseAppDate(dateStr);
  if (!d || Number.isNaN(d.getTime())) return '-';

  const today = startOfLocalDay(new Date());
  const kickDay = startOfLocalDay(d);
  const diffDays = Math.round((kickDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let dateLabel;
  if (diffDays === -1) dateLabel = 'Ieri';
  else if (diffDays === 0) dateLabel = 'Oggi';
  else if (diffDays === 1) dateLabel = 'Domani';
  else {
    const y = d.getFullYear();
    const nowY = new Date().getFullYear();
    const dom = d.getDate();
    const mon = MONTH_SHORT_IT[d.getMonth()];
    dateLabel = y !== nowY ? `${dom} ${mon} ${y}` : `${dom} ${mon}`;
  }

  const hm = formatHHmm(dateStr);
  const showTime = hm !== '--:--' && (d.getHours() !== 0 || d.getMinutes() !== 0);
  return showTime ? `${dateLabel} ${hm}` : dateLabel;
}

/** Segmenti per chip durata partita (tab Panoramica). */
function getMatchTimingSegments(m) {
  if (!m) return null;
  const half = Number(m.regulation_half_minutes);
  if (!Number.isFinite(half) || half < 15) return null;
  const out = [
    {
      key: 'reg',
      label: 'Regolamentari',
      value: `${half}′ · ${half}′`,
    },
  ];
  if (Number(m.extra_time_enabled) === 1) {
    const x1 = m.extra_first_half_minutes != null ? Number(m.extra_first_half_minutes) : 15;
    const x2 = m.extra_second_half_minutes != null ? Number(m.extra_second_half_minutes) : 15;
    if (Number.isFinite(x1) && Number.isFinite(x2)) {
      out.push({
        key: 'et',
        label: 'Supplementari',
        value: `${x1}′ · ${x2}′`,
      });
    }
  }
  if (Number(m.penalties_enabled) === 1) {
    out.push({ key: 'pen', label: 'Rigori', value: 'Si' });
  }
  return out;
}

/** Etichette timeline (fasi centrali; inizio partita = fascia come fine partita). */
const PHASE_ROW_LABELS = {
  half_time: 'Fine primo tempo',
  second_half_start: 'Inizio secondo tempo',
  extra_first_half_start: 'Inizio supplementari',
  extra_half_time: 'Fine primo tempo supplementari',
  extra_second_half_start: 'Inizio secondo tempo supplementari',
};

/** Timeline / pulsante fase: senza supplementari e senza rigori, fine 2°T = fine partita. */
function labelSecondHalfEnd(match) {
  const et = Number(match?.extra_time_enabled) === 1;
  const pens = Number(match?.penalties_enabled) === 1;
  if (!et && !pens) return 'Fine partita';
  return 'Fine secondo tempo';
}

/** Fine 2° tempo sup.: senza rigori (vittoria ai supplementari) = stessa etichetta di fine partita. */
function labelExtraSecondHalfEnd(match) {
  const pens = Number(match?.penalties_enabled) === 1;
  if (!pens) return 'Fine partita';
  return 'Fine secondo tempo supplementari';
}

/** Dopo queste fasi la UI mostra «Fine partita» → persistiamo anche `match_end` (chiusura ufficiale). */
function shouldAutoMatchEndAfterPhase(phaseType, match) {
  const et = Number(match?.extra_time_enabled) === 1;
  const pens = Number(match?.penalties_enabled) === 1;
  if (phaseType === 'second_half_end') return !et && !pens;
  if (phaseType === 'extra_second_half_end') return !pens;
  return false;
}

/**
 * `match_end` viene salvato anche dopo fine 2°T (o fine 2°T sup. senza rigori), ma la timeline
 * mostra già la stessa fascia «Fine partita» sulla fase precedente → evita doppia riga identica.
 */
function isTimelineMatchEndRedundant(match, allEvents) {
  const pens = Number(match?.penalties_enabled) === 1;
  if (pens) return false;
  const et = Number(match?.extra_time_enabled) === 1;
  const types = new Set((allEvents || []).map((e) => e.event_type));
  if (et) return types.has('extra_second_half_end');
  return types.has('second_half_end');
}

function formatMmSs(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const HERO_RING_SIZE = 35;
const HERO_RING_STROKE = 3;
const HERO_RING_TRACK = '#e5e7eb';
const HERO_RING_PROGRESS = '#111827';
const HERO_MINUTE_COLOR = '#111827';

function buildPhaseSequence(match) {
  const et = Number(match?.extra_time_enabled) === 1;
  const pens = Number(match?.penalties_enabled) === 1;
  const seq = [
    { type: 'match_start', label: 'Inizio partita' },
    { type: 'half_time', label: 'Fine primo tempo' },
    { type: 'second_half_start', label: 'Inizio secondo tempo' },
    { type: 'second_half_end', label: labelSecondHalfEnd(match) },
  ];
  if (et) {
    seq.push(
      { type: 'extra_first_half_start', label: 'Inizio supplementari' },
      { type: 'extra_half_time', label: 'Fine 1° tempo supplementari' },
      { type: 'extra_second_half_start', label: 'Inizio 2° tempo supplementari' },
      {
        type: 'extra_second_half_end',
        label: Number(match?.penalties_enabled) === 1 ? 'Fine 2° tempo supplementari' : 'Fine partita',
      }
    );
  }
  if (pens) {
    seq.push({ type: 'penalties_start', label: 'Rigori' });
    seq.push({ type: 'match_end', label: 'Fine partita' });
  }
  return seq;
}

/**
 * Prossimo passo del pulsante unico.
 * `match_end` è in sequenza solo se i rigori sono previsti sul match (click finale dopo i rigori).
 * Se esiste già l’evento `match_end` (retrocompatibilità), resta il passo per aggiornare orario.
 */
function getNextPhaseStep(match, events) {
  if (!Array.isArray(events)) return null;
  if (events.some((e) => e.event_type === 'match_end')) {
    return { type: 'match_end', label: 'Fine partita' };
  }
  const seq = buildPhaseSequence(match);
  if (seq.length === 0) return null;
  const flowTypes = new Set(seq.map((s) => s.type));
  const recorded = events.filter((e) => flowTypes.has(e.event_type)).sort((a, b) => a.id - b.id);
  if (recorded.length === 0) return seq[0];
  const last = recorded[recorded.length - 1];
  const idx = seq.findIndex((s) => s.type === last.event_type);
  if (idx < 0) return null;
  if (idx >= seq.length - 1) return null;
  return seq[idx + 1];
}

/** Es. 30′ in tempo; oltre la fine regolamentare 30+1′, 30+2′… */
function formatMinuteStoppageLabel(cumulativeMinute, regulationCumulativeEnd) {
  const m = Number(cumulativeMinute);
  const cap = Number(regulationCumulativeEnd);
  if (!Number.isFinite(m) || m < 0) return '0\u2032';
  if (!Number.isFinite(cap) || cap < 0) return `${m}\u2032`;
  if (m <= cap) return `${m}\u2032`;
  return `${cap}+${m - cap}\u2032`;
}

/** Minuto intero mostrato al centro (stesso valore usato per modifica cronometro). */
function computeHeroRunningDisplayMinuteInt(events, match, elapsedOffsetSec = 0) {
  const { last, segSec } = heroRunningAdjustedSegmentSec(events, elapsedOffsetSec);
  if (!last) return null;
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  switch (last.event_type) {
    case 'match_start':
      return Math.floor(segSec / 60);
    case 'second_half_start':
      return continuationCumulativeMinute(segSec, H, H);
    case 'extra_first_half_start':
      return continuationCumulativeMinute(segSec, 2 * H, et1);
    case 'extra_second_half_start':
      return continuationCumulativeMinute(segSec, 2 * H + et1, et2);
    default:
      return null;
  }
}

/**
 * Secondi di fase da impostare perché il minuto mostrato (intero) sia `targetM`,
 * mantenendo il secondo corrente nel minuto (`secMod` 0–59).
 */
function computeTargetSegmentSecondsForDisplayMinute(phaseType, match, targetM, secMod) {
  const H = regulationHalfMinutes(match);
  const e1 = extraFirstHalfMinutes(match);
  const e2 = extraSecondHalfMinutes(match);
  const M = Math.floor(Number(targetM));
  const sm = Math.max(0, Math.min(59, Math.floor(Number(secMod) || 0)));
  if (!Number.isFinite(M) || M < 0) return 0;

  switch (phaseType) {
    case 'match_start':
      return M * 60 + sm;
    case 'second_half_start': {
      if (M <= H) return sm;
      if (M <= 2 * H) {
        const flo = M - H - 1;
        return Math.max(0, flo) * 60 + sm;
      }
      const flo = M - H - 1;
      return Math.max(0, flo) * 60 + sm;
    }
    case 'extra_first_half_start': {
      const base = 2 * H;
      if (M <= base) return sm;
      if (M <= base + e1) {
        const flo = M - base - 1;
        return Math.max(0, flo) * 60 + sm;
      }
      const flo = M - base - 1;
      return Math.max(0, flo) * 60 + sm;
    }
    case 'extra_second_half_start': {
      const base = 2 * H + e1;
      if (M <= base) return sm;
      if (M <= base + e2) {
        const flo = M - base - 1;
        return Math.max(0, flo) * 60 + sm;
      }
      const flo = M - base - 1;
      return Math.max(0, flo) * 60 + sm;
    }
    default:
      return M * 60 + sm;
  }
}

function regulationEndForLivePhase(phaseType, match) {
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  switch (phaseType) {
    case 'match_start':
    case 'half_time':
      return H;
    case 'second_half_start':
    case 'second_half_end':
      return 2 * H;
    case 'extra_first_half_start':
    case 'extra_half_time':
      return 2 * H + et1;
    case 'extra_second_half_start':
    case 'extra_second_half_end':
      return 2 * H + et1 + et2;
    default:
      return 2 * H + et1 + et2;
  }
}

function formatStoredEventMinuteLabel(minuteValue, phaseContextType, match) {
  if (minuteValue == null || minuteValue === '') return '\u2013';
  const end = regulationEndForLivePhase(phaseContextType || 'match_start', match);
  return formatMinuteStoppageLabel(Number(minuteValue), end);
}

/** Input modale "30+1" o "31" → intero per API (minute INT). */
function parseTimelineMinuteToInt(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/\u2032/g, '')
    .replace(/'/g, '');
  if (!s) return NaN;
  const plus = s.match(/^(\d+)\+(\d+)$/);
  if (plus) return Number(plus[1]) + Number(plus[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Minuto consigliato (intero cumulativo per API) allineato al cronometro hero — non dal kickoff programmato.
 * 2° tempo / sup.: `continuationCumulativeMinute` così il primo secondo del 2°T è 31 (dopo H=30), non 30.
 */
function computeSuggestedTimelineMinute(events, match, elapsedOffsetSec = 0) {
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  const off = Number(elapsedOffsetSec) || 0;

  const last = getLastLivePhaseEvent(events);
  if (!last) return 0;

  const now = Date.now();
  const elapsedSecSince = (ev) => {
    const t0 = parseEventCreatedAtMs(ev);
    if (t0 == null) return 0;
    return Math.max(0, Math.floor((now - t0) / 1000) + off);
  };

  switch (last.event_type) {
    case 'match_start':
      return Math.floor(elapsedSecSince(last) / 60);
    case 'half_time':
      return H;
    case 'second_half_start':
      return continuationCumulativeMinute(elapsedSecSince(last), H, H);
    case 'second_half_end':
      return 2 * H;
    case 'extra_first_half_start':
      return continuationCumulativeMinute(elapsedSecSince(last), 2 * H, et1);
    case 'extra_half_time':
      return 2 * H + et1;
    case 'extra_second_half_start':
      return continuationCumulativeMinute(elapsedSecSince(last), 2 * H + et1, et2);
    case 'extra_second_half_end':
    case 'penalties_start':
      return 2 * H + et1 + et2;
    case 'match_end':
      return 2 * H + et1 + et2;
    default:
      return 0;
  }
}

function HeroTeamLogo({ logoUrl, logoPath }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.heroLogoFallback}>
        <Ionicons name="shield-outline" size={32} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.heroLogo} onError={() => setFailed(true)} resizeMode="contain" />;
}

function TableTeamLogo({ logoUrl, logoPath }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.tableLogoFallback}>
        <Ionicons name="shield-outline" size={20} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.tableLogo} onError={() => setFailed(true)} resizeMode="contain" />;
}

/** Allineato a Mia Rosa (`SquadScreen`): colori ruolo P/D/C/A. */
function lineupRoleColor(role) {
  const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
  return colors[role] || '#666';
}

function splitLineupFirstLast(player) {
  const fn = player.first_name != null ? String(player.first_name).trim() : '';
  const ln = player.last_name != null ? String(player.last_name).trim() : '';
  if (fn && ln) return { first: fn, last: ln };
  const raw = String(player.name || '').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Nomi in forma "D. Salvini"; se in rosa ci sono omonimie abbreviate, allunga il prefisso del nome.
 * Se restano uguali (es. stesso nome completo), aggiunge (numero maglia).
 */
function buildLineupDisplayNames(players) {
  if (!Array.isArray(players) || players.length === 0) return [];
  const parsed = players.map((p) => ({ p, ...splitLineupFirstLast(p) }));
  const lens = parsed.map(() => 1);

  const labelAt = (i) => {
    const { first, last, p } = parsed[i];
    if (!last) return p.name || '';
    if (!first) return last;
    const k = lens[i];
    const fl = first.length;
    if (k >= fl) return `${first} ${last}`;
    return `${first.slice(0, k)}. ${last}`;
  };

  for (let g = 0; g < 48; g += 1) {
    const labels = parsed.map((_, i) => labelAt(i));
    const by = {};
    labels.forEach((lb, i) => {
      if (!by[lb]) by[lb] = [];
      by[lb].push(i);
    });
    let bumped = false;
    Object.keys(by).forEach((lb) => {
      const idxs = by[lb];
      if (idxs.length < 2) return;
      idxs.forEach((i) => {
        const fl = parsed[i].first.length;
        if (lens[i] < fl) {
          lens[i] += 1;
          bumped = true;
        }
      });
    });
    if (!bumped) break;
  }

  let labels = parsed.map((_, i) => labelAt(i));
  const by = {};
  labels.forEach((lb, i) => {
    if (!by[lb]) by[lb] = [];
    by[lb].push(i);
  });
  labels = labels.map((lb, i) => {
    if (!by[lb] || by[lb].length < 2) return lb;
    const sn = parsed[i].p.shirt_number;
    const suf =
      sn != null && sn !== '' && !Number.isNaN(Number(sn))
        ? ` (${Number(sn)})`
        : ` (${parsed[i].p.order ?? i + 1})`;
    return `${lb}${suf}`;
  });
  return labels;
}

const LINEUP_ROLE_ORDER = { P: 0, D: 1, C: 2, A: 3 };

/** Formazione: ordine P → D → C → A, poi cognome/nome, poi numero maglia (se presente). */
function sortLineupForDisplay(players) {
  if (!Array.isArray(players) || players.length === 0) return [];
  return [...players].sort((a, b) => {
    const ra = LINEUP_ROLE_ORDER[a.role] ?? 99;
    const rb = LINEUP_ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    const fa = splitLineupFirstLast(a);
    const fb = splitLineupFirstLast(b);
    const lc = fa.last.localeCompare(fb.last, 'it');
    if (lc !== 0) return lc;
    const fc = fa.first.localeCompare(fb.first, 'it');
    if (fc !== 0) return fc;
    return (Number(a.shirt_number) || 999) - (Number(b.shirt_number) || 999);
  });
}

/** Blu maglia predefinito (app), leggermente più chiaro del precedente #818cf8. */
const DEFAULT_LINEUP_JERSEY_ICON = '#a5b4fc';

function isValidLineupJerseyHex(s) {
  if (s == null || typeof s !== 'string') return false;
  const t = s.trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(t);
}

function lineupShirtToHex6(raw) {
  let hex = typeof raw === 'string' ? raw.trim() : '';
  if (!isValidLineupJerseyHex(hex)) return null;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/** Luminanza relativa WCAG (0–1), solo #RRGGBB. */
function relativeLuminanceHex6(hex6) {
  const h = hex6.replace(/^#/, '');
  if (h.length !== 6) return 0.5;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return 0.5;
  const rs = (n >> 16) & 255;
  const gs = (n >> 8) & 255;
  const bs = n & 255;
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = lin(rs);
  const G = lin(gs);
  const B = lin(bs);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Preset “tint” da Gestione squadre (rosso, blu, azzurro, arancione, verde scuro): numero sempre nero.
 * Qualsiasi altro colore: regola luminanza (chiaro → nero, scuro → bianco).
 * Allineare a `OFFICIAL_JERSEY_COLOR_PRESETS` in TeamManagementScreen.js.
 */
const LINEUP_JERSEY_PRESET_FORCE_BLACK_NUMBER = new Set([
  '#c1121c',
  '#0857c3',
  '#38bdf8',
  '#f97316',
  '#008450',
]);

/** Numero maglia: nero forzato per i preset tint sopra; altrimenti contrasto per luminanza. */
function lineupJerseyNumberColorForShirt(shirtHex6) {
  const expanded = lineupShirtToHex6(typeof shirtHex6 === 'string' ? shirtHex6 : '');
  const key = expanded ? expanded.toLowerCase() : '';
  if (key && LINEUP_JERSEY_PRESET_FORCE_BLACK_NUMBER.has(key)) {
    return '#111827';
  }
  const hex6 = expanded || DEFAULT_LINEUP_JERSEY_ICON;
  const L = relativeLuminanceHex6(hex6);
  return L > 0.5 ? '#111827' : '#ffffff';
}

const GK_SHIRT_BLACK = '#000000';
const GK_SHIRT_WHITE = '#ffffff';

/**
 * Maglia di squadra considerata "nera" (grigio/nero), non solo scura colorata (es. blu #003087).
 */
function isLineupTeamShirtBlack(shirtHex6) {
  const h = shirtHex6.replace(/^#/, '');
  if (h.length !== 6) return false;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const spread = mx - mn;
  const L = relativeLuminanceHex6(shirtHex6);
  return L <= 0.12 && spread <= 48 && mx <= 60;
}

/** Portiere: maglia nera, o bianca se la squadra è in nero. */
function lineupGkShirtHex(teamBaseHex6) {
  return isLineupTeamShirtBlack(teamBaseHex6) ? GK_SHIRT_WHITE : GK_SHIRT_BLACK;
}

/** Colore maglia da lega (API); se assente o non valido → predefinito app con numero a contrasto. */
function lineupJerseyColorsFromTeam(teamColor) {
  const hex = lineupShirtToHex6(typeof teamColor === 'string' ? teamColor : '');
  if (!hex) {
    return {
      icon: DEFAULT_LINEUP_JERSEY_ICON,
      number: lineupJerseyNumberColorForShirt(DEFAULT_LINEUP_JERSEY_ICON),
    };
  }
  return { icon: hex, number: lineupJerseyNumberColorForShirt(hex) };
}

/**
 * Casa: maglia (con ruolo piccolo in angolo) | nome.
 * Ospiti: nome | maglia (stesso overlay ruolo).
 */
function LineupPlayerRow({ player, variant = 'home', jerseyIconColor, teamShirtBaseHex, onPressName }) {
  const role = player.role;
  const displayName = player.displayName || player.name || '';
  const num =
    player.shirt_number != null && player.shirt_number !== '' && !Number.isNaN(Number(player.shirt_number))
      ? String(player.shirt_number)
      : '–';
  const rc = lineupRoleColor(role);
  const baseHex =
    (teamShirtBaseHex && lineupShirtToHex6(teamShirtBaseHex)) || DEFAULT_LINEUP_JERSEY_ICON;
  const isGk = String(role || '').toUpperCase() === 'P';
  const shirtTint = isGk ? lineupGkShirtHex(baseHex) : jerseyIconColor || DEFAULT_LINEUP_JERSEY_ICON;
  const shirtHexForNumber = lineupShirtToHex6(shirtTint) || shirtTint;
  const numTint = lineupJerseyNumberColorForShirt(shirtHexForNumber);
  const jersey = (
    <View
      style={styles.jerseyBadge}
      accessibilityLabel={`Numero maglia ${num}, ruolo ${role || 'non indicato'}`}
    >
      <MaterialCommunityIcons name="tshirt-crew" size={38} color={shirtTint} style={styles.jerseyIcon} />
      <Text style={[styles.jerseyNumber, { color: numTint }]} numberOfLines={1}>
        {num}
      </Text>
      {role ? (
        <View style={[styles.jerseyRolePill, { backgroundColor: rc }]}>
          <Text style={styles.jerseyRolePillText}>{role}</Text>
        </View>
      ) : (
        <View style={[styles.jerseyRolePill, styles.jerseyRolePillMuted]}>
          <Text style={styles.jerseyRolePillTextMuted}>–</Text>
        </View>
      )}
    </View>
  );
  const nameText = (
    <Text style={styles.lineupPlayerNameText} numberOfLines={2}>
      {displayName}
    </Text>
  );
  const nameEl =
    typeof onPressName === 'function' ? (
      <TouchableOpacity
        style={styles.lineupNamePressable}
        onPress={onPressName}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={`Scheda giocatore ${displayName}`}
      >
        {nameText}
      </TouchableOpacity>
    ) : (
      <View style={styles.lineupNamePressable}>{nameText}</View>
    );

  if (variant === 'away') {
    return (
      <View style={styles.lineupRow}>
        {nameEl}
        {jersey}
      </View>
    );
  }
  return (
    <View style={styles.lineupRow}>
      {jersey}
      {nameEl}
    </View>
  );
}

/** Stessi tipi di BonusIcon (bonus/malus) — vedi `BONUS_ICONS` in BonusIcon.js */
const LIVE_EVENT_BONUS_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'penalty_missed', 'own_goal']);

function computeLiveScoreFromEvents(events) {
  let home = 0;
  let away = 0;
  if (!Array.isArray(events)) return { home, away };
  for (const ev of events) {
    if (!ev || ev.event_type === 'match_end') continue;
    const s = ev.team_side;
    if (ev.event_type === 'goal') {
      if (s === 'home') home += 1;
      else if (s === 'away') away += 1;
    } else if (ev.event_type === 'own_goal') {
      if (s === 'home') away += 1;
      else if (s === 'away') home += 1;
    }
  }
  return { home, away };
}

function timelineMinuteSortKey(ev) {
  if (!ev) return Number.POSITIVE_INFINITY;
  if (ev.event_type === 'match_start') return Number.NEGATIVE_INFINITY;
  if (ev.minute == null || ev.minute === '') return Number.POSITIVE_INFINITY;
  const n = Number(ev.minute);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Contesto regolamentare per etichetta minuto (1T / 2T / sup.) dal valore cumulativo,
 * non dall’ordine degli id: così un goal a 15′ resta 1° tempo anche se inserito dopo un PT registrato a 8′.
 */
function phaseContextForTimelineEvent(ev, match) {
  if (!ev) return 'match_start';
  const m = Number(ev.minute);
  if (!Number.isFinite(m)) return 'match_start';
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  const endReg = 2 * H;
  const endEt1 = endReg + et1;
  const endEt2 = endEt1 + et2;
  if (m <= H) return 'match_start';
  if (m <= endReg) return 'second_half_start';
  if (m <= endEt1) return 'extra_first_half_start';
  if (m <= endEt2) return 'extra_second_half_start';
  return 'extra_second_half_start';
}

/**
 * Chiave di ordinamento timeline: le chiusure di fase (PT, FT, …) vanno dopo tutti gli eventi di gioco
 * con minuto ≤ fine regolamentare di quel segmento, anche se il marker ha minuto più basso (es. PT a 8′, goal a 15′).
 */
function timelineDisplaySortKey(ev, match) {
  if (!ev) return Number.POSITIVE_INFINITY;
  if (ev.event_type === 'match_start') return Number.NEGATIVE_INFINITY;
  if (ev.event_type === 'match_end') return 1e15;
  if (ev.event_type === 'penalties_start') return 1e15 - 1;
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  const n = ev.minute == null || ev.minute === '' ? NaN : Number(ev.minute);
  const raw = Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;

  if (ev.event_type === 'half_time') {
    const base = Math.max(H, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  if (ev.event_type === 'second_half_end') {
    const base = Math.max(2 * H, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  if (ev.event_type === 'extra_half_time') {
    const base = Math.max(2 * H + et1, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  if (ev.event_type === 'extra_second_half_end') {
    const base = Math.max(2 * H + et1 + et2, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  return raw;
}

function compareEventsForTimelineDisplay(a, b, match) {
  const ka = timelineDisplaySortKey(a, match);
  const kb = timelineDisplaySortKey(b, match);
  if (ka !== kb) return ka - kb;
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

/** Es. «D. Salvini» da «Diego Salvini» o «D. Salvini» da mononimo. */
function formatHeroPlayerShortName(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const initial = first.length > 0 ? `${first[0].toUpperCase()}.` : '';
  return `${initial} ${parts.slice(1).join(' ')}`.trim();
}

function minuteLabelForHeroScorer(ev, match) {
  const phaseCtx = phaseContextForTimelineEvent(ev, match);
  return formatStoredEventMinuteLabel(ev.minute, phaseCtx, match).replace(/\u2032/g, "'");
}

/**
 * Righe marcatori casa / ospiti (solo goal e autogol), ordine timeline; stesso giocatore → minuti uniti.
 * Casa: «Nome 3', 26'» / «Nome 45' (og)». Ospiti a specchio: «3', 26' Nome» / «(og) 45' Nome».
 */
function buildHeroScorerBlocks(liveEvents, match) {
  const sorted = [...(liveEvents || [])]
    .filter((e) => e && (e.event_type === 'goal' || e.event_type === 'own_goal'))
    .sort((a, b) => compareEventsForTimelineDisplay(a, b, match));

  const homeMap = new Map();
  const awayMap = new Map();

  for (const ev of sorted) {
    const shortName = formatHeroPlayerShortName(ev?.payload?.player_name);
    const isOg = ev.event_type === 'own_goal';
    const minLab = minuteLabelForHeroScorer(ev, match);

    let creditsHome;
    if (ev.event_type === 'goal') {
      creditsHome = ev.team_side === 'home';
    } else {
      creditsHome = ev.team_side === 'away';
    }
    const map = creditsHome ? homeMap : awayMap;
    const key = `${shortName}\0${isOg ? 'og' : 'g'}`;
    if (!map.has(key)) {
      map.set(key, { shortName, isOg, minutes: [] });
    }
    map.get(key).minutes.push(minLab);
  }

  const mapToHomeLines = (m) =>
    [...m.values()].map((g) => {
      const times = g.minutes.join(', ');
      const suffix = g.isOg ? ' (og)' : '';
      return `${g.shortName} ${times}${suffix}`;
    });

  /** A specchio rispetto alla casa: (og) opzionale, poi minuti, poi giocatore. */
  const mapToAwayLines = (m) =>
    [...m.values()].map((g) => {
      const times = g.minutes.join(', ');
      if (g.isOg) {
        return `(og) ${times} ${g.shortName}`;
      }
      return `${times} ${g.shortName}`;
    });

  return { homeLines: mapToHomeLines(homeMap), awayLines: mapToAwayLines(awayMap) };
}

/**
 * Risultato parziale (goal / autogol) da tutti gli eventi cronologicamente prima di `targetEv`
 * nello stesso ordine usato dalla timeline.
 */
function computePartialScoreBeforeEvent(liveEvents, targetEv, match) {
  if (!Array.isArray(liveEvents) || !targetEv) return { home: 0, away: 0 };
  const sorted = [...liveEvents].sort((a, b) => compareEventsForTimelineDisplay(a, b, match));
  const idx = sorted.findIndex((e) => e.id === targetEv.id);
  if (idx < 0) return { home: 0, away: 0 };
  return computeLiveScoreFromEvents(sorted.slice(0, idx));
}

function clockNowHHmm() {
  const d = new Date();
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

async function tryAutoMatchEndAfterPhase(adminMatchesService, matchId, phaseType, match) {
  if (!shouldAutoMatchEndAfterPhase(phaseType, match)) return;
  await adminMatchesService.addEvent(matchId, {
    event_type: 'match_end',
    clock_time: clockNowHHmm(),
  });
}

export default function MatchDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const superuserLevel = Number(user?.is_superuser || 0);
  const canManageLive = superuserLevel === 1 || superuserLevel === 2;
  const matchId = route?.params?.matchId;
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [showEventEditor, setShowEventEditor] = useState(false);
  const [eventType, setEventType] = useState('goal');
  const [eventTeamSide, setEventTeamSide] = useState('home');
  const [eventMinute, setEventMinute] = useState('');
  const [eventPlayerName, setEventPlayerName] = useState('');
  const [matchEndClock, setMatchEndClock] = useState('');
  const [timingOpen, setTimingOpen] = useState(false);
  const [editorModalTab, setEditorModalTab] = useState('events');
  /** Se true, il campo Minuto negli eventi non segue più il cronometro live. */
  const [eventMinuteDirty, setEventMinuteDirty] = useState(false);
  /** Offset secondi sul cronometro live (per fase = ultimo evento di fase); persistito in AsyncStorage. */
  const [liveTimerOffsetSec, setLiveTimerOffsetSec] = useState(0);
  const [heroMinDraft, setHeroMinDraft] = useState('');
  const [heroMinFocused, setHeroMinFocused] = useState(false);
  /** idle | ok | err — feedback pulsante accanto al minuto hero */
  const [heroTimerUi, setHeroTimerUi] = useState('idle');

  /** showLoading: solo al primo caricamento; refresh in background per focus/polling. */
  const loadDetail = useCallback(
    async ({ showLoading = false } = {}) => {
      if (!matchId) return;
      try {
        if (showLoading) setLoading(true);
        const res = await matchesService.getDetail(matchId);
        setData(res?.data || null);
      } catch {
        /* mantieni dati precedenti */
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [matchId]
  );

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [matchId]);

  useEffect(() => {
    void loadDetail({ showLoading: true });
  }, [matchId, loadDetail]);

  const DETAIL_POLL_MS = 8000;
  useFocusEffect(
    useCallback(() => {
      if (!matchId) return undefined;
      void loadDetail({ showLoading: false });
      const poll = setInterval(() => void loadDetail({ showLoading: false }), DETAIL_POLL_MS);
      return () => clearInterval(poll);
    }, [matchId, loadDetail])
  );

  useEffect(() => {
    setTimingOpen(false);
  }, [matchId]);

  useEffect(() => {
    if (activeTab !== 'live') {
      setShowEventEditor(false);
      setEventMinuteDirty(false);
      setHeroMinFocused(false);
      setHeroTimerUi('idle');
    }
  }, [activeTab]);

  const match = data?.match || {};
  const favorites = data?.favorites || {};
  const notifications = data?.notifications || {};
  const lineups = data?.lineups || { home: [], away: [] };
  const teamPlayers = data?.team_players || { home: [], away: [] };
  const liveEvents = data?.events || [];
  const standings = data?.standings || [];
  const timerAnchorPhaseId = useMemo(() => getLastLivePhaseEvent(liveEvents)?.id ?? null, [liveEvents]);

  const liveEventsTimelineSorted = useMemo(() => {
    if (!Array.isArray(liveEvents) || liveEvents.length < 2) return liveEvents;
    return [...liveEvents].sort((a, b) => compareEventsForTimelineDisplay(a, b, match));
  }, [liveEvents, match]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!matchId || timerAnchorPhaseId == null) {
        if (!cancelled) setLiveTimerOffsetSec(0);
        return;
      }
      const k = `@fc_timer_off_${matchId}_${timerAnchorPhaseId}`;
      try {
        const raw = await AsyncStorage.getItem(k);
        const parsed = raw != null && String(raw).trim() !== '' ? Number(raw) || 0 : 0;
        // Guardrail: vecchi offset corrotti (es. -7080s) possono far partire il cronometro da 120'.
        // Manteniamo regolazioni ragionevoli, ma scartiamo valori estremi e puliamo la chiave.
        const sane = Number.isFinite(parsed) && Math.abs(parsed) <= 1800 ? parsed : 0;
        if (!Number.isFinite(parsed) || Math.abs(parsed) > 1800) {
          await AsyncStorage.removeItem(k);
        }
        if (!cancelled) setLiveTimerOffsetSec(sane);
      } catch {
        if (!cancelled) setLiveTimerOffsetSec(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, timerAnchorPhaseId]);

  const lineupHomeSorted = useMemo(() => sortLineupForDisplay(lineups.home || []), [lineups.home]);
  const lineupAwaySorted = useMemo(() => sortLineupForDisplay(lineups.away || []), [lineups.away]);
  const lineupHomeDisplayNames = useMemo(() => buildLineupDisplayNames(lineupHomeSorted), [lineupHomeSorted]);
  const lineupAwayDisplayNames = useMemo(() => buildLineupDisplayNames(lineupAwaySorted), [lineupAwaySorted]);
  const homeJerseyColors = useMemo(() => lineupJerseyColorsFromTeam(match.home_jersey_color), [match.home_jersey_color]);
  const awayJerseyColors = useMemo(() => lineupJerseyColorsFromTeam(match.away_jersey_color), [match.away_jersey_color]);
  const homeKitBaseHex = useMemo(
    () => lineupShirtToHex6(match.home_jersey_color) || DEFAULT_LINEUP_JERSEY_ICON,
    [match.home_jersey_color]
  );
  const awayKitBaseHex = useMemo(
    () => lineupShirtToHex6(match.away_jersey_color) || DEFAULT_LINEUP_JERSEY_ICON,
    [match.away_jersey_color]
  );
  const heroClock = useMemo(
    () => computeLiveHeroClock(liveEvents, match, tick, liveTimerOffsetSec),
    [liveEvents, match, tick, liveTimerOffsetSec]
  );
  const suggestedTimelineMinuteStr = useMemo(() => {
    const n = computeSuggestedTimelineMinute(liveEvents, match, liveTimerOffsetSec);
    return `${n}\u2032`;
  }, [liveEvents, match, tick, liveTimerOffsetSec]);
  const heroRunningMinuteInt = useMemo(
    () => computeHeroRunningDisplayMinuteInt(liveEvents, match, liveTimerOffsetSec),
    [liveEvents, match, liveTimerOffsetSec, tick]
  );
  const heroMinPending = useMemo(() => {
    if (heroRunningMinuteInt == null) return false;
    const t = heroMinDraft.trim();
    if (t === '') return false;
    if (!/^\d{1,3}$/.test(t)) return true;
    return parseInt(t, 10) !== heroRunningMinuteInt;
  }, [heroMinDraft, heroRunningMinuteInt]);

  /** Cronometro regolabile nel modale Fasi (stesso controllo che prima era sotto l’hero). */
  const showPhaseHeroTimerAdjust = useMemo(
    () => canManageLive && heroClock.variant === 'running' && heroRunningMinuteInt != null,
    [canManageLive, heroClock.variant, heroRunningMinuteInt]
  );

  /** Minuto timeline in modale Fasi (anche in pausa, quando il cronometro non è in corsa). */
  const phaseModalSuggestedMinuteInt = useMemo(
    () => computeSuggestedTimelineMinute(liveEvents, match, liveTimerOffsetSec),
    [liveEvents, match, liveTimerOffsetSec, tick]
  );

  /** Allinea il draft al minuto mostrato (live o, in pausa, al valore timeline). */
  useEffect(() => {
    if (heroMinFocused || heroTimerUi !== 'idle') return;
    if (heroRunningMinuteInt != null) {
      setHeroMinDraft(String(heroRunningMinuteInt));
      return;
    }
    setHeroMinDraft(String(phaseModalSuggestedMinuteInt));
  }, [heroRunningMinuteInt, heroMinFocused, heroTimerUi, phaseModalSuggestedMinuteInt]);

  const persistTimerOffsetToStorage = useCallback(async (off, anchorId) => {
    if (!matchId || anchorId == null) return;
    try {
      await AsyncStorage.setItem(`@fc_timer_off_${matchId}_${anchorId}`, String(off));
    } catch {
      /* ignore */
    }
  }, [matchId]);

  const submitHeroTimerAdjust = useCallback(() => {
    Keyboard.dismiss();
    const last = getLastLivePhaseEvent(liveEvents);
    const cur = computeHeroRunningDisplayMinuteInt(liveEvents, match, liveTimerOffsetSec);
    if (!last || cur == null) return;
    const draftTrim = heroMinDraft.trim();
    if (!/^\d{1,3}$/.test(draftTrim)) {
      setHeroTimerUi('err');
      setHeroMinDraft(String(cur));
      setTimeout(() => setHeroTimerUi('idle'), 1400);
      return;
    }
    const M = parseInt(draftTrim, 10);
    if (M === cur) return;
    const t0 = parseEventCreatedAtMs(last);
    const raw = t0 != null ? Math.max(0, Math.floor((Date.now() - t0) / 1000)) : 0;
    const seg = raw + liveTimerOffsetSec;
    const sm = seg % 60;
    Alert.alert(
      'Modifica cronometro',
      `Vuoi portare il minuto da ${cur}' a ${M}'? Il tempo continuerà da lì come se fosse il minuto ${M}.`,
      [
        {
          text: 'Annulla',
          style: 'cancel',
          onPress: () => {
            setHeroTimerUi('err');
            setHeroMinDraft(String(cur));
            setTimeout(() => setHeroTimerUi('idle'), 1400);
          },
        },
        {
          text: 'Sì',
          onPress: () => {
            const targetSeg = computeTargetSegmentSecondsForDisplayMinute(last.event_type, match, M, sm);
            const newOff = targetSeg - raw;
            setLiveTimerOffsetSec(newOff);
            void persistTimerOffsetToStorage(newOff, last.id);
            setHeroMinDraft(String(M));
            setHeroTimerUi('ok');
            setTimeout(() => setHeroTimerUi('idle'), 1400);
          },
        },
      ],
    );
  }, [liveEvents, match, liveTimerOffsetSec, heroMinDraft, persistTimerOffsetToStorage]);

  const liveScorePreview = useMemo(() => computeLiveScoreFromEvents(liveEvents), [liveEvents]);
  const matchHasStarted = useMemo(() => liveEvents.some((e) => e.event_type === 'match_start'), [liveEvents]);
  const heroScorerBlocks = useMemo(() => buildHeroScorerBlocks(liveEvents, match), [liveEvents, match]);
  const showHeroScorerList =
    matchHasStarted && (Number(liveScorePreview.home) > 0 || Number(liveScorePreview.away) > 0);
  const nextPhaseStep = useMemo(() => getNextPhaseStep(match, liveEvents), [match, liveEvents]);
  const timingSegments = useMemo(() => getMatchTimingSegments(match), [
    match.regulation_half_minutes,
    match.extra_time_enabled,
    match.extra_first_half_minutes,
    match.extra_second_half_minutes,
    match.penalties_enabled,
  ]);

  const mainScrollPaddingBottom =
    activeTab === 'live' && canManageLive
      ? insets.bottom + 72
      : activeTab === 'lineup'
        ? Math.max(insets.bottom, 28) + 32
        : undefined;

  const openPlayerStatsFromLineup = (p, displayName, leagueIdRaw) => {
    const pid = p?.id != null ? Number(p.id) : 0;
    const leagueId = leagueIdRaw != null ? Number(leagueIdRaw) : 0;
    if (!pid || !Number.isFinite(leagueId) || leagueId <= 0) return;
    navigation.navigate('PlayerStats', {
      playerId: pid,
      leagueId,
      playerName: displayName || p.name || '-',
      playerRole: p.role,
      playerRating: p.rating,
    });
  };

  const toggleFavoriteMatch = async () => {
    await matchesService.setFavoriteMatch(match.id, Number(favorites.match) !== 1);
    await loadDetail({ showLoading: false });
  };

  const toggleNotifications = async () => {
    await matchesService.toggleMatchNotifications(match.id, Number(notifications.enabled) !== 1);
    await loadDetail({ showLoading: false });
  };

  const fillMatchEndDefaults = () => {
    const existing = liveEvents.find((e) => e.event_type === 'match_end');
    const prevClock = existing?.payload?.clock_time != null ? String(existing.payload.clock_time).trim() : '';
    setMatchEndClock(prevClock !== '' ? prevClock : clockNowHHmm());
  };

  useEffect(() => {
    if (showEventEditor && editorModalTab === 'phases' && nextPhaseStep?.type === 'match_end') {
      fillMatchEndDefaults();
    }
  }, [showEventEditor, editorModalTab, nextPhaseStep?.type]);

  useEffect(() => {
    if (!showEventEditor || editorModalTab !== 'events' || eventMinuteDirty) return;
    setEventMinute(suggestedTimelineMinuteStr);
  }, [showEventEditor, editorModalTab, eventMinuteDirty, suggestedTimelineMinuteStr]);

  const closeEventModal = useCallback(() => {
    setShowEventEditor(false);
    setEventMinuteDirty(false);
  }, []);

  const submitEvent = async () => {
    const rawMin = (eventMinute || '').trim() || suggestedTimelineMinuteStr;
    const minuteNum = parseTimelineMinuteToInt(rawMin);
    if (!Number.isFinite(minuteNum) || minuteNum < 0) {
      Alert.alert('Errore', 'Indica un minuto valido (es. 31 o 30+1)');
      return;
    }
    await adminMatchesService.addEvent(match.id, {
      event_type: eventType,
      team_side: eventTeamSide,
      minute: minuteNum,
      player_name: eventPlayerName.trim() || null,
    });
    setEventPlayerName('');
    await loadDetail({ showLoading: false });
    closeEventModal();
  };

  const submitPhaseEvent = async (phaseType) => {
    if (phaseType === 'match_end') {
      try {
        await adminMatchesService.addEvent(match.id, {
          event_type: 'match_end',
          clock_time: matchEndClock.trim() || undefined,
        });
        setEventPlayerName('');
        await loadDetail({ showLoading: false });
        closeEventModal();
      } catch (err) {
        const body = err?.response?.data;
        const msg =
          (typeof body === 'string' ? body : null) ||
          body?.message ||
          body?.error ||
          err?.message ||
          'Operazione non riuscita';
        Alert.alert('Errore', String(msg));
      }
      return;
    }

    const useLiveHeroMinute =
      phaseType !== 'match_start' &&
      canManageLive &&
      heroClock.variant === 'running' &&
      heroRunningMinuteInt != null;

    if (useLiveHeroMinute) {
      if (heroMinPending) {
        Alert.alert(
          'Cronometro',
          'Conferma o annulla la modifica al minuto (pulsante accanto al numero o «Fatto» sulla tastiera) prima di registrare la fase.',
        );
        return;
      }
      const m = heroRunningMinuteInt;
      if (!Number.isFinite(m) || m < 0) {
        Alert.alert('Errore', 'Minuto non valido.');
        return;
      }
      try {
        await adminMatchesService.addEvent(match.id, { event_type: phaseType, minute: m });
        try {
          await tryAutoMatchEndAfterPhase(adminMatchesService, match.id, phaseType, match);
        } catch (e2) {
          Alert.alert(
            'Attenzione',
            'La fase è stata registrata ma la fine partita automatica non è andata a buon fine. Puoi riprovare dalla diretta se serve.',
          );
        }
        await loadDetail({ showLoading: false });
      } catch (err) {
        const body = err?.response?.data;
        const msg =
          (typeof body === 'string' ? body : null) ||
          body?.message ||
          body?.error ||
          err?.message ||
          'Operazione non riuscita';
        Alert.alert('Errore', String(msg));
      }
      return;
    }

    if (phaseType === 'match_start') {
      try {
        await adminMatchesService.addEvent(match.id, { event_type: phaseType, minute: 0 });
        await loadDetail({ showLoading: false });
      } catch (err) {
        const body = err?.response?.data;
        const msg =
          (typeof body === 'string' ? body : null) ||
          body?.message ||
          body?.error ||
          err?.message ||
          'Operazione non riuscita';
        Alert.alert('Errore', String(msg));
      }
      return;
    }

    const m = computeSuggestedTimelineMinute(liveEvents, match, liveTimerOffsetSec);
    if (!Number.isFinite(m) || m < 0) {
      Alert.alert('Errore', 'Minuto non valido.');
      return;
    }
    try {
      await adminMatchesService.addEvent(match.id, { event_type: phaseType, minute: m });
      try {
        await tryAutoMatchEndAfterPhase(adminMatchesService, match.id, phaseType, match);
      } catch (e2) {
        Alert.alert(
          'Attenzione',
          'La fase è stata registrata ma la fine partita automatica non è andata a buon fine. Puoi riprovare dalla diretta se serve.',
        );
      }
      await loadDetail({ showLoading: false });
    } catch (err) {
      const body = err?.response?.data;
      const msg =
        (typeof body === 'string' ? body : null) ||
        body?.message ||
        body?.error ||
        err?.message ||
        'Operazione non riuscita';
      Alert.alert('Errore', String(msg));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleFavoriteMatch}>
            <Ionicons name={Number(favorites.match) === 1 ? 'star' : 'star-outline'} size={20} color="#ffc107" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleNotifications}>
            <Ionicons name={Number(notifications.enabled) === 1 ? 'notifications' : 'notifications-outline'} size={20} color="#667eea" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.heroColumn, showHeroScorerList && styles.heroColumnWithScorersBelow]}>
        <View style={[styles.heroTopRow, showHeroScorerList && styles.heroTopRowWithScorersBelow]}>
          <View style={styles.teamSlot}>
            <HeroTeamLogo logoUrl={match.home_team_logo_url} logoPath={match.home_team_logo_path} />
            <Text style={styles.team} numberOfLines={2}>
              {match.home_team_name || '-'}
            </Text>
          </View>
          <View style={styles.centerCol}>
            {heroClock.variant === 'running' ? (
              <View style={styles.heroRingWrap}>
                <MatchMinuteRing
                  size={HERO_RING_SIZE}
                  stroke={HERO_RING_STROKE}
                  trackColor={HERO_RING_TRACK}
                  progressColor={HERO_RING_PROGRESS}
                  progress={heroClock.ringProgress}
                  minuteStr={heroClock.minuteStr}
                  minuteTextStyle={styles.heroMinuteText}
                  minimumFontScale={0.65}
                  centerPaddingH={6}
                />
              </View>
            ) : (
              <Text
                style={[
                  styles.countdown,
                  (heroClock.main === 'PT' ||
                    heroClock.main === 'FT' ||
                    heroClock.main === 'PT sup' ||
                    heroClock.main === 'FT sup' ||
                    heroClock.main === 'Rigori' ||
                    heroClock.main === 'Fine partita') &&
                    styles.heroStaticPtFt,
                ]}
              >
                {heroClock.main}
              </Text>
            )}
            {matchHasStarted ? (
              <Text style={styles.heroLiveScore} accessibilityLiveRegion="polite" accessibilityLabel={`Risultato ${liveScorePreview.home} a ${liveScorePreview.away}`}>
                {liveScorePreview.home} – {liveScorePreview.away}
              </Text>
            ) : null}
            {heroClock.showSub && heroClock.sub ? <Text style={styles.kickoff}>{heroClock.sub}</Text> : null}
          </View>
          <View style={styles.teamSlot}>
            <HeroTeamLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} />
            <Text style={styles.team} numberOfLines={2}>
              {match.away_team_name || '-'}
            </Text>
          </View>
        </View>
        {showHeroScorerList ? (
          <View style={styles.heroScorersSection}>
            <View style={styles.heroScorersRow} accessibilityLabel="Marcatori">
              <View style={styles.heroScorersHome}>
                {heroScorerBlocks.homeLines.map((line, i) => (
                  <Text key={`hs-${i}`} style={[styles.heroScorerLine, styles.heroScorerLineHome]} numberOfLines={6}>
                    {line}
                  </Text>
                ))}
              </View>
              <View style={styles.heroScorersBallColumn}>
                <MaterialCommunityIcons name="soccer" size={22} color={HERO_MINUTE_COLOR} />
              </View>
              <View style={styles.heroScorersAway}>
                {heroScorerBlocks.awayLines.map((line, i) => (
                  <Text key={`as-${i}`} style={[styles.heroScorerLine, styles.heroScorerLineAway]} numberOfLines={6}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'overview' && styles.tabBtnActive]} onPress={() => setActiveTab('overview')}><Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>Panoramica</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'live' && styles.tabBtnActive]} onPress={() => setActiveTab('live')}><Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive]}>Diretta</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'lineup' && styles.tabBtnActive]} onPress={() => setActiveTab('lineup')}><Text style={[styles.tabText, activeTab === 'lineup' && styles.tabTextActive]}>Formazione</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'standings' && styles.tabBtnActive]} onPress={() => setActiveTab('standings')}><Text style={[styles.tabText, activeTab === 'standings' && styles.tabTextActive]}>Classifica</Text></TouchableOpacity>
      </ScrollView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={mainScrollPaddingBottom != null ? { paddingBottom: mainScrollPaddingBottom } : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'overview' && (
          <View style={styles.card}>
            <Text style={styles.row}><Ionicons name="calendar-outline" size={14} color="#666" />  {formatOverviewKickoffLine(match.kickoff_at)}</Text>
            <Text style={styles.row}><Ionicons name="location-outline" size={14} color="#666" />  {match.venue || '-'}</Text>
            <Text style={styles.row}><MaterialCommunityIcons name="whistle" size={14} color="#666" />  {match.referee || '-'}</Text>
            <Text style={styles.row}><MaterialCommunityIcons name="soccer-field" size={14} color="#666" />  {match.match_stage || '-'}</Text>
            {timingSegments && timingSegments.length > 0 ? (
              <View style={styles.timingWrap}>
                <TouchableOpacity
                  style={styles.timingDisclosure}
                  onPress={() => setTimingOpen((o) => !o)}
                  activeOpacity={0.65}
                >
                  <View style={styles.timingDisclosureLeft}>
                    <Ionicons name="time-outline" size={18} color="#667eea" />
                    <Text style={styles.timingDisclosureTitle}>Tempi e regolamento</Text>
                  </View>
                  <Ionicons name={timingOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#9ca3af" />
                </TouchableOpacity>
                {timingOpen ? (
                  <View style={styles.timingChipsRow}>
                    {timingSegments.map((seg) => (
                      <View key={seg.key} style={styles.timingChip}>
                        <Text style={styles.timingChipLabel} numberOfLines={1} ellipsizeMode="tail">
                          {seg.label}
                        </Text>
                        <Text style={styles.timingChipValue} numberOfLines={1} ellipsizeMode="tail">
                          {seg.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        )}
        {activeTab === 'lineup' && (
          <View style={[styles.card, styles.cardLineup]}>
            <View style={styles.twoCol}>
              <View style={styles.col}>
                {lineupHomeSorted.map((p, idx) => (
                  <LineupPlayerRow
                    key={`h-${p.order}-${p.name}`}
                    player={{ ...p, displayName: lineupHomeDisplayNames[idx] }}
                    jerseyIconColor={homeJerseyColors.icon}
                    teamShirtBaseHex={homeKitBaseHex}
                    onPressName={
                      p.id
                        ? () =>
                            openPlayerStatsFromLineup(p, lineupHomeDisplayNames[idx], match.home_league_id)
                        : undefined
                    }
                  />
                ))}
              </View>
              <View style={styles.lineupColDivider} />
              <View style={styles.col}>
                {lineupAwaySorted.map((p, idx) => (
                  <LineupPlayerRow
                    key={`a-${p.order}-${p.name}`}
                    variant="away"
                    player={{ ...p, displayName: lineupAwayDisplayNames[idx] }}
                    jerseyIconColor={awayJerseyColors.icon}
                    teamShirtBaseHex={awayKitBaseHex}
                    onPressName={
                      p.id
                        ? () =>
                            openPlayerStatsFromLineup(p, lineupAwayDisplayNames[idx], match.away_league_id)
                        : undefined
                    }
                  />
                ))}
              </View>
            </View>
          </View>
        )}
        {activeTab === 'live' && (
          <>
            <View style={[styles.liveKeyEventsHeading, styles.liveKeyEventsHeadingBelowTabs]}>
              <Text style={styles.keyEventsTitle}>Eventi chiave</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.timelineReverse}>
                {liveEventsTimelineSorted.map((ev) => {
                  if (ev.event_type === 'match_start') {
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text style={styles.matchEndLabel} numberOfLines={2}>
                          Inizio Partita
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  if (ev.event_type === 'second_half_start') {
                    return null;
                  }
                  if (ev.event_type === 'half_time') {
                    const partialHt = computePartialScoreBeforeEvent(liveEvents, ev, match);
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text
                          style={styles.matchEndLabel}
                          numberOfLines={2}
                          accessibilityLabel={`${PHASE_ROW_LABELS.half_time}, risultato parziale ${partialHt.home} a ${partialHt.away}`}
                        >
                          {PHASE_ROW_LABELS.half_time} {partialHt.home} - {partialHt.away}
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  if (ev.event_type === 'second_half_end') {
                    const ftLabel = labelSecondHalfEnd(match);
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text
                          style={styles.matchEndLabel}
                          numberOfLines={2}
                          accessibilityLiveRegion="polite"
                          accessibilityLabel={`${ftLabel}, risultato ${liveScorePreview.home} a ${liveScorePreview.away}`}
                        >
                          {ftLabel} {liveScorePreview.home} - {liveScorePreview.away}
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  if (ev.event_type === 'extra_second_half_end') {
                    const etEndLabel = labelExtraSecondHalfEnd(match);
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text
                          style={styles.matchEndLabel}
                          numberOfLines={2}
                          accessibilityLiveRegion="polite"
                          accessibilityLabel={`${etEndLabel}, risultato ${liveScorePreview.home} a ${liveScorePreview.away}`}
                        >
                          {etEndLabel} {liveScorePreview.home} - {liveScorePreview.away}
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  if (ev.event_type === 'penalties_start') {
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text style={styles.matchEndLabel} numberOfLines={2}>
                          Rigori
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  if (
                    PHASE_ROW_LABELS[ev.event_type] &&
                    ev.event_type !== 'half_time' &&
                    ev.event_type !== 'second_half_end' &&
                    ev.event_type !== 'extra_second_half_end'
                  ) {
                    return (
                      <View key={`ev-${ev.id}`} style={styles.livePhaseRow}>
                        <Text style={styles.livePhaseMinute}>
                          {formatMinuteStoppageLabel(ev.minute, regulationEndForLivePhase(ev.event_type, match))}
                        </Text>
                        <Text style={styles.livePhaseTitle}>{PHASE_ROW_LABELS[ev.event_type]}</Text>
                      </View>
                    );
                  }
                  if (ev.event_type === 'match_end') {
                    if (isTimelineMatchEndRedundant(match, liveEvents)) {
                      return null;
                    }
                    const score = computeLiveScoreFromEvents(liveEvents);
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text style={styles.matchEndLabel} numberOfLines={2}>
                          Fine partita {score.home} - {score.away}
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  const layoutHome = ev.event_type === 'own_goal' ? ev.team_side === 'away' : ev.team_side === 'home';
                  const playerName = ev?.payload?.player_name || '-';
                  const bonusType = LIVE_EVENT_BONUS_TYPES.has(ev.event_type) ? ev.event_type : null;
                  const iconEl = bonusType ? (
                    <BonusIcon type={bonusType} size={16} />
                  ) : (
                    <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#667eea" />
                  );
                  const phaseCtx = phaseContextForTimelineEvent(ev, match);
                  const minuteEl = (
                    <Text style={styles.eventMinute}>{formatStoredEventMinuteLabel(ev.minute, phaseCtx, match)}</Text>
                  );
                  const playerEl = (
                    <Text style={[styles.eventPlayer, layoutHome ? styles.eventPlayerHome : styles.eventPlayerAway]} numberOfLines={2}>
                      {playerName}
                    </Text>
                  );
                  return (
                    <View key={`ev-${ev.id}`} style={[styles.eventRow, layoutHome ? styles.eventLeft : styles.eventRight]}>
                      {layoutHome ? (
                        <>
                          {minuteEl}
                          {iconEl}
                          {playerEl}
                        </>
                      ) : (
                        <>
                          {playerEl}
                          {iconEl}
                          {minuteEl}
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        )}
        {activeTab === 'standings' && (
          <View style={styles.card}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: 38, textAlign: 'center' }]}>Pos</Text>
              <Text style={[styles.th, { flex: 1 }]}>Squadra</Text>
              <Text style={[styles.th, { width: 40, textAlign: 'center' }]}>PG</Text>
              <Text style={[styles.th, { width: 40, textAlign: 'center' }]}>DR</Text>
              <Text style={[styles.th, { width: 40, textAlign: 'center' }]}>Pt</Text>
            </View>
            {standings.map((r, i) => (
              <View key={`st-${i}`} style={styles.tableRow}>
                <Text style={[styles.td, { width: 38, textAlign: 'center' }]}>{r.position}</Text>
                <View style={[styles.teamCell, { flex: 1 }]}>
                  <TableTeamLogo logoUrl={r.team_logo_url} logoPath={r.team_logo_path} />
                  <Text style={[styles.td, styles.tdTeamName]} numberOfLines={2}>
                    {r.team_name_display}
                  </Text>
                </View>
                <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.played}</Text>
                <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.goal_diff}</Text>
                <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.points}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {activeTab === 'live' && canManageLive ? (
        <>
          {!showEventEditor ? (
            <TouchableOpacity
              style={[styles.liveFab, { bottom: Math.max(insets.bottom, 12) + 8, right: 16 }]}
              activeOpacity={0.85}
              onPress={() => {
                setEditorModalTab('events');
                setEventMinuteDirty(false);
                setShowEventEditor(true);
                setEventMinute(suggestedTimelineMinuteStr);
                fillMatchEndDefaults();
              }}
              accessibilityLabel="Aggiungi evento"
            >
              <MaterialCommunityIcons name="pencil" size={22} color="#fff" />
            </TouchableOpacity>
          ) : null}

          <Modal visible={showEventEditor} animationType="slide" transparent onRequestClose={closeEventModal}>
            <View style={styles.eventModalRoot}>
              <Pressable style={styles.eventModalBackdrop} onPress={closeEventModal} />
              <View style={[styles.eventModalSheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
                <View style={styles.eventModalHeader}>
                  <Text style={styles.eventModalTitle}>Editor diretta</Text>
                  <TouchableOpacity onPress={closeEventModal} style={styles.eventModalClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={26} color="#333" />
                  </TouchableOpacity>
                </View>
                <View style={styles.editorTabRow}>
                  <TouchableOpacity
                    style={[styles.editorTabBtn, editorModalTab === 'events' && styles.editorTabBtnActive]}
                    onPress={() => setEditorModalTab('events')}
                  >
                    <Text style={[styles.editorTabBtnText, editorModalTab === 'events' && styles.editorTabBtnTextActive]}>Eventi partita</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.editorTabBtn, editorModalTab === 'phases' && styles.editorTabBtnActive]}
                    onPress={() => {
                      setEditorModalTab('phases');
                      fillMatchEndDefaults();
                    }}
                  >
                    <Text style={[styles.editorTabBtnText, editorModalTab === 'phases' && styles.editorTabBtnTextActive]}>Fasi di gioco</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {editorModalTab === 'phases' ? (
                    <>
                      {nextPhaseStep?.type === 'match_end' ? (
                        <>
                          <Text style={styles.editorLabel}>Orario (HH:mm)</Text>
                          <TextInput style={styles.input} value={matchEndClock} onChangeText={setMatchEndClock} placeholder={clockNowHHmm()} />
                          <Text style={styles.matchEndScoreHint}>
                            Risultato da goal e autogol: {liveScorePreview.home} - {liveScorePreview.away} (si aggiorna automaticamente)
                          </Text>
                        </>
                      ) : null}
                      {nextPhaseStep ? (
                        <TouchableOpacity
                          style={styles.phaseActionBtn}
                          onPress={() => {
                            Keyboard.dismiss();
                            submitPhaseEvent(nextPhaseStep.type);
                          }}
                        >
                          <Text style={styles.phaseActionBtnText}>
                            {nextPhaseStep.type === 'match_end' && liveEvents.some((e) => e.event_type === 'match_end')
                              ? 'Aggiorna fine partita'
                              : nextPhaseStep.label}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.phaseDoneHint}>Tutte le fasi sono state registrate.</Text>
                      )}
                      {nextPhaseStep && nextPhaseStep.type !== 'match_end' ? (
                        <>
                          {nextPhaseStep.type === 'match_start' ? (
                            <>
                              <Text style={[styles.editorLabel, styles.phaseMinuteLabelBelow]}>Cronometro (minuto)</Text>
                              <Text style={styles.phaseMinuteHint}>Il calcio d&apos;inizio si registra al minuto 0.</Text>
                            </>
                          ) : (
                            <>
                              <Text style={[styles.editorLabel, styles.phaseMinuteLabelBelow]}>Cronometro (minuto)</Text>
                              <Text style={styles.phaseMinuteHint}>
                                {showPhaseHeroTimerAdjust
                                  ? 'Modifica solo se ti sei sbagliato: numeri, poi «Fatto» o il pulsante — conferma nel messaggio. Il minuto usato per la fase è quello del cronometro dopo il salvataggio.'
                                  : 'In pausa il minuto è solo informativo (timeline fissa). Quando il gioco riparte potrai correggere il cronometro di nuovo da qui.'}
                              </Text>
                              <View style={[styles.heroTimerEditRow, styles.heroTimerEditRowInModal]}>
                                <TextInput
                                  style={[styles.heroTimerInput, !showPhaseHeroTimerAdjust && styles.heroTimerInputReadonly]}
                                  keyboardType="number-pad"
                                  maxLength={3}
                                  returnKeyType="done"
                                  editable={showPhaseHeroTimerAdjust}
                                  value={
                                    showPhaseHeroTimerAdjust
                                      ? heroMinDraft
                                      : String(phaseModalSuggestedMinuteInt)
                                  }
                                  onChangeText={(t) => setHeroMinDraft(t.replace(/\D/g, '').slice(0, 3))}
                                  onFocus={() => setHeroMinFocused(true)}
                                  onBlur={() => setHeroMinFocused(false)}
                                  onSubmitEditing={showPhaseHeroTimerAdjust ? submitHeroTimerAdjust : undefined}
                                  accessibilityLabel="Minuto cronometro"
                                />
                                <TouchableOpacity
                                  style={[
                                    styles.heroTimerApplyBtn,
                                    !showPhaseHeroTimerAdjust && styles.heroTimerApplyBtnDisabled,
                                    showPhaseHeroTimerAdjust && heroTimerUi === 'ok' && styles.heroTimerApplyBtnOk,
                                    showPhaseHeroTimerAdjust && heroTimerUi === 'err' && styles.heroTimerApplyBtnErr,
                                    showPhaseHeroTimerAdjust &&
                                      heroMinPending &&
                                      heroTimerUi === 'idle' &&
                                      styles.heroTimerApplyBtnPending,
                                  ]}
                                  onPress={showPhaseHeroTimerAdjust ? submitHeroTimerAdjust : undefined}
                                  disabled={!showPhaseHeroTimerAdjust}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  accessibilityRole="button"
                                  accessibilityState={{ disabled: !showPhaseHeroTimerAdjust }}
                                  accessibilityLabel={
                                    !showPhaseHeroTimerAdjust
                                      ? 'Conferma cronometro non disponibile in pausa'
                                      : heroTimerUi === 'ok'
                                        ? 'Minuto aggiornato'
                                        : heroTimerUi === 'err'
                                          ? 'Modifica annullata'
                                          : 'Conferma nuovo minuto cronometro'
                                  }
                                >
                                  <Ionicons
                                    name={
                                      heroTimerUi === 'ok'
                                        ? 'checkmark-circle'
                                        : heroTimerUi === 'err'
                                          ? 'close-circle'
                                          : 'checkmark-done'
                                    }
                                    size={22}
                                    color={
                                      !showPhaseHeroTimerAdjust
                                        ? '#e5e7eb'
                                        : heroMinPending && heroTimerUi === 'idle'
                                          ? '#111827'
                                          : '#fff'
                                    }
                                  />
                                </TouchableOpacity>
                              </View>
                            </>
                          )}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.editorLabel}>Tipo evento</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        keyboardShouldPersistTaps="handled"
                        style={styles.eventTypeScroll}
                        contentContainerStyle={styles.eventTypeScrollContent}
                      >
                        {[
                          { id: 'goal', label: 'Goal' },
                          { id: 'own_goal', label: 'Autogol' },
                          { id: 'yellow_card', label: 'Giallo' },
                          { id: 'red_card', label: 'Rosso' },
                          { id: 'penalty_missed', label: 'Rigore sbagliato' },
                        ].map((et) => (
                          <TouchableOpacity
                            key={et.id}
                            style={[styles.chip, eventType === et.id && styles.chipActive]}
                            onPress={() => setEventType(et.id)}
                          >
                            <Text style={[styles.chipText, eventType === et.id && styles.chipTextActive]}>{et.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      <Text style={styles.editorLabel}>Squadra (autogol: chi lo commette)</Text>
                      <View style={styles.rowChips}>
                        <TouchableOpacity style={[styles.chip, eventTeamSide === 'home' && styles.chipActive]} onPress={() => { setEventTeamSide('home'); setEventPlayerName(''); }}>
                          <Text style={[styles.chipText, eventTeamSide === 'home' && styles.chipTextActive]}>{match.home_team_name}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.chip, eventTeamSide === 'away' && styles.chipActive]} onPress={() => { setEventTeamSide('away'); setEventPlayerName(''); }}>
                          <Text style={[styles.chipText, eventTeamSide === 'away' && styles.chipTextActive]}>{match.away_team_name}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.editorLabel}>Minuto</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        maxLength={3}
                        value={eventMinute}
                        onChangeText={(t) => {
                          const d = t.replace(/\D/g, '').slice(0, 3);
                          setEventMinute(d);
                          setEventMinuteDirty(d.trim() !== '');
                        }}
                        placeholder={suggestedTimelineMinuteStr}
                      />
                      <Text style={styles.editorLabel}>Giocatore (opzionale)</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.rowChips}>
                          {(teamPlayers[eventTeamSide] || []).map((p) => (
                            <TouchableOpacity key={`${eventTeamSide}-p-${p.order}-${p.name}`} style={[styles.chip, eventPlayerName === p.name && styles.chipActive]} onPress={() => setEventPlayerName(p.name)}>
                              <Text style={[styles.chipText, eventPlayerName === p.name && styles.chipTextActive]}>#{p.shirt_number ?? '-'} {p.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                      <TouchableOpacity style={styles.primaryBtn} onPress={submitEvent}>
                        <Text style={styles.primaryBtnText}>Inserisci evento</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ececec', paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerRight: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  heroColumn: {
    width: '100%',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececec',
  },
  heroColumnWithScorersBelow: {
    paddingBottom: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 22,
    minHeight: 168,
  },
  heroTopRowWithScorersBelow: {
    paddingBottom: 12,
    minHeight: 156,
  },
  teamSlot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, minWidth: 0 },
  heroLogo: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#f7f7f7' },
  heroLogoFallback: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  team: { fontWeight: '700', color: '#222', textAlign: 'center', fontSize: 13, lineHeight: 17 },
  centerCol: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    flexShrink: 0,
    minWidth: HERO_RING_SIZE,
  },
  heroScorersSection: {
    width: '100%',
    paddingHorizontal: 6,
    paddingTop: 0,
    paddingBottom: 16,
  },
  /** Casa | pallone | ospiti: stessa riga, allineati in alto al pallone; colonne larghe. */
  heroScorersRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  heroScorersHome: { flex: 1, alignItems: 'flex-end', minWidth: 0, paddingRight: 2 },
  heroScorersBallColumn: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    paddingTop: 0,
  },
  heroScorersAway: { flex: 1, alignItems: 'flex-start', minWidth: 0, paddingLeft: 2 },
  heroScorerLine: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  heroScorerLineHome: { textAlign: 'right' },
  heroScorerLineAway: { textAlign: 'left' },
  heroRingWrap: {
    position: 'relative',
    width: HERO_RING_SIZE,
    height: HERO_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroMinuteText: { fontWeight: '800', color: HERO_MINUTE_COLOR, fontSize: 15, letterSpacing: -0.3 },
  heroLiveScore: {
    marginTop: 6,
    fontSize: 19,
    fontWeight: '800',
    color: '#111827',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  countdown: { fontWeight: '800', color: '#667eea', fontSize: 18 },
  /** PT, FT, Fine partita al centro tra i loghi: nero come il minuto live. */
  heroStaticPtFt: { color: HERO_MINUTE_COLOR },
  kickoff: { color: '#666', marginTop: 4, fontSize: 13 },
  heroTimerEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    width: '100%',
    maxWidth: 200,
    alignSelf: 'center',
    paddingHorizontal: 2,
  },
  heroTimerEditRowInModal: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginTop: 0,
  },
  heroTimerInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    backgroundColor: '#f9fafb',
    textAlign: 'center',
  },
  heroTimerInputReadonly: {
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
  },
  heroTimerApplyBtn: {
    width: 44,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTimerApplyBtnPending: { backgroundColor: '#fbbf24' },
  heroTimerApplyBtnOk: { backgroundColor: '#16a34a' },
  heroTimerApplyBtnErr: { backgroundColor: '#dc2626' },
  heroTimerApplyBtnDisabled: {
    opacity: 0.55,
    backgroundColor: '#9ca3af',
  },
  tabsScroll: { flexGrow: 0, paddingTop: 8, maxHeight: 52 },
  tabsScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingRight: 20 },
  tabBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', flexShrink: 0 },
  tabBtnActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  tabText: { color: '#333', fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  content: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#ececec', padding: 12, marginBottom: 12 },
  /** Formazione: un filo più vicina ai bordi schermo, più padding interno così le maglie non “toccano” il bordo card. */
  cardLineup: { marginHorizontal: -4, paddingLeft: 10, paddingRight: 10, paddingVertical: 12 },
  row: { color: '#333', marginBottom: 10 },
  timingWrap: {
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  timingDisclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  timingDisclosureLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  timingDisclosureTitle: { fontSize: 14, fontWeight: '600', color: '#374151' },
  timingChipsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    marginTop: 10,
    paddingBottom: 2,
    gap: 8,
  },
  timingChip: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  timingChipLabel: { fontSize: 11, color: '#6b7280', marginBottom: 2 },
  timingChipValue: { fontSize: 14, fontWeight: '700', color: '#111827' },
  twoCol: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  col: { flex: 1, minWidth: 0 },
  /** Separatore tra i nomi casa / ospiti. */
  lineupColDivider: {
    width: 1,
    backgroundColor: '#d4d4d4',
    alignSelf: 'stretch',
    marginVertical: 4,
  },
  lineupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 4,
  },
  jerseyBadge: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  jerseyIcon: {
    position: 'absolute',
  },
  jerseyNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#111827',
    marginTop: -2,
  },
  /** Ruolo discreto: angolo destro in basso sulla maglietta. */
  jerseyRolePill: {
    position: 'absolute',
    bottom: 0,
    right: -1,
    minWidth: 15,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    zIndex: 2,
  },
  jerseyRolePillText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 8,
    lineHeight: 10,
  },
  jerseyRolePillMuted: {
    backgroundColor: '#adb5bd',
    borderColor: '#e9ecef',
  },
  jerseyRolePillTextMuted: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 7,
    lineHeight: 9,
  },
  lineupNamePressable: { flex: 1, minWidth: 0 },
  lineupPlayerNameText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#222',
    textAlign: 'center',
  },
  editorLabel: { fontSize: 12, color: '#666', marginBottom: 6, marginTop: 6 },
  matchEndScoreHint: { fontSize: 12, color: '#555', marginTop: 8, lineHeight: 18 },
  phaseMinuteLabelBelow: { marginTop: 16 },
  phaseMinuteHint: { fontSize: 12, color: '#666', marginBottom: 8, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fafafa' },
  rowChips: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  eventTypeScroll: { marginBottom: 4 },
  eventTypeScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, paddingRight: 16 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  chipText: { color: '#333', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { backgroundColor: '#667eea', borderRadius: 8, alignItems: 'center', paddingVertical: 10, marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  liveFab: {
    position: 'absolute',
    zIndex: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  eventModalRoot: { flex: 1, justifyContent: 'flex-end' },
  eventModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  eventModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '88%',
  },
  eventModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingTop: 4 },
  eventModalTitle: { fontSize: 18, fontWeight: '800', color: '#222' },
  eventModalClose: { padding: 4 },
  editorTabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  editorTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
  },
  editorTabBtnActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  editorTabBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  editorTabBtnTextActive: { color: '#fff' },
  phaseHint: { fontSize: 13, color: '#4b5563', lineHeight: 19, marginBottom: 12 },
  phaseDoneHint: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 14, fontStyle: 'italic' },
  phaseActionBtn: {
    backgroundColor: '#667eea',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  phaseActionBtnDisabled: { backgroundColor: '#c4c9d4' },
  phaseActionBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  livePhaseRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  livePhaseMinute: { fontSize: 13, fontWeight: '800', color: '#667eea' },
  livePhaseTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  liveKeyEventsHeading: {
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  liveKeyEventsHeadingBelowTabs: { marginTop: 18 },
  keyEventsTitle: { fontSize: 16, fontWeight: '800', color: '#222' },
  timelineReverse: { flexDirection: 'column-reverse', gap: 8 },
  eventRow: { maxWidth: '80%', borderWidth: 1, borderColor: '#ececec', borderRadius: 10, backgroundColor: '#fafafa', paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventLeft: { alignSelf: 'flex-start' },
  eventRight: { alignSelf: 'flex-end' },
  eventMinute: { fontWeight: '700', color: '#333' },
  eventPlayer: { color: '#333', flexShrink: 1 },
  eventPlayerHome: { textAlign: 'left' },
  eventPlayerAway: { textAlign: 'right' },
  matchEndBanner: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', width: '100%', marginVertical: 8, paddingVertical: 4 },
  matchEndLine: { flex: 1, height: StyleSheet.hairlineWidth * 2, minHeight: 1, backgroundColor: '#ccc' },
  matchEndLabel: { paddingHorizontal: 10, fontSize: 12, fontWeight: '700', color: '#444', textAlign: 'center', flexShrink: 1 },
  tableHeader: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#ececec', paddingBottom: 10, marginBottom: 4 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f3f3',
  },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  tableLogo: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#f7f7f7' },
  tableLogoFallback: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  th: { fontWeight: '700', color: '#555', fontSize: 13 },
  td: { color: '#222', fontSize: 14 },
  tdTeamName: { flex: 1, flexShrink: 1, fontWeight: '600' },
});
