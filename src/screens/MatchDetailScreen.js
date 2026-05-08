import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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

function isEnabledFlag(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && v === 1;
  if (typeof v === 'string') {
    const n = v.trim().toLowerCase();
    return n === '1' || n === 'true' || n === 't' || n === 'yes' || n === 'y' || n === 'on';
  }
  return false;
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
  if (isEnabledFlag(m.extra_time_enabled)) {
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
  if (isEnabledFlag(m.penalties_enabled)) {
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

function matchHasExtraTimeAndPenalties(match) {
  return Number(match?.extra_time_enabled) === 1 && Number(match?.penalties_enabled) === 1;
}

/** Dopo fine 2T reg. o fine 2T sup. (con sup.+rigori): si può chiudere con solo `match_end`, come partita senza fasi extra. */
function phaseStepOffersMatchEndShortcut(nextPhaseStep, match) {
  if (!nextPhaseStep || !matchHasExtraTimeAndPenalties(match)) return false;
  return nextPhaseStep.type === 'second_half_end' || nextPhaseStep.type === 'extra_second_half_end';
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

function stoppagePeriodEndsForMatch(match) {
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);
  const ends = [H, 2 * H];
  if (isEnabledFlag(match?.extra_time_enabled)) {
    if (et1 > 0) ends.push(2 * H + et1);
    if (et2 > 0) ends.push(2 * H + et1 + et2);
  }
  return ends.filter((n, i, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === i);
}

function stoppagePeriodEndForMinute(minuteValue, match) {
  const m = Number(minuteValue);
  if (!Number.isFinite(m)) return null;
  return stoppagePeriodEndsForMatch(match).find((end) => m > end && m <= end + 10) || null;
}

function eventStoppagePeriodEnd(ev, match) {
  const payloadEnd = Number(ev?.payload?.stoppage_period_end);
  const minute = Number(ev?.minute);
  if (!Number.isFinite(payloadEnd) || !Number.isFinite(minute)) return null;
  return stoppagePeriodEndsForMatch(match).includes(payloadEnd) && minute > payloadEnd && minute <= payloadEnd + 10
    ? payloadEnd
    : null;
}

function isStoppageEditableEventType(eventType) {
  return ['goal', 'own_goal', 'yellow_card', 'red_card', 'penalty_missed'].includes(eventType);
}

function isShootoutEventType(eventType) {
  return eventType === 'shootout_goal' || eventType === 'shootout_missed';
}

function computeShootoutScoreThroughEvent(events, targetEv) {
  const score = { home: 0, away: 0 };
  if (!Array.isArray(events) || !targetEv) return score;
  const targetId = Number(targetEv.id);
  const shootoutEvents = events
    .filter((ev) => ev && isShootoutEventType(ev.event_type))
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  for (const ev of shootoutEvents) {
    if (ev.event_type === 'shootout_goal') {
      if (ev.team_side === 'home') score.home += 1;
      if (ev.team_side === 'away') score.away += 1;
    }
    if (Number(ev.id) === targetId) break;
  }
  return score;
}

function computeShootoutState(events) {
  const state = { homeGoals: 0, awayGoals: 0, homeTaken: 0, awayTaken: 0 };
  if (!Array.isArray(events)) return state;
  for (const ev of events) {
    if (!ev || !isShootoutEventType(ev.event_type)) continue;
    if (ev.team_side === 'home') {
      state.homeTaken += 1;
      if (ev.event_type === 'shootout_goal') state.homeGoals += 1;
    } else if (ev.team_side === 'away') {
      state.awayTaken += 1;
      if (ev.event_type === 'shootout_goal') state.awayGoals += 1;
    }
  }
  return state;
}

function shootoutCanEnd(events) {
  const s = computeShootoutState(events);
  const maxRegularKicks = 5;
  const homeRemaining = Math.max(0, maxRegularKicks - s.homeTaken);
  const awayRemaining = Math.max(0, maxRegularKicks - s.awayTaken);
  if (s.homeGoals > s.awayGoals + awayRemaining) return true;
  if (s.awayGoals > s.homeGoals + homeRemaining) return true;
  return s.homeTaken >= maxRegularKicks && s.awayTaken >= maxRegularKicks && s.homeGoals !== s.awayGoals;
}

function hasKnockoutShootoutScore(matchRow) {
  return Number.isFinite(Number(matchRow?.home_shootout_score)) && Number.isFinite(Number(matchRow?.away_shootout_score));
}

function KnockoutScoreText({ score, shootoutScore }) {
  return (
    <View style={styles.knockoutScoreTextRow}>
      <Text style={styles.knockoutScoreText}>{score != null ? String(score) : ''}</Text>
      {shootoutScore != null ? (
        <>
          <View style={styles.knockoutShootoutDivider} />
          <Text style={styles.knockoutShootoutScoreText}>{shootoutScore}</Text>
        </>
      ) : null}
    </View>
  );
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

function TableTeamLogo({ logoUrl, logoPath, size = 36 }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  const safeSize = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 36;
  const boxStyle = {
    width: safeSize,
    height: safeSize,
    borderRadius: Math.max(4, Math.round(safeSize / 4)),
  };
  const iconSize = Math.max(10, Math.round(safeSize * 0.56));
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={[styles.tableLogoFallback, boxStyle]}>
        <Ionicons name="shield-outline" size={iconSize} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={[styles.tableLogo, boxStyle]} onError={() => setFailed(true)} resizeMode="contain" />;
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
const EMPTY_LINEUPS = { home: [], away: [] };

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
function LineupPlayerRow({
  player,
  variant = 'home',
  jerseyIconColor,
  teamShirtBaseHex,
  onPressName,
  compact = false,
  inlineAction = null,
}) {
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
      <MaterialCommunityIcons
        name="tshirt-crew"
        size={38}
        color={shirtTint}
        style={styles.jerseyIcon}
      />
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
    <Text
      style={[
        styles.lineupPlayerNameText,
        inlineAction && (variant === 'away' ? styles.lineupPlayerNameTextWithActionAway : styles.lineupPlayerNameTextWithActionHome),
      ]}
      numberOfLines={2}
    >
      {displayName}
    </Text>
  );
  const nameEl =
    typeof onPressName === 'function' ? (
      <TouchableOpacity
        style={[
          styles.lineupNamePressable,
          inlineAction && styles.lineupNamePressableWithAction,
          inlineAction && (variant === 'away' ? styles.lineupNamePressableWithActionAway : styles.lineupNamePressableWithActionHome),
        ]}
        onPress={onPressName}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={`Scheda giocatore ${displayName}`}
      >
        {nameText}
      </TouchableOpacity>
    ) : (
      <View
        style={[
          styles.lineupNamePressable,
          inlineAction && styles.lineupNamePressableWithAction,
          inlineAction && (variant === 'away' ? styles.lineupNamePressableWithActionAway : styles.lineupNamePressableWithActionHome),
        ]}
      >
        {nameText}
      </View>
    );
  const actionEl = inlineAction ? (
    <TouchableOpacity
      style={[
        styles.lineupInlineActionBtn,
        styles.lineupInlineActionBtnEmbedded,
        variant === 'away' ? styles.lineupInlineActionBtnAway : styles.lineupInlineActionBtnHome,
        inlineAction.type === 'add' && styles.lineupInlineActionBtnAdd,
      ]}
      onPress={inlineAction.onPress}
      disabled={inlineAction.disabled}
    >
      <Ionicons name={inlineAction.type === 'add' ? 'add' : 'remove'} size={16} color="#fff" />
    </TouchableOpacity>
  ) : null;

  if (variant === 'away') {
    return (
      <View style={styles.lineupRow}>
        {nameEl}
        {actionEl}
        {jersey}
      </View>
    );
  }
  return (
    <View style={styles.lineupRow}>
      {jersey}
      {actionEl}
      {nameEl}
    </View>
  );
}

/** Stessi tipi di BonusIcon (bonus/malus) — vedi `BONUS_ICONS` in BonusIcon.js */
const LIVE_EVENT_BONUS_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'penalty_missed', 'own_goal']);
const EDITABLE_LIVE_EVENT_TYPES = new Set(['goal', 'own_goal', 'yellow_card', 'red_card', 'penalty_missed', 'shootout_goal', 'shootout_missed']);
const LIVE_EVENT_TYPE_LABELS = {
  goal: 'Goal',
  own_goal: 'Autogol',
  yellow_card: 'Giallo',
  red_card: 'Rosso',
  penalty_missed: 'Rigore sbagliato',
  shootout_goal: 'Rigore segnato',
  shootout_missed: 'Rigore no goal',
  match_start: 'Inizio partita',
  half_time: 'Fine primo tempo',
  second_half_start: 'Inizio secondo tempo',
  second_half_end: 'Fine secondo tempo',
  extra_first_half_start: 'Inizio supplementari',
  extra_half_time: 'Fine primo tempo supplementari',
  extra_second_half_start: 'Inizio secondo tempo supplementari',
  extra_second_half_end: 'Fine secondo tempo supplementari',
  penalties_start: 'Rigori',
  match_end: 'Fine partita',
};
const EVENT_WIZARD_TYPES = [
  { id: 'goal', label: 'Goal', bonusType: 'goal' },
  { id: 'own_goal', label: 'Autogol', bonusType: 'own_goal' },
  { id: 'yellow_card', label: 'Ammonizione', bonusType: 'yellow_card' },
  { id: 'red_card', label: 'Espulsione', bonusType: 'red_card' },
  { id: 'penalty_missed', label: 'Rigore sbagliato', bonusType: 'penalty_missed' },
];

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
  const stoppageEnd = eventStoppagePeriodEnd(ev, match);
  if (stoppageEnd === H) return 'match_start';
  if (stoppageEnd === 2 * H) return 'second_half_start';
  if (stoppageEnd === 2 * H + et1) return 'extra_first_half_start';
  if (stoppageEnd === 2 * H + et1 + et2) return 'extra_second_half_start';
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
  if (isShootoutEventType(ev.event_type)) return 1e15 - 0.5;
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
  if (ev.event_type === 'extra_first_half_start') {
    const base = Math.max(2 * H, Number.isFinite(n) ? n : 0);
    return base + 0.002;
  }
  if (ev.event_type === 'extra_half_time') {
    const base = Math.max(2 * H + et1, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  if (ev.event_type === 'extra_second_half_start') {
    const base = Math.max(2 * H + et1, Number.isFinite(n) ? n : 0);
    return base + 0.002;
  }
  if (ev.event_type === 'extra_second_half_end') {
    const base = Math.max(2 * H + et1 + et2, Number.isFinite(n) ? n : 0);
    return base + 0.001;
  }
  const stoppageEnd = eventStoppagePeriodEnd(ev, match);
  if (stoppageEnd != null) {
    const added = Number.isFinite(n) ? Math.max(1, n - stoppageEnd) : 1;
    return stoppageEnd + 0.0005 + Math.min(99, added) / 100000;
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
  const from = String(route?.params?.from || '').trim();
  const fromTeamId = Number(route?.params?.teamId);
  const fromCompetitionId = Number(route?.params?.competitionId);
  const fromTeamName = route?.params?.teamName != null ? String(route.params.teamName) : undefined;
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [showEventEditor, setShowEventEditor] = useState(false);
  const [confirmEndMatchOpen, setConfirmEndMatchOpen] = useState(false);
  const [confirmAdvancePhase, setConfirmAdvancePhase] = useState(null);
  const [lineupEditMode, setLineupEditMode] = useState(false);
  const [savingUnavailable, setSavingUnavailable] = useState(false);
  const [unavailableIdsHome, setUnavailableIdsHome] = useState([]);
  const [unavailableIdsAway, setUnavailableIdsAway] = useState([]);
  const [eventType, setEventType] = useState('goal');
  const [eventTeamSide, setEventTeamSide] = useState('home');
  const [eventMinute, setEventMinute] = useState('');
  const [eventPlayerName, setEventPlayerName] = useState('');
  const [eventPlayerId, setEventPlayerId] = useState(null);
  const [eventAssistPlayerName, setEventAssistPlayerName] = useState('');
  const [eventAssistPlayerId, setEventAssistPlayerId] = useState(null);
  const [eventGoalInStoppage, setEventGoalInStoppage] = useState(false);
  const [eventWizardStep, setEventWizardStep] = useState(1);
  const [eventPlayerSearch, setEventPlayerSearch] = useState('');
  const [eventAssistSearch, setEventAssistSearch] = useState('');
  const [eventMinuteStepOpen, setEventMinuteStepOpen] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [savingPhase, setSavingPhase] = useState(false);
  const [shootoutTeamSide, setShootoutTeamSide] = useState('home');
  const [shootoutPlayerName, setShootoutPlayerName] = useState('');
  const [shootoutPlayerId, setShootoutPlayerId] = useState(null);
  const shootoutPlayersScrollRef = useRef(null);
  const eventWizardScrollRef = useRef(null);
  const [matchEndClock, setMatchEndClock] = useState('');
  const [timingOpen, setTimingOpen] = useState(false);
  const [editorModalTab, setEditorModalTab] = useState('events');
  /** Se true, il campo Minuto negli eventi non segue più il cronometro live. */
  const [eventMinuteDirty, setEventMinuteDirty] = useState(false);
  const eventMinuteClearedAtSuggestionRef = useRef(null);
  /** Offset secondi sul cronometro live (per fase = ultimo evento di fase); persistito in AsyncStorage. */
  const [liveTimerOffsetSec, setLiveTimerOffsetSec] = useState(0);
  const [heroMinDraft, setHeroMinDraft] = useState('');
  const [heroMinFocused, setHeroMinFocused] = useState(false);
  /** idle | ok | err — feedback pulsante accanto al minuto hero */
  const [heroTimerUi, setHeroTimerUi] = useState('idle');
  /** Tab Classifica: fasi finali pieghevole (gironi) / classifica pieghevole (semifinale-finale). */
  const [standingsKnockoutExpanded, setStandingsKnockoutExpanded] = useState(false);
  const [standingsTableFoldedOpen, setStandingsTableFoldedOpen] = useState(false);
  const [editingLiveEventId, setEditingLiveEventId] = useState(null);
  const [editingLiveEventDraft, setEditingLiveEventDraft] = useState(null);
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState(null);
  const [deletingLiveEventId, setDeletingLiveEventId] = useState(null);
  const [confirmTimerAdjust, setConfirmTimerAdjust] = useState(null);

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

  const handleBackNavigation = useCallback(() => {
    if (from === 'official-team' && fromTeamId > 0 && fromCompetitionId > 0) {
      navigation.navigate('OfficialTeamDetail', {
        teamId: fromTeamId,
        competitionId: fromCompetitionId,
        teamName: fromTeamName || '-',
      });
      return true;
    }
    if (from === 'matches-main') {
      navigation.navigate('MainTabs', { screen: 'Partite' });
      return true;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
    navigation.navigate('MainTabs', { screen: 'Partite' });
    return true;
  }, [navigation, from, fromTeamId, fromCompetitionId, fromTeamName, route?.params, matchId]);

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
      const backSub = BackHandler.addEventListener('hardwareBackPress', () => handleBackNavigation());
      return () => {
        clearInterval(poll);
        backSub.remove();
      };
    }, [matchId, loadDetail, handleBackNavigation, from, fromTeamId, fromCompetitionId, fromTeamName, route?.params])
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
  const unavailableLineups = data?.unavailable_lineups || EMPTY_LINEUPS;
  const teamPlayers = data?.team_players || { home: [], away: [] };
  const liveEvents = data?.events || [];
  const standings = data?.standings || [];
  const knockout = data?.knockout || { semifinals: [], final: null };
  const matchStageId = match?.match_stage_id != null ? Number(match.match_stage_id) : NaN;
  const standingsIsKnockoutMatch = matchStageId === 2 || matchStageId === 3;
  const hasKnockoutBracket =
    (Array.isArray(knockout.semifinals) && knockout.semifinals.length > 0) || !!knockout.final;

  useEffect(() => {
    const sid = match?.match_stage_id != null ? Number(match.match_stage_id) : NaN;
    if (sid === 2 || sid === 3) {
      setStandingsTableFoldedOpen(false);
    } else {
      setStandingsKnockoutExpanded(false);
    }
  }, [matchId, match?.match_stage_id]);

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

  const homeRosterSorted = useMemo(() => sortLineupForDisplay(teamPlayers.home || []), [teamPlayers.home]);
  const awayRosterSorted = useMemo(() => sortLineupForDisplay(teamPlayers.away || []), [teamPlayers.away]);
  const unavailableHomeSet = useMemo(() => new Set(unavailableIdsHome), [unavailableIdsHome]);
  const unavailableAwaySet = useMemo(() => new Set(unavailableIdsAway), [unavailableIdsAway]);
  const lineupHomeSorted = useMemo(
    () => homeRosterSorted.filter((p) => !unavailableHomeSet.has(Number(p.id))),
    [homeRosterSorted, unavailableHomeSet]
  );
  const lineupAwaySorted = useMemo(
    () => awayRosterSorted.filter((p) => !unavailableAwaySet.has(Number(p.id))),
    [awayRosterSorted, unavailableAwaySet]
  );
  const lineupHomeUnavailableSorted = useMemo(
    () => homeRosterSorted.filter((p) => unavailableHomeSet.has(Number(p.id))),
    [homeRosterSorted, unavailableHomeSet]
  );
  const lineupAwayUnavailableSorted = useMemo(
    () => awayRosterSorted.filter((p) => unavailableAwaySet.has(Number(p.id))),
    [awayRosterSorted, unavailableAwaySet]
  );
  const lineupHomeDisplayNames = useMemo(() => buildLineupDisplayNames(lineupHomeSorted), [lineupHomeSorted]);
  const lineupAwayDisplayNames = useMemo(() => buildLineupDisplayNames(lineupAwaySorted), [lineupAwaySorted]);
  const lineupHomeUnavailableDisplayNames = useMemo(() => buildLineupDisplayNames(lineupHomeUnavailableSorted), [lineupHomeUnavailableSorted]);
  const lineupAwayUnavailableDisplayNames = useMemo(() => buildLineupDisplayNames(lineupAwayUnavailableSorted), [lineupAwayUnavailableSorted]);
  const hasUnavailablePlayers = lineupHomeUnavailableSorted.length > 0 || lineupAwayUnavailableSorted.length > 0;
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

  useEffect(() => {
    if (lineupEditMode) return;
    const nextHome = (unavailableLineups.home || []).map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0);
    const nextAway = (unavailableLineups.away || []).map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0);
    setUnavailableIdsHome((prev) => {
      if (prev.length === nextHome.length && prev.every((v, i) => v === nextHome[i])) return prev;
      return nextHome;
    });
    setUnavailableIdsAway((prev) => {
      if (prev.length === nextAway.length && prev.every((v, i) => v === nextAway[i])) return prev;
      return nextAway;
    });
  }, [unavailableLineups.home, unavailableLineups.away, lineupEditMode, matchId]);
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
    setConfirmTimerAdjust({
      currentMinute: cur,
      targetMinute: M,
      rawElapsedSeconds: raw,
      secondModulo: sm,
      phaseType: last.event_type,
      anchorEventId: last.id,
    });
  }, [liveEvents, match, liveTimerOffsetSec, heroMinDraft, persistTimerOffsetToStorage]);

  const cancelHeroTimerAdjust = useCallback(() => {
    if (!confirmTimerAdjust) return;
    setConfirmTimerAdjust(null);
    setHeroTimerUi('err');
    setHeroMinDraft(String(confirmTimerAdjust.currentMinute));
    setTimeout(() => setHeroTimerUi('idle'), 1400);
  }, [confirmTimerAdjust]);

  const confirmHeroTimerAdjust = useCallback(() => {
    if (!confirmTimerAdjust) return;
    const targetSeg = computeTargetSegmentSecondsForDisplayMinute(
      confirmTimerAdjust.phaseType,
      match,
      confirmTimerAdjust.targetMinute,
      confirmTimerAdjust.secondModulo
    );
    const newOff = targetSeg - confirmTimerAdjust.rawElapsedSeconds;
    setLiveTimerOffsetSec(newOff);
    void persistTimerOffsetToStorage(newOff, confirmTimerAdjust.anchorEventId);
    setHeroMinDraft(String(confirmTimerAdjust.targetMinute));
    setHeroTimerUi('ok');
    setConfirmTimerAdjust(null);
    setTimeout(() => setHeroTimerUi('idle'), 1400);
  }, [confirmTimerAdjust, match, persistTimerOffsetToStorage]);

  const liveScorePreview = useMemo(() => computeLiveScoreFromEvents(liveEvents), [liveEvents]);
  const matchHasStarted = useMemo(() => liveEvents.some((e) => e.event_type === 'match_start'), [liveEvents]);
  const preMatchEditorMode = !matchHasStarted;
  const heroScorerBlocks = useMemo(() => buildHeroScorerBlocks(liveEvents, match), [liveEvents, match]);
  const showHeroScorerList =
    matchHasStarted && (Number(liveScorePreview.home) > 0 || Number(liveScorePreview.away) > 0);
  const nextPhaseStep = useMemo(() => getNextPhaseStep(match, liveEvents), [match, liveEvents]);
  const hasMatchEndEvent = useMemo(
    () => liveEvents.some((e) => e.event_type === 'match_end'),
    [liveEvents]
  );
  const showPhaseEditorTab = !hasMatchEndEvent;
  const showPhaseShortcutMatchEnd = useMemo(
    () => phaseStepOffersMatchEndShortcut(nextPhaseStep, match),
    [nextPhaseStep, match?.extra_time_enabled, match?.penalties_enabled]
  );
  const showShootoutEditorTab = useMemo(
    () => liveEvents.some((e) => e.event_type === 'penalties_start') && !hasMatchEndEvent,
    [liveEvents, hasMatchEndEvent]
  );
  const showTimerEditorTab = matchHasStarted && !hasMatchEndEvent;
  const hasOnlyPhaseEditorTab = preMatchEditorMode && showPhaseEditorTab && !showShootoutEditorTab;
  const hasShootoutPhase = useMemo(
    () => liveEvents.some((e) => e.event_type === 'penalties_start' || isShootoutEventType(e.event_type)),
    [liveEvents]
  );
  const shootoutState = useMemo(() => computeShootoutState(liveEvents), [liveEvents]);
  const shootoutHeroLabel = hasShootoutPhase ? `Rig.: ${shootoutState.homeGoals} - ${shootoutState.awayGoals}` : null;
  const shootoutTimelineLabel = hasShootoutPhase
    ? `Rigori [${shootoutState.homeGoals}] ${liveScorePreview.home} - ${liveScorePreview.away} [${shootoutState.awayGoals}]`
    : null;
  const heroMainText = shootoutHeroLabel && (heroClock.main === 'Rigori' || heroClock.main === 'Fine partita')
    ? shootoutHeroLabel
    : heroClock.main;
  const nextShootoutTeamSide = useMemo(() => {
    const shootoutEvents = (liveEvents || [])
      .filter((e) => e && isShootoutEventType(e.event_type))
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    const last = shootoutEvents[shootoutEvents.length - 1];
    return last?.team_side === 'home' ? 'away' : 'home';
  }, [liveEvents]);
  const shootoutPlayersOrdered = useMemo(() => {
    const takenIds = new Set(
      (liveEvents || [])
        .filter((e) => e && isShootoutEventType(e.event_type) && e.team_side === shootoutTeamSide)
        .map((e) => Number(e.player_id || e.payload?.player_id || 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    );
    return [...(teamPlayers[shootoutTeamSide] || [])].sort((a, b) => {
      const aTaken = takenIds.has(Number(a.id));
      const bTaken = takenIds.has(Number(b.id));
      if (aTaken !== bTaken) return aTaken ? 1 : -1;
      return Number(a.order || 0) - Number(b.order || 0);
    });
  }, [liveEvents, shootoutTeamSide, teamPlayers]);
  const showShootoutEndMatchAction = useMemo(
    () => showShootoutEditorTab && shootoutCanEnd(liveEvents),
    [showShootoutEditorTab, liveEvents]
  );
  const isPlayPhaseAction =
    nextPhaseStep?.type === 'match_start' ||
    nextPhaseStep?.type === 'second_half_start' ||
    nextPhaseStep?.type === 'extra_first_half_start';
  const phaseTypeIsTrueMatchEnd = useCallback(
    (phaseType) => {
      if (phaseType === 'match_end') return true;
      if (phaseType === 'second_half_end' || phaseType === 'extra_second_half_end') {
        return shouldAutoMatchEndAfterPhase(phaseType, match);
      }
      return false;
    },
    [match?.extra_time_enabled, match?.penalties_enabled]
  );
  const isPausePhaseAction =
    nextPhaseStep?.type === 'half_time' ||
    nextPhaseStep?.type === 'extra_half_time' ||
    ((nextPhaseStep?.type === 'second_half_end' || nextPhaseStep?.type === 'extra_second_half_end') &&
      !phaseTypeIsTrueMatchEnd(nextPhaseStep?.type));
  const isEndPhaseAction = phaseTypeIsTrueMatchEnd(nextPhaseStep?.type);
  const shouldCloseEditorOnPhaseSubmit = useCallback((phaseType) => (
    phaseType === 'match_start' ||
    phaseType === 'second_half_start' ||
    phaseType === 'extra_first_half_start' ||
    phaseType === 'extra_second_half_start' ||
    phaseType === 'second_half_end' ||
    phaseType === 'extra_second_half_end' ||
    phaseType === 'match_end'
  ), []);
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
        ? Math.max(insets.bottom, 28) + (canManageLive ? 88 : 32)
        : activeTab === 'standings'
          ? Math.max(insets.bottom, 28) + 18
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

  const openOfficialTeamDetail = (teamId, teamName) => {
    const tid = Number(teamId);
    const competitionId = Number(match.competition_id);
    if (!tid || !competitionId) return;
    navigation.replace('OfficialTeamDetail', {
      teamId: tid,
      competitionId,
      teamName: String(teamName || '').trim() || '-',
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

  const saveUnavailablePlayers = async (nextHomeIds, nextAwayIds) => {
    try {
      setSavingUnavailable(true);
      await adminMatchesService.updateUnavailablePlayers(match.id, {
        home_player_ids: nextHomeIds,
        away_player_ids: nextAwayIds,
      });
    } catch (err) {
      const body = err?.response?.data;
      const msg = (typeof body === 'string' ? body : null) || body?.message || body?.error || err?.message || 'Operazione non riuscita';
      Alert.alert('Errore', String(msg));
      await loadDetail({ showLoading: false });
    } finally {
      setSavingUnavailable(false);
    }
  };

  const toggleUnavailableDraft = (side, playerId) => {
    const pid = Number(playerId);
    if (!Number.isFinite(pid) || pid <= 0) return;
    const nextHome = side === 'home'
      ? (unavailableIdsHome.includes(pid) ? unavailableIdsHome.filter((id) => id !== pid) : [...unavailableIdsHome, pid])
      : unavailableIdsHome;
    const nextAway = side === 'away'
      ? (unavailableIdsAway.includes(pid) ? unavailableIdsAway.filter((id) => id !== pid) : [...unavailableIdsAway, pid])
      : unavailableIdsAway;
    setUnavailableIdsHome(nextHome);
    setUnavailableIdsAway(nextAway);
    void saveUnavailablePlayers(nextHome, nextAway);
  };

  const fillMatchEndDefaults = () => {
    const existing = liveEvents.find((e) => e.event_type === 'match_end');
    const prevClock = existing?.payload?.clock_time != null ? String(existing.payload.clock_time).trim() : '';
    setMatchEndClock(prevClock !== '' ? prevClock : clockNowHHmm());
  };

  useEffect(() => {
    if (showEventEditor && editorModalTab === 'phases' && !showPhaseEditorTab) {
      setEditorModalTab('editEvents');
    }
  }, [showEventEditor, editorModalTab, showPhaseEditorTab]);

  useEffect(() => {
    if (showEventEditor && editorModalTab === 'timer' && !showTimerEditorTab) {
      setEditorModalTab('phases');
    }
  }, [showEventEditor, editorModalTab, showTimerEditorTab]);

  useEffect(() => {
    if (!showEventEditor || editorModalTab !== 'events' || eventMinuteDirty) return;
    if ((eventMinute || '').trim() === '' && eventMinuteClearedAtSuggestionRef.current === suggestedTimelineMinuteStr) return;
    eventMinuteClearedAtSuggestionRef.current = null;
    setEventMinute(suggestedTimelineMinuteStr);
  }, [showEventEditor, editorModalTab, eventMinuteDirty, eventMinute, suggestedTimelineMinuteStr]);

  const eventMinuteNum = useMemo(() => parseTimelineMinuteToInt(eventMinute), [eventMinute]);
  const eventStoppagePeriodEndValue = useMemo(
    () => stoppagePeriodEndForMinute(eventMinuteNum, match),
    [eventMinuteNum, match]
  );
  const eventStoppageLabel = useMemo(
    () => eventStoppagePeriodEndValue != null ? formatMinuteStoppageLabel(eventMinuteNum, eventStoppagePeriodEndValue) : '',
    [eventMinuteNum, eventStoppagePeriodEndValue]
  );
  const eventPlayersSorted = useMemo(() => {
    const players = Array.isArray(teamPlayers?.[eventTeamSide]) ? teamPlayers[eventTeamSide] : [];
    return [...players].sort((a, b) => {
      const rawA = String(a?.shirt_number ?? '').trim();
      const rawB = String(b?.shirt_number ?? '').trim();
      const sa = rawA !== '' ? Number(rawA) : NaN;
      const sb = rawB !== '' ? Number(rawB) : NaN;
      const aa = Number.isFinite(sa) && sa > 0 ? sa : 999;
      const bb = Number.isFinite(sb) && sb > 0 ? sb : 999;
      if (aa !== bb) return aa - bb;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'it', { sensitivity: 'base' });
    });
  }, [teamPlayers, eventTeamSide]);
  const filteredEventPlayers = useMemo(() => {
    const q = String(eventPlayerSearch || '').trim().toLowerCase();
    if (!q) return eventPlayersSorted;
    return eventPlayersSorted.filter((p) => {
      const byName = String(p?.name || '').toLowerCase().includes(q);
      const byNumber = String(p?.shirt_number ?? '').trim().includes(q);
      return byName || byNumber;
    });
  }, [eventPlayersSorted, eventPlayerSearch]);
  const filteredEventAssistPlayers = useMemo(() => {
    const base = eventPlayersSorted.filter((p) => Number(p?.id) !== Number(eventPlayerId));
    const q = String(eventAssistSearch || '').trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) => {
      const byName = String(p?.name || '').toLowerCase().includes(q);
      const byNumber = String(p?.shirt_number ?? '').trim().includes(q);
      return byName || byNumber;
    });
  }, [eventPlayersSorted, eventPlayerId, eventAssistSearch]);
  const selectedEventTypeMeta = useMemo(
    () => EVENT_WIZARD_TYPES.find((t) => t.id === eventType) || EVENT_WIZARD_TYPES[0],
    [eventType]
  );
  const selectedEventPlayer = useMemo(
    () => eventPlayersSorted.find((p) => Number(p?.id) === Number(eventPlayerId)) || null,
    [eventPlayersSorted, eventPlayerId]
  );
  const selectedEventAssistPlayer = useMemo(
    () => eventPlayersSorted.find((p) => Number(p?.id) === Number(eventAssistPlayerId)) || null,
    [eventPlayersSorted, eventAssistPlayerId]
  );
  const hasAssistWizardStep = eventType === 'goal';
  const canSkipPlayerSelection = eventType === 'goal' || eventType === 'own_goal' || eventType === 'penalty_missed';
  const eventWizardLastStep = hasAssistWizardStep ? 5 : 4;
  const eventAssistWizardStep = 4;
  const eventSummaryWizardStep = eventWizardLastStep;

  useEffect(() => {
    setEventWizardStep((s) => Math.min(s, eventWizardLastStep));
  }, [eventWizardLastStep]);

  useEffect(() => {
    if (!showEventEditor || editorModalTab !== 'events' || !hasAssistWizardStep) return;
    if (eventWizardStep !== eventAssistWizardStep) return;
    requestAnimationFrame(() => {
      eventWizardScrollRef.current?.scrollTo?.({ y: 0, animated: true });
    });
  }, [showEventEditor, editorModalTab, hasAssistWizardStep, eventWizardStep, eventAssistWizardStep]);

  const closeEventModal = useCallback(() => {
    setShowEventEditor(false);
    setConfirmEndMatchOpen(false);
    setConfirmAdvancePhase(null);
    setConfirmDeleteEvent(null);
    setDeletingLiveEventId(null);
    setConfirmTimerAdjust(null);
    setEventType('goal');
    setEventTeamSide('home');
    setEventMinuteDirty(false);
    eventMinuteClearedAtSuggestionRef.current = null;
    setEventGoalInStoppage(false);
    setEventPlayerId(null);
    setEventAssistPlayerName('');
    setEventAssistPlayerId(null);
    setShootoutPlayerName('');
    setShootoutPlayerId(null);
    setEditingLiveEventId(null);
    setEditingLiveEventDraft(null);
    setEventWizardStep(1);
    setEventPlayerSearch('');
    setEventAssistSearch('');
    setEventMinuteStepOpen(false);
  }, []);

  const submitEvent = async () => {
    if (savingEvent) return;
    const rawMin = (eventMinute || '').trim();
    const minuteNum = parseTimelineMinuteToInt(rawMin);
    if (!Number.isFinite(minuteNum) || minuteNum < 0) {
      Alert.alert('Errore', 'Indica un minuto valido (es. 31 o 30+1)');
      return;
    }
    const stoppageEnd = isStoppageEditableEventType(eventType) && eventGoalInStoppage ? stoppagePeriodEndForMinute(minuteNum, match) : null;
    if (isStoppageEditableEventType(eventType) && eventGoalInStoppage && stoppageEnd == null) {
      Alert.alert('Errore', 'L\'evento nel recupero deve essere entro 10 minuti dalla fine di un tempo.');
      return;
    }
    try {
      setSavingEvent(true);
      await adminMatchesService.addEvent(match.id, {
        event_type: eventType,
        team_side: eventTeamSide,
        minute: minuteNum,
        team_id: eventTeamSide === 'home' ? match.home_team_id : match.away_team_id,
        player_id: eventPlayerId || null,
        assist_player_id: eventType === 'goal' ? (eventAssistPlayerId || null) : null,
        player_name: eventPlayerName.trim() || null,
        assist_player_name: eventType === 'goal' ? (eventAssistPlayerName.trim() || null) : null,
        stoppage_period_end: stoppageEnd,
      });
      setEventPlayerName('');
      setEventPlayerId(null);
      setEventAssistPlayerName('');
      setEventAssistPlayerId(null);
      setEventGoalInStoppage(false);
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
    } finally {
      setSavingEvent(false);
    }
  };

  const submitShootoutEvent = async (eventType) => {
    if (savingEvent) return;
    if (!isShootoutEventType(eventType)) return;
    try {
      setSavingEvent(true);
      await adminMatchesService.addEvent(match.id, {
        event_type: eventType,
        team_side: shootoutTeamSide,
        minute: null,
        team_id: shootoutTeamSide === 'home' ? match.home_team_id : match.away_team_id,
        player_id: shootoutPlayerId || null,
        player_name: shootoutPlayerName.trim() || null,
      });
      setShootoutPlayerName('');
      setShootoutPlayerId(null);
      setShootoutTeamSide(shootoutTeamSide === 'home' ? 'away' : 'home');
      setTimeout(() => shootoutPlayersScrollRef.current?.scrollTo?.({ x: 0, animated: false }), 0);
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
    } finally {
      setSavingEvent(false);
    }
  };

  const draftFromLiveEvent = (ev) => {
    const payload = ev?.payload || {};
    const side = String(ev?.team_side || 'home').trim() || 'home';
    const playerId = Number(ev?.player_id || payload.player_id || 0);
    const assistId = Number(ev?.assist_player_id || payload.assist_player_id || 0);
    return {
      event_type: String(ev?.event_type || 'goal'),
      team_side: side === 'away' ? 'away' : 'home',
      minute: ev?.minute != null ? String(ev.minute) : '',
      player_id: Number.isFinite(playerId) && playerId > 0 ? playerId : null,
      player_name: String(payload.player_name || '').trim(),
      assist_player_id: Number.isFinite(assistId) && assistId > 0 ? assistId : null,
      assist_player_name: String(payload.assist_player_name || '').trim(),
      goal_in_stoppage: eventStoppagePeriodEnd(ev, match) != null,
    };
  };

  const beginEditLiveEvent = (ev) => {
    setEditingLiveEventId(Number(ev?.id) || null);
    setEditingLiveEventDraft(draftFromLiveEvent(ev));
  };

  const saveEditedLiveEvent = async () => {
    if (!editingLiveEventId || !editingLiveEventDraft) return;
    const minuteNum = isShootoutEventType(editingLiveEventDraft.event_type)
      ? null
      : parseTimelineMinuteToInt(editingLiveEventDraft.minute);
    if (!isShootoutEventType(editingLiveEventDraft.event_type) && (!Number.isFinite(minuteNum) || minuteNum < 0)) {
      Alert.alert('Errore', 'Indica un minuto valido.');
      return;
    }
    const side = editingLiveEventDraft.team_side === 'away' ? 'away' : 'home';
    const editStoppageEnd =
      isStoppageEditableEventType(editingLiveEventDraft.event_type) && editingLiveEventDraft.goal_in_stoppage
        ? stoppagePeriodEndForMinute(minuteNum, match)
        : null;
    if (isStoppageEditableEventType(editingLiveEventDraft.event_type) && editingLiveEventDraft.goal_in_stoppage && editStoppageEnd == null) {
      Alert.alert('Errore', 'L\'evento nel recupero deve essere entro 10 minuti dalla fine di un tempo.');
      return;
    }
    await adminMatchesService.updateEvent(match.id, editingLiveEventId, {
      event_type: editingLiveEventDraft.event_type,
      team_side: side,
      team_id: side === 'home' ? match.home_team_id : match.away_team_id,
      minute: minuteNum,
      player_id: editingLiveEventDraft.player_id || null,
      assist_player_id: editingLiveEventDraft.event_type === 'goal' ? (editingLiveEventDraft.assist_player_id || null) : null,
      player_name: editingLiveEventDraft.player_name || null,
      assist_player_name: editingLiveEventDraft.event_type === 'goal' ? (editingLiveEventDraft.assist_player_name || null) : null,
      stoppage_period_end: editStoppageEnd,
    });
    setEditingLiveEventId(null);
    setEditingLiveEventDraft(null);
    await loadDetail({ showLoading: false });
  };

  const deleteLiveEvent = (ev) => {
    setConfirmDeleteEvent(ev || null);
  };

  const submitDeleteLiveEvent = async () => {
    const target = confirmDeleteEvent;
    const eventId = Number(target?.id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      setConfirmDeleteEvent(null);
      return;
    }
    try {
      setDeletingLiveEventId(eventId);
      await adminMatchesService.deleteEvent(match.id, eventId);
      if (Number(editingLiveEventId) === eventId) {
        setEditingLiveEventId(null);
        setEditingLiveEventDraft(null);
      }
      setConfirmDeleteEvent(null);
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
    } finally {
      setDeletingLiveEventId(null);
    }
  };

  const submitPhaseEvent = async (phaseType) => {
    if (savingPhase) return;
    if (phaseType === 'match_end') {
      try {
        setSavingPhase(true);
        await adminMatchesService.addEvent(match.id, {
          event_type: 'match_end',
          clock_time: matchEndClock.trim() || undefined,
        });
        setEventPlayerName('');
      setEventType('goal');
      setEventTeamSide('home');
      setEventPlayerId(null);
      setEventAssistPlayerName('');
      setEventAssistPlayerId(null);
      setEventGoalInStoppage(false);
      setEventWizardStep(1);
      setEventPlayerSearch('');
      setEventAssistSearch('');
      setEventMinuteStepOpen(false);
      setEventMinuteDirty(false);
      eventMinuteClearedAtSuggestionRef.current = null;
      setEventMinute(suggestedTimelineMinuteStr);
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
      } finally {
        setSavingPhase(false);
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
        setSavingPhase(true);
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
        if (shouldCloseEditorOnPhaseSubmit(phaseType)) {
          closeEventModal();
        }
      } catch (err) {
        const body = err?.response?.data;
        const msg =
          (typeof body === 'string' ? body : null) ||
          body?.message ||
          body?.error ||
          err?.message ||
          'Operazione non riuscita';
        Alert.alert('Errore', String(msg));
      } finally {
        setSavingPhase(false);
      }
      return;
    }

    if (phaseType === 'match_start') {
      try {
        setSavingPhase(true);
        await adminMatchesService.addEvent(match.id, { event_type: phaseType, minute: 0 });
        await loadDetail({ showLoading: false });
        if (shouldCloseEditorOnPhaseSubmit(phaseType)) {
          closeEventModal();
        }
      } catch (err) {
        const body = err?.response?.data;
        const msg =
          (typeof body === 'string' ? body : null) ||
          body?.message ||
          body?.error ||
          err?.message ||
          'Operazione non riuscita';
        Alert.alert('Errore', String(msg));
      } finally {
        setSavingPhase(false);
      }
      return;
    }

    const m = computeSuggestedTimelineMinute(liveEvents, match, liveTimerOffsetSec);
    if (!Number.isFinite(m) || m < 0) {
      Alert.alert('Errore', 'Minuto non valido.');
      return;
    }
    try {
      setSavingPhase(true);
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
      if (shouldCloseEditorOnPhaseSubmit(phaseType)) {
        closeEventModal();
      }
    } catch (err) {
      const body = err?.response?.data;
      const msg =
        (typeof body === 'string' ? body : null) ||
        body?.message ||
        body?.error ||
        err?.message ||
        'Operazione non riuscita';
      Alert.alert('Errore', String(msg));
    } finally {
      setSavingPhase(false);
    }
  };

  const buildAdvancePhaseWarning = (phaseType) => {
    const et = Number(match?.extra_time_enabled) === 1;
    const pens = Number(match?.penalties_enabled) === 1;
    const canHaveNextPhase =
      (phaseType === 'second_half_end' && (et || pens)) ||
      (phaseType === 'extra_second_half_end' && pens);
    if (!canHaveNextPhase) return null;

    const home = Number(liveScorePreview.home);
    const away = Number(liveScorePreview.away);
    if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) return null;

    const leadingTeamName = home > away ? match.home_team_name : match.away_team_name;
    return {
      phaseType,
      leadingTeamName: String(leadingTeamName || 'Una squadra'),
      score: `${home} - ${away}`,
      continueLabel: nextPhaseStep?.label || 'Vai avanti',
    };
  };

  const requestSubmitPhaseEvent = (phaseType) => {
    const warning = buildAdvancePhaseWarning(phaseType);
    if (warning) {
      Keyboard.dismiss();
      setConfirmAdvancePhase(warning);
      return;
    }
    submitPhaseEvent(phaseType);
  };

  const openKnockoutMatchDetail = useCallback(
    (targetMatchId) => {
      const tid = Number(targetMatchId);
      if (!Number.isFinite(tid) || tid <= 0 || tid === Number(matchId)) return;
      if (typeof navigation.push === 'function') {
        navigation.push('MatchDetail', { matchId: tid });
      } else {
        navigation.navigate('MatchDetail', { matchId: tid });
      }
    },
    [navigation, matchId]
  );

  const standingsKnockoutBracketGrid = useMemo(
    () => (
      <>
        <View style={styles.knockoutHeaderRow}>
          <Text style={styles.knockoutColumnTitle}>Semifinale</Text>
          <Text style={styles.knockoutColumnTitleSpacer} />
          <Text style={styles.knockoutColumnTitle}>Finale</Text>
        </View>
        <View style={styles.knockoutBracketRow}>
          <View style={styles.knockoutSemisCol}>
            {[0, 1].map((idx) => {
              const semi = knockout.semifinals?.[idx] || null;
              const semiHasShootout = hasKnockoutShootoutScore(semi);
              return (
                <View key={`semi-${idx}`} style={styles.knockoutSemiBlock}>
                  <View style={styles.knockoutSemiLabelRow}>
                    <Text style={styles.knockoutSemiSmallLabel}>SF {idx + 1}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.knockoutMatchStackMeasure}
                    activeOpacity={0.78}
                    disabled={!semi?.id}
                    onPress={() => openKnockoutMatchDetail(semi?.id)}
                    accessibilityRole={semi?.id ? 'button' : undefined}
                    accessibilityLabel={semi?.id ? `Apri partita semifinale ${idx + 1}` : undefined}
                  >
                    <View style={styles.knockoutMatchStack}>
                      <View style={styles.knockoutTeamBox}>
                        <View style={styles.knockoutTeamRow}>
                          {semi?.home_team_name ? (
                            <TableTeamLogo logoUrl={semi?.home_team_logo_url} logoPath={semi?.home_team_logo_path} size={30} />
                          ) : (
                            <View style={styles.knockoutLogoPlaceholder} />
                          )}
                          <Text style={styles.knockoutTeamText} numberOfLines={1}>
                            {semi?.home_team_name || '-'}
                          </Text>
                          <View style={styles.knockoutScoreBox}>
                            <KnockoutScoreText
                              score={semi?.home_score}
                              shootoutScore={semiHasShootout ? semi?.home_shootout_score : null}
                            />
                          </View>
                        </View>
                      </View>
                      <View style={styles.knockoutTeamBox}>
                        <View style={styles.knockoutTeamRow}>
                          {semi?.away_team_name ? (
                            <TableTeamLogo logoUrl={semi?.away_team_logo_url} logoPath={semi?.away_team_logo_path} size={30} />
                          ) : (
                            <View style={styles.knockoutLogoPlaceholder} />
                          )}
                          <Text style={styles.knockoutTeamText} numberOfLines={1}>
                            {semi?.away_team_name || '-'}
                          </Text>
                          <View style={styles.knockoutScoreBox}>
                            <KnockoutScoreText
                              score={semi?.away_score}
                              shootoutScore={semiHasShootout ? semi?.away_shootout_score : null}
                            />
                          </View>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={styles.knockoutFlowCol}>
            <View style={styles.knockoutBracketTopArm} />
            <View style={styles.knockoutBracketBottomArm} />
            <View style={styles.knockoutBracketVertical} />
            <View style={styles.knockoutBracketMiddleArm} />
          </View>

          <View style={styles.knockoutFinalCol}>
            <View style={styles.knockoutFinalLabelRow} />
            {(() => {
              const finalHasShootout = hasKnockoutShootoutScore(knockout.final);
              return (
            <TouchableOpacity
              style={styles.knockoutMatchStackMeasure}
              activeOpacity={0.78}
              disabled={!knockout.final?.id}
              onPress={() => openKnockoutMatchDetail(knockout.final?.id)}
              accessibilityRole={knockout.final?.id ? 'button' : undefined}
              accessibilityLabel={knockout.final?.id ? 'Apri partita finale' : undefined}
            >
              <View style={styles.knockoutMatchStack}>
                <View style={styles.knockoutTeamBox}>
                  <View style={styles.knockoutTeamRow}>
                    {knockout.final?.home_team_name ? (
                      <TableTeamLogo
                        logoUrl={knockout.final?.home_team_logo_url}
                        logoPath={knockout.final?.home_team_logo_path}
                        size={30}
                      />
                    ) : (
                      <View style={styles.knockoutLogoPlaceholder} />
                    )}
                    <Text style={styles.knockoutTeamText} numberOfLines={1}>
                      {knockout.final?.home_team_name || '-'}
                    </Text>
                    <View style={styles.knockoutScoreBox}>
                      <KnockoutScoreText
                        score={knockout.final?.home_score}
                        shootoutScore={finalHasShootout ? knockout.final?.home_shootout_score : null}
                      />
                    </View>
                  </View>
                </View>
                <View style={styles.knockoutTeamBox}>
                  <View style={styles.knockoutTeamRow}>
                    {knockout.final?.away_team_name ? (
                      <TableTeamLogo
                        logoUrl={knockout.final?.away_team_logo_url}
                        logoPath={knockout.final?.away_team_logo_path}
                        size={30}
                      />
                    ) : (
                      <View style={styles.knockoutLogoPlaceholder} />
                    )}
                    <Text style={styles.knockoutTeamText} numberOfLines={1}>
                      {knockout.final?.away_team_name || '-'}
                    </Text>
                    <View style={styles.knockoutScoreBox}>
                      <KnockoutScoreText
                        score={knockout.final?.away_score}
                        shootoutScore={finalHasShootout ? knockout.final?.away_shootout_score : null}
                      />
                    </View>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </>
    ),
    [knockout, openKnockoutMatchDetail]
  );

  const standingsTableInner = useMemo(
    () => (
      <>
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
            <TouchableOpacity
              style={[styles.teamCell, { flex: 1 }]}
              activeOpacity={0.75}
              disabled={!Number(r.team_id)}
              onPress={() => openOfficialTeamDetail(r.team_id, r.team_name_display || r.team_name)}
            >
              <TableTeamLogo logoUrl={r.team_logo_url} logoPath={r.team_logo_path} />
              <Text style={[styles.td, styles.tdTeamName]} numberOfLines={2}>
                {r.team_name_display || r.team_name || '-'}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.played}</Text>
            <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.goal_diff}</Text>
            <Text style={[styles.td, { width: 40, textAlign: 'center' }]}>{r.points}</Text>
          </View>
        ))}
      </>
    ),
    [openOfficialTeamDetail, standings]
  );

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
        <TouchableOpacity style={styles.iconBtn} onPress={handleBackNavigation}>
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
            <TouchableOpacity activeOpacity={0.75} onPress={() => openOfficialTeamDetail(match.home_team_id, match.home_team_name)}>
              <HeroTeamLogo logoUrl={match.home_team_logo_url} logoPath={match.home_team_logo_path} />
            </TouchableOpacity>
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
                  (heroMainText === 'PT' ||
                    heroMainText === 'FT' ||
                    heroMainText === 'PT sup' ||
                    heroMainText === 'FT sup' ||
                    heroMainText === 'Rigori' ||
                    heroMainText === 'Fine partita' ||
                    String(heroMainText || '').startsWith('Rig.:')) &&
                    styles.heroStaticPtFt,
                ]}
              >
                {heroMainText}
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
            <TouchableOpacity activeOpacity={0.75} onPress={() => openOfficialTeamDetail(match.away_team_id, match.away_team_name)}>
              <HeroTeamLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} />
            </TouchableOpacity>
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
          <View style={[styles.card, styles.cardLineup, lineupEditMode && styles.cardLineupCompact]}>
            <View style={[styles.twoCol, lineupEditMode && styles.twoColCompact]}>
              <View style={styles.col}>
                {lineupHomeSorted.map((p, idx) => (
                  <LineupPlayerRow
                    key={`h-${p.order}-${p.name}`}
                    player={{ ...p, displayName: lineupHomeDisplayNames[idx] }}
                    compact={lineupEditMode}
                    jerseyIconColor={homeJerseyColors.icon}
                    teamShirtBaseHex={homeKitBaseHex}
                    onPressName={
                      p.id
                        ? () =>
                            openPlayerStatsFromLineup(p, lineupHomeDisplayNames[idx], match.home_league_id)
                        : undefined
                    }
                    inlineAction={
                      lineupEditMode
                        ? {
                            type: 'remove',
                            onPress: () => toggleUnavailableDraft('home', p.id),
                            disabled: savingUnavailable,
                          }
                        : null
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
                    compact={lineupEditMode}
                    jerseyIconColor={awayJerseyColors.icon}
                    teamShirtBaseHex={awayKitBaseHex}
                    onPressName={
                      p.id
                        ? () =>
                            openPlayerStatsFromLineup(p, lineupAwayDisplayNames[idx], match.away_league_id)
                        : undefined
                    }
                    inlineAction={
                      lineupEditMode
                        ? {
                            type: 'remove',
                            onPress: () => toggleUnavailableDraft('away', p.id),
                            disabled: savingUnavailable,
                          }
                        : null
                    }
                  />
                ))}
              </View>
            </View>
            {hasUnavailablePlayers ? (
              <>
                <View style={styles.lineupSectionDivider} />
                <View style={styles.lineupUnavailableHeader}>
                  <Text style={styles.unavailableTitle}>Non disponibili</Text>
                  <View style={styles.lineupUnavailableHeaderLine} />
                </View>
                <View style={[styles.twoCol, styles.lineupUnavailableGrid, lineupEditMode && styles.twoColCompact]}>
                  <View style={styles.col}>
                    {lineupHomeUnavailableSorted.map((p, idx) => (
                      <LineupPlayerRow
                        key={`hu-${p.order}-${p.name}`}
                        player={{ ...p, displayName: lineupHomeUnavailableDisplayNames[idx] }}
                        compact={lineupEditMode}
                        jerseyIconColor={homeJerseyColors.icon}
                        teamShirtBaseHex={homeKitBaseHex}
                        onPressName={
                          p.id
                            ? () => openPlayerStatsFromLineup(p, lineupHomeUnavailableDisplayNames[idx], match.home_league_id)
                            : undefined
                        }
                        inlineAction={
                          lineupEditMode
                            ? {
                                type: 'add',
                                onPress: () => toggleUnavailableDraft('home', p.id),
                                disabled: savingUnavailable,
                              }
                            : null
                        }
                      />
                    ))}
                  </View>
                  <View style={styles.lineupColDivider} />
                  <View style={styles.col}>
                    {lineupAwayUnavailableSorted.map((p, idx) => (
                      <LineupPlayerRow
                        key={`au-${p.order}-${p.name}`}
                        variant="away"
                        player={{ ...p, displayName: lineupAwayUnavailableDisplayNames[idx] }}
                        compact={lineupEditMode}
                        jerseyIconColor={awayJerseyColors.icon}
                        teamShirtBaseHex={awayKitBaseHex}
                        onPressName={
                          p.id
                            ? () => openPlayerStatsFromLineup(p, lineupAwayUnavailableDisplayNames[idx], match.away_league_id)
                            : undefined
                        }
                        inlineAction={
                          lineupEditMode
                            ? {
                                type: 'add',
                                onPress: () => toggleUnavailableDraft('away', p.id),
                                disabled: savingUnavailable,
                              }
                            : null
                        }
                      />
                    ))}
                  </View>
                </View>
              </>
            ) : null}
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
                  if (
                    ev.event_type === 'second_half_start' ||
                    ev.event_type === 'extra_first_half_start' ||
                    ev.event_type === 'extra_second_half_start' ||
                    ev.event_type === 'penalties_start'
                  ) {
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
                  if (ev.event_type === 'extra_half_time') {
                    const partialEt1 = computePartialScoreBeforeEvent(liveEvents, ev, match);
                    return (
                      <View key={`ev-${ev.id}`} style={styles.matchEndBanner}>
                        <View style={styles.matchEndLine} />
                        <Text
                          style={styles.matchEndLabel}
                          numberOfLines={2}
                          accessibilityLabel={`${PHASE_ROW_LABELS.extra_half_time}, risultato parziale ${partialEt1.home} a ${partialEt1.away}`}
                        >
                          {PHASE_ROW_LABELS.extra_half_time} {partialEt1.home} - {partialEt1.away}
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
                  if (
                    PHASE_ROW_LABELS[ev.event_type] &&
                    ev.event_type !== 'half_time' &&
                    ev.event_type !== 'extra_first_half_start' &&
                    ev.event_type !== 'extra_half_time' &&
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
                          {shootoutTimelineLabel || `Fine partita ${score.home} - ${score.away}`}
                        </Text>
                        <View style={styles.matchEndLine} />
                      </View>
                    );
                  }
                  const layoutHome = ev.event_type === 'own_goal' ? ev.team_side === 'away' : ev.team_side === 'home';
                  const shootoutScore = isShootoutEventType(ev.event_type) ? computeShootoutScoreThroughEvent(liveEvents, ev) : null;
                  const shootoutSubtext = isShootoutEventType(ev.event_type)
                    ? `${ev.event_type === 'shootout_goal' ? 'Goal' : 'Sbagliato'} (${shootoutScore.home}-${shootoutScore.away})`
                    : '';
                  const playerName = ev?.payload?.player_name || (isShootoutEventType(ev.event_type) ? 'Tiratore non scelto' : '-');
                  const assistPlayerName =
                    ev.event_type === 'goal' && ev?.payload?.assist_player_name
                      ? String(ev.payload.assist_player_name).trim()
                      : '';
                  const bonusType = LIVE_EVENT_BONUS_TYPES.has(ev.event_type) ? ev.event_type : null;
                  const iconEl = ev.event_type === 'shootout_goal' ? (
                    <Ionicons name="checkmark-circle" size={28} color="#198754" />
                  ) : ev.event_type === 'shootout_missed' ? (
                    <Ionicons name="close-circle" size={28} color="#e53935" />
                  ) : bonusType ? (
                    <BonusIcon type={bonusType} size={16} />
                  ) : (
                    <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#667eea" />
                  );
                  const phaseCtx = phaseContextForTimelineEvent(ev, match);
                  const minuteEl = isShootoutEventType(ev.event_type) ? null : (
                    <Text style={styles.eventMinute}>{formatStoredEventMinuteLabel(ev.minute, phaseCtx, match)}</Text>
                  );
                  const playerEl = (
                    <View style={[styles.eventPlayerBlock, layoutHome ? styles.eventPlayerHome : styles.eventPlayerAway]}>
                      <Text style={[styles.eventPlayer, layoutHome ? styles.eventPlayerHome : styles.eventPlayerAway]} numberOfLines={1}>
                        {playerName}
                      </Text>
                      {shootoutSubtext ? (
                        <Text style={[styles.eventAssist, layoutHome ? styles.eventPlayerHome : styles.eventPlayerAway]} numberOfLines={1}>
                          {shootoutSubtext}
                        </Text>
                      ) : assistPlayerName ? (
                        <Text style={[styles.eventAssist, layoutHome ? styles.eventPlayerHome : styles.eventPlayerAway]} numberOfLines={1}>
                          Assist: {assistPlayerName}
                        </Text>
                      ) : null}
                    </View>
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
          <>
            {standingsIsKnockoutMatch ? (
              <>
                {hasKnockoutBracket ? (
                  <View style={[styles.card, styles.knockoutCard]}>
                    <Text style={styles.knockoutTitle}>Fasi finali</Text>
                    {standingsKnockoutBracketGrid}
                  </View>
                ) : null}
                {standings.length > 0 ? (
                  <View style={[styles.card, styles.knockoutCard]}>
                    <TouchableOpacity
                      style={styles.standingsFoldHeader}
                      onPress={() => setStandingsTableFoldedOpen((o) => !o)}
                      activeOpacity={0.65}
                    >
                      <View style={styles.timingDisclosureLeft}>
                        <MaterialCommunityIcons name="table-large" size={18} color="#667eea" />
                        <Text style={styles.timingDisclosureTitle}>Classifica</Text>
                      </View>
                      <Ionicons
                        name={standingsTableFoldedOpen ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color="#9ca3af"
                      />
                    </TouchableOpacity>
                    {standingsTableFoldedOpen ? standingsTableInner : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={[styles.card, styles.knockoutCard]}>{standingsTableInner}</View>
                {hasKnockoutBracket ? (
                  <View style={[styles.card, styles.knockoutCard]}>
                    <TouchableOpacity
                      style={styles.standingsFoldHeader}
                      onPress={() => setStandingsKnockoutExpanded((o) => !o)}
                      activeOpacity={0.65}
                    >
                      <View style={styles.timingDisclosureLeft}>
                        <MaterialCommunityIcons name="trophy-outline" size={18} color="#667eea" />
                        <Text style={styles.timingDisclosureTitle}>Fasi finali</Text>
                      </View>
                      <Ionicons
                        name={standingsKnockoutExpanded ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color="#9ca3af"
                      />
                    </TouchableOpacity>
                    {standingsKnockoutExpanded ? standingsKnockoutBracketGrid : null}
                  </View>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>

      {activeTab === 'lineup' && canManageLive ? (
        <>
          <TouchableOpacity
            style={[styles.liveFab, { bottom: Math.max(insets.bottom, 12) + 8, right: 16 }]}
            activeOpacity={0.85}
            onPress={() => {
              if (!lineupEditMode) {
                const nextHome = (unavailableLineups.home || []).map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0);
                const nextAway = (unavailableLineups.away || []).map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0);
                setUnavailableIdsHome(nextHome);
                setUnavailableIdsAway(nextAway);
                setLineupEditMode(true);
                return;
              }
              setLineupEditMode(false);
              void loadDetail({ showLoading: false });
            }}
            accessibilityLabel="Modifica non disponibili"
          >
            <MaterialCommunityIcons name={lineupEditMode ? 'check' : 'pencil'} size={22} color="#fff" />
          </TouchableOpacity>
        </>
      ) : null}

      {activeTab === 'live' && canManageLive ? (
        <>
          {!showEventEditor ? (
            <TouchableOpacity
              style={[styles.liveFab, { bottom: Math.max(insets.bottom, 12) + 8, right: 16 }]}
              activeOpacity={0.85}
              onPress={() => {
                setEventType('goal');
                setEventTeamSide('home');
                if (preMatchEditorMode) {
                  setEditorModalTab('phases');
                } else {
                  setEditorModalTab(showShootoutEditorTab ? 'shootout' : 'events');
                }
                if (showShootoutEditorTab) {
                  setShootoutTeamSide(nextShootoutTeamSide);
                  setShootoutPlayerName('');
                  setShootoutPlayerId(null);
                }
                setEventMinuteDirty(false);
                setEventWizardStep(1);
                setEventPlayerSearch('');
                setEventAssistSearch('');
                setEventMinuteStepOpen(false);
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
              <View
                style={[
                  styles.eventModalSheet,
                  { paddingBottom: Math.max(insets.bottom, 12) + 12 },
                ]}
              >
                <View style={styles.eventModalHeader}>
                  <Text style={styles.eventModalTitle}>Editor diretta</Text>
                  <TouchableOpacity onPress={closeEventModal} style={styles.eventModalClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={26} color="#333" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  horizontal={!hasOnlyPhaseEditorTab}
                  showsHorizontalScrollIndicator={false}
                  style={styles.editorTabScroll}
                  contentContainerStyle={[styles.editorTabRow, hasOnlyPhaseEditorTab && styles.editorTabRowSingle]}
                >
                  {!preMatchEditorMode ? (
                    <TouchableOpacity
                      style={[styles.editorTabBtn, editorModalTab === 'events' && styles.editorTabBtnActive]}
                      onPress={() => setEditorModalTab('events')}
                    >
                      <Text style={[styles.editorTabBtnText, editorModalTab === 'events' && styles.editorTabBtnTextActive]}>Eventi</Text>
                    </TouchableOpacity>
                  ) : null}
                  {showPhaseEditorTab ? (
                    <TouchableOpacity
                      style={[styles.editorTabBtn, hasOnlyPhaseEditorTab && styles.editorTabBtnSingle, editorModalTab === 'phases' && styles.editorTabBtnActive]}
                      onPress={() => {
                        setEditorModalTab('phases');
                        fillMatchEndDefaults();
                      }}
                    >
                      <Text style={[styles.editorTabBtnText, editorModalTab === 'phases' && styles.editorTabBtnTextActive]}>Fasi di gioco</Text>
                    </TouchableOpacity>
                  ) : null}
                  {showTimerEditorTab ? (
                    <TouchableOpacity
                      style={[styles.editorTabBtn, editorModalTab === 'timer' && styles.editorTabBtnActive]}
                      onPress={() => setEditorModalTab('timer')}
                    >
                      <View style={styles.editorTabWithIcon}>
                        <MaterialCommunityIcons
                          name="timer-outline"
                          size={15}
                          color={editorModalTab === 'timer' ? '#667eea' : '#475569'}
                          style={styles.editorTabIcon}
                        />
                        <Text style={[styles.editorTabBtnText, editorModalTab === 'timer' && styles.editorTabBtnTextActive]}>Cronometro</Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                  {showShootoutEditorTab ? (
                    <TouchableOpacity
                      style={[styles.editorTabBtn, editorModalTab === 'shootout' && styles.editorTabBtnActive]}
                      onPress={() => {
                        setEditorModalTab('shootout');
                        setShootoutTeamSide(nextShootoutTeamSide);
                        setShootoutPlayerName('');
                        setShootoutPlayerId(null);
                      }}
                    >
                      <Text style={[styles.editorTabBtnText, editorModalTab === 'shootout' && styles.editorTabBtnTextActive]}>Rigori</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!preMatchEditorMode ? (
                    <TouchableOpacity
                      style={[styles.editorTabBtn, editorModalTab === 'editEvents' && styles.editorTabBtnActive]}
                      onPress={() => setEditorModalTab('editEvents')}
                    >
                      <Text style={[styles.editorTabBtnText, editorModalTab === 'editEvents' && styles.editorTabBtnTextActive]}>Modifica eventi</Text>
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
                <ScrollView ref={eventWizardScrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {editorModalTab === 'phases' ? (
                    <>
                      {nextPhaseStep ? (
                        showPhaseShortcutMatchEnd ? (
                          <>
                            <TouchableOpacity
                              style={[
                                styles.phaseActionBtn,
                                isPlayPhaseAction && styles.phaseActionBtnStart,
                                isPausePhaseAction && styles.phaseActionBtnPause,
                                isEndPhaseAction && styles.phaseActionBtnEnd,
                                savingPhase && styles.actionBtnDisabled,
                              ]}
                              disabled={savingPhase}
                              onPress={() => {
                                Keyboard.dismiss();
                                requestSubmitPhaseEvent(nextPhaseStep.type);
                              }}
                            >
                              <View style={styles.phaseActionBtnContent}>
                                {isPlayPhaseAction ? (
                                  <MaterialCommunityIcons name="play-circle" size={18} color="#f0fdf4" style={styles.phaseActionBtnStartIcon} />
                                ) : isPausePhaseAction ? (
                                  <MaterialCommunityIcons name="pause-circle" size={20} color="#111111" style={styles.phaseActionBtnStartIcon} />
                                ) : isEndPhaseAction ? (
                                  <MaterialCommunityIcons name="stop-circle" size={20} color="#fef2f2" style={styles.phaseActionBtnStartIcon} />
                                ) : null}
                                <Text
                                  style={[
                                    styles.phaseActionBtnText,
                                    isPlayPhaseAction && styles.phaseActionBtnTextStart,
                                    isPausePhaseAction && styles.phaseActionBtnTextPause,
                                    isEndPhaseAction && styles.phaseActionBtnTextEnd,
                                  ]}
                                >
                                  {savingPhase ? 'Salvataggio...' : nextPhaseStep.label}
                                </Text>
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.phaseActionBtn, styles.phaseActionBtnEnd, savingPhase && styles.actionBtnDisabled]}
                              disabled={savingPhase}
                              onPress={() => {
                                Keyboard.dismiss();
                                setConfirmEndMatchOpen(true);
                              }}
                            >
                              <View style={styles.phaseActionBtnContent}>
                                <MaterialCommunityIcons name="stop-circle" size={20} color="#fef2f2" style={styles.phaseActionBtnStartIcon} />
                                <Text style={[styles.phaseActionBtnText, styles.phaseActionBtnTextEnd]}>Fine partita</Text>
                              </View>
                            </TouchableOpacity>
                            
                          </>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.phaseActionBtn,
                              isPlayPhaseAction && styles.phaseActionBtnStart,
                              isPausePhaseAction && styles.phaseActionBtnPause,
                              isEndPhaseAction && styles.phaseActionBtnEnd,
                              savingPhase && styles.actionBtnDisabled,
                            ]}
                            disabled={savingPhase}
                            onPress={() => {
                              Keyboard.dismiss();
                              requestSubmitPhaseEvent(nextPhaseStep.type);
                            }}
                          >
                            <View style={styles.phaseActionBtnContent}>
                              {isPlayPhaseAction ? (
                                <MaterialCommunityIcons name="play-circle" size={18} color="#f0fdf4" style={styles.phaseActionBtnStartIcon} />
                              ) : isPausePhaseAction ? (
                                <MaterialCommunityIcons name="pause-circle" size={20} color="#111111" style={styles.phaseActionBtnStartIcon} />
                              ) : isEndPhaseAction ? (
                                <MaterialCommunityIcons name="stop-circle" size={20} color="#fef2f2" style={styles.phaseActionBtnStartIcon} />
                              ) : null}
                              <Text
                                style={[
                                  styles.phaseActionBtnText,
                                  isPlayPhaseAction && styles.phaseActionBtnTextStart,
                                  isPausePhaseAction && styles.phaseActionBtnTextPause,
                                  isEndPhaseAction && styles.phaseActionBtnTextEnd,
                                ]}
                              >
                                {savingPhase
                                  ? 'Salvataggio...'
                                  : nextPhaseStep.type === 'match_end' && liveEvents.some((e) => e.event_type === 'match_end')
                                  ? 'Aggiorna fine partita'
                                  : nextPhaseStep.label}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        )
                      ) : (
                        <Text style={styles.phaseDoneHint}>Tutte le fasi sono state registrate.</Text>
                      )}
                      {nextPhaseStep && nextPhaseStep.type !== 'match_end' ? (
                        <>
                          {nextPhaseStep.type === 'match_start' ? (
                            <>
                              <Text style={[styles.phaseMinuteHint, styles.phaseMinuteHintStart]}>Dai il via alla partita e al cronometro</Text>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : editorModalTab === 'timer' ? (
                    <>
                      <Text style={[styles.editorLabel, styles.phaseMinuteLabelBelow]}>Modifica cronometro</Text>
                      <Text style={styles.phaseMinuteHint}>
                        {showPhaseHeroTimerAdjust
                          ? 'Imposta il timer della partita al minuto che vuoi: inserisci il minuto, poi schiaccia «Fatto» o il pulsante'
                          : ' '}
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
                  ) : editorModalTab === 'shootout' ? (
                    <>
                      <Text style={styles.phaseHint}>Il tiratore è opzionale: puoi inserirlo dopo.</Text>
                      <Text style={styles.editorLabel}>Squadra</Text>
                      <View style={styles.rowChips}>
                        <TouchableOpacity
                          style={[styles.chip, shootoutTeamSide === 'home' && styles.chipActive]}
                          onPress={() => { setShootoutTeamSide('home'); setShootoutPlayerName(''); setShootoutPlayerId(null); }}
                        >
                          <Text style={[styles.chipText, shootoutTeamSide === 'home' && styles.chipTextActive]}>{match.home_team_name}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.chip, shootoutTeamSide === 'away' && styles.chipActive]}
                          onPress={() => { setShootoutTeamSide('away'); setShootoutPlayerName(''); setShootoutPlayerId(null); }}
                        >
                          <Text style={[styles.chipText, shootoutTeamSide === 'away' && styles.chipTextActive]}>{match.away_team_name}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.editorLabel}>Tiratore (opzionale)</Text>
                      <ScrollView ref={shootoutPlayersScrollRef} horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.rowChips}>
                          <TouchableOpacity
                            style={[styles.chip, !shootoutPlayerId && styles.chipActive]}
                            onPress={() => { setShootoutPlayerName(''); setShootoutPlayerId(null); }}
                          >
                            <Text style={[styles.chipText, !shootoutPlayerId && styles.chipTextActive]}>Non scelto</Text>
                          </TouchableOpacity>
                          {shootoutPlayersOrdered.map((p) => (
                            <TouchableOpacity
                              key={`shootout-player-${p.id || p.order}`}
                              style={[styles.chip, Number(shootoutPlayerId) === Number(p.id) && styles.chipActive]}
                              onPress={() => { setShootoutPlayerName(p.name); setShootoutPlayerId(Number(p.id) || null); }}
                            >
                              <Text style={[styles.chipText, Number(shootoutPlayerId) === Number(p.id) && styles.chipTextActive]}>
                                #{p.shirt_number ?? '-'} {p.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                      <View style={styles.shootoutActionsRow}>
                        <TouchableOpacity
                          style={[styles.shootoutActionBtn, savingEvent && styles.actionBtnDisabled]}
                          disabled={savingEvent}
                          onPress={() => submitShootoutEvent('shootout_goal')}
                        >
                          <BonusIcon type="goal" size={26} />
                          <Text style={styles.shootoutActionText}>{savingEvent ? 'Salvo...' : 'Goal'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.shootoutActionBtn, styles.shootoutActionBtnMissed, savingEvent && styles.actionBtnDisabled]}
                          disabled={savingEvent}
                          onPress={() => submitShootoutEvent('shootout_missed')}
                        >
                          <BonusIcon type="goals_conceded" size={26} />
                          <Text style={styles.shootoutActionText}>{savingEvent ? 'Salvo...' : 'No goal'}</Text>
                        </TouchableOpacity>
                      </View>
                      {showShootoutEndMatchAction ? (
                        <TouchableOpacity
                          style={[styles.shootoutEndMatchBtn, savingPhase && styles.actionBtnDisabled]}
                          disabled={savingPhase}
                          onPress={() => submitPhaseEvent('match_end')}
                        >
                          <Text style={styles.shootoutEndMatchText}>{savingPhase ? 'Salvataggio...' : 'Fine partita'}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : editorModalTab === 'editEvents' ? (
                    <>
                      <Text style={styles.phaseHint}>Tocca “Modifica” per eventi partita. Le fasi di gioco si possono solo eliminare.</Text>
                      {liveEventsTimelineSorted.length === 0 ? (
                        <Text style={styles.phaseDoneHint}>Nessun evento registrato.</Text>
                      ) : (
                        liveEventsTimelineSorted.map((ev) => {
                          const editable = EDITABLE_LIVE_EVENT_TYPES.has(ev.event_type);
                          const isEditing = Number(editingLiveEventId) === Number(ev.id);
                          const label = LIVE_EVENT_TYPE_LABELS[ev.event_type] || ev.event_type;
                          const name = ev?.payload?.player_name ? ` - ${ev.payload.player_name}` : '';
                          const editMinuteNum = isEditing && editingLiveEventDraft ? parseTimelineMinuteToInt(editingLiveEventDraft.minute) : NaN;
                          const editStoppageEnd = stoppagePeriodEndForMinute(editMinuteNum, match);
                          const editStoppageLabel = editStoppageEnd != null ? formatMinuteStoppageLabel(editMinuteNum, editStoppageEnd) : '';
                          return (
                            <View key={`edit-ev-${ev.id}`} style={styles.liveEditEventCard}>
                              <View style={styles.liveEditEventHeader}>
                                <View style={styles.liveEditEventInfo}>
                                  <Text style={styles.liveEditEventTitle}>{label}{name}</Text>
                                  <Text style={styles.liveEditEventMeta}>
                                    {ev.minute != null ? `${formatStoredEventMinuteLabel(ev.minute, phaseContextForTimelineEvent(ev, match), match)} · ` : ''}
                                    {ev.team_side === 'home' ? match.home_team_name : ev.team_side === 'away' ? match.away_team_name : 'Fase'}
                                  </Text>
                                </View>
                                <View style={styles.liveEditEventActions}>
                                  {editable ? (
                                    <TouchableOpacity style={styles.liveEditEventActionBtn} onPress={() => beginEditLiveEvent(ev)}>
                                      <Text style={styles.liveEditEventActionText}>Modifica</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                  <TouchableOpacity style={[styles.liveEditEventActionBtn, styles.liveEditEventDeleteBtn]} onPress={() => deleteLiveEvent(ev)}>
                                    <Text style={[styles.liveEditEventActionText, styles.liveEditEventDeleteText]}>Elimina</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                              {isEditing && editingLiveEventDraft ? (
                                <View style={styles.liveEditForm}>
                                  {!isShootoutEventType(editingLiveEventDraft.event_type) ? (
                                    <>
                                      <Text style={styles.editorLabel}>Tipo evento</Text>
                                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                        <View style={styles.rowChips}>
                                          {[
                                            { id: 'goal', label: 'Goal' },
                                            { id: 'own_goal', label: 'Autogol' },
                                            { id: 'yellow_card', label: 'Giallo' },
                                            { id: 'red_card', label: 'Rosso' },
                                            { id: 'penalty_missed', label: 'Rigore sbagliato' },
                                          ].map((et) => (
                                            <TouchableOpacity
                                              key={`edit-type-${et.id}`}
                                              style={[styles.chip, editingLiveEventDraft.event_type === et.id && styles.chipActive]}
                                              onPress={() =>
                                                setEditingLiveEventDraft((d) => ({
                                                  ...d,
                                                  event_type: et.id,
                                                  ...(et.id !== 'goal' ? { assist_player_id: null, assist_player_name: '' } : null),
                                                  ...(!isStoppageEditableEventType(et.id) ? { goal_in_stoppage: false } : null),
                                                }))
                                              }
                                            >
                                              <Text style={[styles.chipText, editingLiveEventDraft.event_type === et.id && styles.chipTextActive]}>{et.label}</Text>
                                            </TouchableOpacity>
                                          ))}
                                        </View>
                                      </ScrollView>

                                      <Text style={styles.editorLabel}>Squadra</Text>
                                      <View style={styles.rowChips}>
                                        {[
                                          { id: 'home', label: match.home_team_name },
                                          { id: 'away', label: match.away_team_name },
                                        ].map((side) => (
                                          <TouchableOpacity
                                            key={`edit-side-${side.id}`}
                                            style={[styles.chip, editingLiveEventDraft.team_side === side.id && styles.chipActive]}
                                            onPress={() =>
                                              setEditingLiveEventDraft((d) => ({
                                                ...d,
                                                team_side: side.id,
                                                player_id: null,
                                                player_name: '',
                                                assist_player_id: null,
                                                assist_player_name: '',
                                              }))
                                            }
                                          >
                                            <Text style={[styles.chipText, editingLiveEventDraft.team_side === side.id && styles.chipTextActive]}>{side.label}</Text>
                                          </TouchableOpacity>
                                        ))}
                                      </View>
                                    </>
                                  ) : null}

                                  {!isShootoutEventType(editingLiveEventDraft.event_type) ? (
                                    <>
                                      <Text style={styles.editorLabel}>Minuto</Text>
                                      <TextInput
                                        style={styles.input}
                                        keyboardType="number-pad"
                                        maxLength={3}
                                        value={editingLiveEventDraft.minute}
                                        onChangeText={(t) => setEditingLiveEventDraft((d) => ({ ...d, minute: t.replace(/\D/g, '').slice(0, 3) }))}
                                      />
                                    </>
                                  ) : null}

                                  {!isShootoutEventType(editingLiveEventDraft.event_type) && isStoppageEditableEventType(editingLiveEventDraft.event_type) && editStoppageEnd != null ? (
                                    <TouchableOpacity
                                      style={styles.stoppageCheckRow}
                                      activeOpacity={0.75}
                                      onPress={() => setEditingLiveEventDraft((d) => ({ ...d, goal_in_stoppage: !d.goal_in_stoppage }))}
                                    >
                                      <Ionicons
                                        name={editingLiveEventDraft.goal_in_stoppage ? 'checkbox' : 'square-outline'}
                                        size={20}
                                        color={editingLiveEventDraft.goal_in_stoppage ? '#667eea' : '#9ca3af'}
                                      />
                                      <View style={styles.stoppageCheckTextWrap}>
                                        <Text style={styles.stoppageCheckLabel}>Evento nel recupero</Text>
                                        <Text style={styles.stoppageCheckHint}>Mostra e ordina come {editStoppageLabel}</Text>
                                      </View>
                                    </TouchableOpacity>
                                  ) : null}

                                  <Text style={styles.editorLabel}>{isShootoutEventType(editingLiveEventDraft.event_type) ? 'Tiratore' : 'Giocatore'}</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    <View style={styles.rowChips}>
                                      {isShootoutEventType(editingLiveEventDraft.event_type) ? (
                                        <TouchableOpacity
                                          style={[styles.chip, !editingLiveEventDraft.player_id && styles.chipActive]}
                                          onPress={() => setEditingLiveEventDraft((d) => ({ ...d, player_id: null, player_name: '' }))}
                                        >
                                          <Text style={[styles.chipText, !editingLiveEventDraft.player_id && styles.chipTextActive]}>Non scelto</Text>
                                        </TouchableOpacity>
                                      ) : null}
                                      {(teamPlayers[editingLiveEventDraft.team_side] || []).map((p) => (
                                        <TouchableOpacity
                                          key={`edit-player-${p.id || p.order}`}
                                          style={[styles.chip, Number(editingLiveEventDraft.player_id) === Number(p.id) && styles.chipActive]}
                                          onPress={() => setEditingLiveEventDraft((d) => ({ ...d, player_id: Number(p.id) || null, player_name: p.name }))}
                                        >
                                          <Text style={[styles.chipText, Number(editingLiveEventDraft.player_id) === Number(p.id) && styles.chipTextActive]}>
                                            #{p.shirt_number ?? '-'} {p.name}
                                          </Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  </ScrollView>

                                  {isShootoutEventType(editingLiveEventDraft.event_type) ? (
                                    <>
                                      <Text style={styles.editorLabel}>Esito</Text>
                                      <View style={styles.shootoutActionsRow}>
                                        <TouchableOpacity
                                          style={[styles.shootoutActionBtn, editingLiveEventDraft.event_type === 'shootout_goal' && styles.shootoutActionBtnActive]}
                                          onPress={() => setEditingLiveEventDraft((d) => ({ ...d, event_type: 'shootout_goal' }))}
                                        >
                                          <Ionicons name="checkmark-circle" size={26} color="#198754" />
                                          <Text style={styles.shootoutActionText}>Goal</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          style={[styles.shootoutActionBtn, styles.shootoutActionBtnMissed, editingLiveEventDraft.event_type === 'shootout_missed' && styles.shootoutActionBtnActive]}
                                          onPress={() => setEditingLiveEventDraft((d) => ({ ...d, event_type: 'shootout_missed' }))}
                                        >
                                          <Ionicons name="close-circle" size={26} color="#e53935" />
                                          <Text style={styles.shootoutActionText}>No goal</Text>
                                        </TouchableOpacity>
                                      </View>
                                    </>
                                  ) : null}

                                  {editingLiveEventDraft.event_type === 'goal' ? (
                                    <>
                                      <Text style={styles.editorLabel}>Assist</Text>
                                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                        <View style={styles.rowChips}>
                                          <TouchableOpacity
                                            style={[styles.chip, !editingLiveEventDraft.assist_player_id && styles.chipActive]}
                                            onPress={() => setEditingLiveEventDraft((d) => ({ ...d, assist_player_id: null, assist_player_name: '' }))}
                                          >
                                            <Text style={[styles.chipText, !editingLiveEventDraft.assist_player_id && styles.chipTextActive]}>Nessuno</Text>
                                          </TouchableOpacity>
                                          {(teamPlayers[editingLiveEventDraft.team_side] || []).map((p) => (
                                            <TouchableOpacity
                                              key={`edit-assist-${p.id || p.order}`}
                                              style={[styles.chip, Number(editingLiveEventDraft.assist_player_id) === Number(p.id) && styles.chipActive]}
                                              onPress={() => setEditingLiveEventDraft((d) => ({ ...d, assist_player_id: Number(p.id) || null, assist_player_name: p.name }))}
                                            >
                                              <Text style={[styles.chipText, Number(editingLiveEventDraft.assist_player_id) === Number(p.id) && styles.chipTextActive]}>
                                                #{p.shirt_number ?? '-'} {p.name}
                                              </Text>
                                            </TouchableOpacity>
                                          ))}
                                        </View>
                                      </ScrollView>
                                    </>
                                  ) : null}

                                  <View style={styles.liveEditFormActions}>
                                    <TouchableOpacity style={styles.secondaryBtnLite} onPress={() => { setEditingLiveEventId(null); setEditingLiveEventDraft(null); }}>
                                      <Text style={styles.secondaryBtnLiteText}>Annulla</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.primaryBtnInline} onPress={saveEditedLiveEvent}>
                                      <Text style={styles.primaryBtnText}>Salva</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              ) : null}
                            </View>
                          );
                        })
                      )}
                    </>
                  ) : (
                    <>
                      <View style={styles.eventWizardTopBar}>
                        <Text style={styles.eventWizardStepText}>Step {eventWizardStep}/{eventWizardLastStep}</Text>
                        <View style={styles.eventWizardNavBtns}>
                          <TouchableOpacity
                            style={[styles.eventWizardNavBtn, eventWizardStep === 1 && styles.eventWizardNavBtnDisabled]}
                            disabled={eventWizardStep === 1}
                            onPress={() => setEventWizardStep((s) => Math.max(1, s - 1))}
                          >
                            <Text style={[styles.eventWizardNavBtnText, eventWizardStep === 1 && styles.eventWizardNavBtnTextDisabled]}>Indietro</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.eventWizardNavBtn,
                              styles.eventWizardNavBtnPrimary,
                              (eventWizardStep >= eventWizardLastStep ||
                                (eventWizardStep === 3 && !eventPlayerId && !canSkipPlayerSelection)) &&
                                styles.eventWizardNavBtnDisabled,
                            ]}
                            disabled={eventWizardStep >= eventWizardLastStep || (eventWizardStep === 3 && !eventPlayerId && !canSkipPlayerSelection)}
                            onPress={() => setEventWizardStep((s) => Math.min(eventWizardLastStep, s + 1))}
                          >
                            <Text style={styles.eventWizardNavBtnPrimaryText}>Avanti</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {eventWizardStep === 1 ? (
                        <>
                          <Text style={styles.editorLabel}>1) Seleziona tipo evento</Text>
                          <View style={styles.eventTypeGrid}>
                            {EVENT_WIZARD_TYPES.map((et) => (
                              <TouchableOpacity
                                key={et.id}
                                style={[styles.eventTypeCard, eventType === et.id && styles.eventTypeCardActive]}
                                onPress={() => {
                                  setEventType(et.id);
                                  if (et.id !== 'goal') {
                                    setEventAssistPlayerName('');
                                    setEventAssistPlayerId(null);
                                  }
                                  if (!isStoppageEditableEventType(et.id)) {
                                    setEventGoalInStoppage(false);
                                  }
                                  setEventWizardStep(2);
                                }}
                              >
                                <BonusIcon type={et.bonusType} size={22} />
                                <Text style={[styles.eventTypeCardText, eventType === et.id && styles.eventTypeCardTextActive]}>{et.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </>
                      ) : null}
                      {eventWizardStep === 2 ? (
                        <>
                          <Text style={styles.editorLabel}>
                            {eventType === 'own_goal'
                              ? "2) Scegli squadra che si e fatta autogoal"
                              : '2) Scegli squadra'}
                          </Text>
                          <View style={styles.eventTeamRow}>
                            <TouchableOpacity
                              style={[styles.eventTeamCard, eventTeamSide === 'home' && styles.eventTeamCardActive]}
                              onPress={() => {
                                setEventTeamSide('home');
                                setEventPlayerName('');
                                setEventPlayerId(null);
                                setEventAssistPlayerName('');
                                setEventAssistPlayerId(null);
                                setEventPlayerSearch('');
                                setEventAssistSearch('');
                                setEventWizardStep(3);
                              }}
                            >
                              <TableTeamLogo logoUrl={match.home_team_logo_url} logoPath={match.home_team_logo_path} size={44} />
                              <Text style={[styles.eventTeamCardText, eventTeamSide === 'home' && styles.eventTeamCardTextActive]}>{match.home_team_name}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.eventTeamCard, eventTeamSide === 'away' && styles.eventTeamCardActive]}
                              onPress={() => {
                                setEventTeamSide('away');
                                setEventPlayerName('');
                                setEventPlayerId(null);
                                setEventAssistPlayerName('');
                                setEventAssistPlayerId(null);
                                setEventPlayerSearch('');
                                setEventAssistSearch('');
                                setEventWizardStep(3);
                              }}
                            >
                              <TableTeamLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} size={44} />
                              <Text style={[styles.eventTeamCardText, eventTeamSide === 'away' && styles.eventTeamCardTextActive]}>{match.away_team_name}</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : null}
                      {eventWizardStep === 3 ? (
                        <>
                          <Text style={styles.editorLabel}>
                            {canSkipPlayerSelection ? '3) Scegli giocatore (opzionale)' : '3) Scegli giocatore'}
                          </Text>
                          <TextInput
                            style={styles.input}
                            value={eventPlayerSearch}
                            onChangeText={setEventPlayerSearch}
                            placeholder="Cerca nome, cognome o numero"
                            autoCapitalize="words"
                            autoCorrect={false}
                          />
                          <View style={styles.eventPlayersList}>
                            {canSkipPlayerSelection ? (
                              <TouchableOpacity
                                style={[styles.eventPlayerRow, !eventPlayerId && styles.eventPlayerRowActive]}
                                onPress={() => {
                                  setEventPlayerName('');
                                  setEventPlayerId(null);
                                  setEventWizardStep(hasAssistWizardStep ? eventAssistWizardStep : eventSummaryWizardStep);
                                }}
                              >
                                <Text style={[styles.eventPlayerName, !eventPlayerId && styles.eventPlayerNameActive]} numberOfLines={1}>
                                  Non specificare ora
                                </Text>
                                <View style={[styles.eventPlayerRoleTag, { backgroundColor: '#94a3b8' }]}>
                                  <Text style={styles.eventPlayerRoleTagText}>-</Text>
                                </View>
                              </TouchableOpacity>
                            ) : null}
                            {filteredEventPlayers.length === 0 ? (
                              <Text style={styles.phaseDoneHint}>Nessun giocatore trovato.</Text>
                            ) : (
                              filteredEventPlayers.map((p) => {
                                const selected = Number(eventPlayerId) === Number(p.id);
                                const role = String(p?.role || '').toUpperCase();
                                const teamBaseHex = eventTeamSide === 'home' ? homeKitBaseHex : awayKitBaseHex;
                                const teamJerseyHex = eventTeamSide === 'home' ? homeJerseyColors.icon : awayJerseyColors.icon;
                                const isGk = role === 'P';
                                const shirtTint = isGk ? lineupGkShirtHex(teamBaseHex) : teamJerseyHex;
                                const shirtHexForNumber = lineupShirtToHex6(shirtTint) || shirtTint;
                                const numberTint = lineupJerseyNumberColorForShirt(shirtHexForNumber);
                                return (
                                  <TouchableOpacity
                                    key={`${eventTeamSide}-wizard-${p.id || p.order}-${p.name}`}
                                    style={[styles.eventPlayerRow, selected && styles.eventPlayerRowActive]}
                                    onPress={() => {
                                      setEventPlayerName(p.name);
                                      setEventPlayerId(Number(p.id) || null);
                                      setEventWizardStep(hasAssistWizardStep ? eventAssistWizardStep : eventSummaryWizardStep);
                                    }}
                                  >
                                    <View style={styles.eventPlayerJerseyBadge}>
                                      <MaterialCommunityIcons name="tshirt-crew" size={42} color={shirtTint} style={styles.eventPlayerJerseyIcon} />
                                      <Text style={[styles.eventPlayerShirtNumber, { color: numberTint }, selected && styles.eventPlayerShirtNumberActive]}>
                                        {p.shirt_number ?? '-'}
                                      </Text>
                                    </View>
                                    <Text style={[styles.eventPlayerName, selected && styles.eventPlayerNameActive]} numberOfLines={1}>
                                      {p.name}
                                    </Text>
                                    <View style={[styles.eventPlayerRoleTag, { backgroundColor: lineupRoleColor(role) }]}>
                                      <Text style={styles.eventPlayerRoleTagText}>{role || '-'}</Text>
                                    </View>
                                  </TouchableOpacity>
                                );
                              })
                            )}
                          </View>
                        </>
                      ) : null}
                      {hasAssistWizardStep && eventWizardStep === eventAssistWizardStep ? (
                        <>
                          <Text style={styles.editorLabel}>4) Scegli assistman (opzionale)</Text>
                          <TextInput
                            style={styles.input}
                            value={eventAssistSearch}
                            onChangeText={setEventAssistSearch}
                            placeholder="Cerca nome, cognome o numero"
                            autoCapitalize="words"
                            autoCorrect={false}
                          />
                          <View style={styles.eventPlayersList}>
                            <TouchableOpacity
                              style={[styles.eventPlayerRow, !eventAssistPlayerId && styles.eventPlayerRowActive]}
                              onPress={() => {
                                setEventAssistPlayerName('');
                                setEventAssistPlayerId(null);
                                setEventWizardStep(eventSummaryWizardStep);
                              }}
                            >
                              <Text style={[styles.eventPlayerName, !eventAssistPlayerId && styles.eventPlayerNameActive]} numberOfLines={1}>
                                Nessun assistman
                              </Text>
                              <View style={[styles.eventPlayerRoleTag, { backgroundColor: '#94a3b8' }]}>
                                <Text style={styles.eventPlayerRoleTagText}>-</Text>
                              </View>
                            </TouchableOpacity>
                            {filteredEventAssistPlayers.map((p) => {
                                const selected = Number(eventAssistPlayerId) === Number(p.id);
                                const role = String(p?.role || '').toUpperCase();
                                const teamBaseHex = eventTeamSide === 'home' ? homeKitBaseHex : awayKitBaseHex;
                                const teamJerseyHex = eventTeamSide === 'home' ? homeJerseyColors.icon : awayJerseyColors.icon;
                                const isGk = role === 'P';
                                const shirtTint = isGk ? lineupGkShirtHex(teamBaseHex) : teamJerseyHex;
                                const shirtHexForNumber = lineupShirtToHex6(shirtTint) || shirtTint;
                                const numberTint = lineupJerseyNumberColorForShirt(shirtHexForNumber);
                                return (
                                  <TouchableOpacity
                                    key={`${eventTeamSide}-assist-wizard-${p.id || p.order}-${p.name}`}
                                    style={[styles.eventPlayerRow, selected && styles.eventPlayerRowActive]}
                                    onPress={() => {
                                      setEventAssistPlayerName(p.name);
                                      setEventAssistPlayerId(Number(p.id) || null);
                                      setEventWizardStep(eventSummaryWizardStep);
                                    }}
                                  >
                                    <View style={styles.eventPlayerJerseyBadge}>
                                      <MaterialCommunityIcons name="tshirt-crew" size={42} color={shirtTint} style={styles.eventPlayerJerseyIcon} />
                                      <Text style={[styles.eventPlayerShirtNumber, { color: numberTint }, selected && styles.eventPlayerShirtNumberActive]}>
                                        {p.shirt_number ?? '-'}
                                      </Text>
                                    </View>
                                    <Text style={[styles.eventPlayerName, selected && styles.eventPlayerNameActive]} numberOfLines={1}>
                                      {p.name}
                                    </Text>
                                    <View style={[styles.eventPlayerRoleTag, { backgroundColor: lineupRoleColor(role) }]}>
                                      <Text style={styles.eventPlayerRoleTagText}>{role || '-'}</Text>
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}
                          </View>
                        </>
                      ) : null}
                      {eventWizardStep === eventSummaryWizardStep ? (
                        <>
                          <Text style={styles.editorLabel}>{eventSummaryWizardStep}) Conferma evento</Text>
                          <View style={styles.eventSummaryCard}>
                            <View style={styles.eventSummaryRow}>
                              <Text style={styles.eventSummaryKey}>Tipo</Text>
                              <Text style={styles.eventSummaryVal}>{selectedEventTypeMeta.label}</Text>
                            </View>
                            <View style={styles.eventSummaryRow}>
                              <Text style={styles.eventSummaryKey}>Squadra</Text>
                              <Text style={styles.eventSummaryVal}>{eventTeamSide === 'home' ? match.home_team_name : match.away_team_name}</Text>
                            </View>
                            <View style={styles.eventSummaryRow}>
                              <Text style={styles.eventSummaryKey}>Giocatore</Text>
                              <Text style={styles.eventSummaryVal}>{selectedEventPlayer?.name || '-'}</Text>
                            </View>
                            {eventType === 'goal' ? (
                              <View style={styles.eventSummaryRow}>
                                <Text style={styles.eventSummaryKey}>Assistman</Text>
                                <Text style={styles.eventSummaryVal}>{selectedEventAssistPlayer?.name || 'Nessuno'}</Text>
                              </View>
                            ) : null}
                            <View style={styles.eventSummaryRow}>
                              <Text style={styles.eventSummaryKey}>Minuto</Text>
                              <Text style={styles.eventSummaryVal}>{(eventMinute || '').trim() || suggestedTimelineMinuteStr}</Text>
                            </View>
                          </View>
                          {eventMinuteStepOpen ? (
                            <View style={styles.eventMinuteStepCard}>
                              <Text style={styles.editorLabel}>Minuto evento</Text>
                              <TextInput
                                style={styles.input}
                                keyboardType="number-pad"
                                maxLength={3}
                                value={eventMinute}
                                onChangeText={(t) => {
                                  const d = t.replace(/\D/g, '').slice(0, 3);
                                  setEventMinute(d);
                                  if (d.trim() === '') {
                                    eventMinuteClearedAtSuggestionRef.current = suggestedTimelineMinuteStr;
                                    setEventMinuteDirty(false);
                                  } else {
                                    eventMinuteClearedAtSuggestionRef.current = null;
                                    setEventMinuteDirty(true);
                                  }
                                }}
                                placeholder={suggestedTimelineMinuteStr}
                              />
                              {isStoppageEditableEventType(eventType) && eventStoppagePeriodEndValue != null ? (
                                <TouchableOpacity
                                  style={styles.stoppageCheckRow}
                                  activeOpacity={0.75}
                                  onPress={() => setEventGoalInStoppage((v) => !v)}
                                >
                                  <Ionicons
                                    name={eventGoalInStoppage ? 'checkbox' : 'square-outline'}
                                    size={20}
                                    color={eventGoalInStoppage ? '#667eea' : '#9ca3af'}
                                  />
                                  <View style={styles.stoppageCheckTextWrap}>
                                    <Text style={styles.stoppageCheckLabel}>Evento nel recupero</Text>
                                    <Text style={styles.stoppageCheckHint}>Mostra e ordina come {eventStoppageLabel}</Text>
                                  </View>
                                </TouchableOpacity>
                              ) : null}
                              <TouchableOpacity style={styles.secondaryBtnLite} onPress={() => setEventMinuteStepOpen(false)}>
                                <Text style={styles.secondaryBtnLiteText}>Chiudi modifica minuto</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                          <View style={styles.eventSummaryActions}>
                            <TouchableOpacity
                              style={[styles.createEventBtn, savingEvent && styles.actionBtnDisabled]}
                              disabled={savingEvent}
                              onPress={submitEvent}
                            >
                              <Text style={styles.createEventBtnText}>{savingEvent ? 'Salvataggio...' : 'Crea evento'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.eventMinuteToggleBtn}
                              onPress={() => setEventMinuteStepOpen((v) => !v)}
                              accessibilityLabel="Apri modifica minuto evento"
                            >
                              <MaterialCommunityIcons name="timer-outline" size={22} color="#111111" />
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : null}
                    </>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
          <Modal
            visible={confirmEndMatchOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmEndMatchOpen(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmContent}>
                <View style={styles.confirmIconWrap}>
                  <Ionicons name="warning" size={40} color="#e53935" />
                </View>
                <Text style={styles.confirmTitle}>Conferma fine partita</Text>
                <Text style={styles.confirmMessage}>
                  La partita è terminata e non servono supplementari o rigori?
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity style={styles.confirmBtnCancel} disabled={savingPhase} onPress={() => setConfirmEndMatchOpen(false)}>
                    <Text style={styles.confirmBtnCancelText}>Annulla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtnAction, styles.confirmBtnDestructive, savingPhase && styles.actionBtnDisabled]}
                    disabled={savingPhase}
                    onPress={() => {
                      setConfirmEndMatchOpen(false);
                      submitPhaseEvent('match_end');
                    }}
                  >
                    <Text style={styles.confirmBtnActionText}>{savingPhase ? 'Salvataggio...' : 'Fine partita'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={!!confirmAdvancePhase}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmAdvancePhase(null)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmContent}>
                <View style={styles.confirmIconWrap}>
                  <Ionicons name="alert-circle" size={40} color="#e53935" />
                </View>
                <Text style={styles.confirmTitle}>Risultato non in parità</Text>
                <Text style={styles.confirmMessage}>
                  {confirmAdvancePhase?.leadingTeamName} è in vantaggio ({confirmAdvancePhase?.score}). Vuoi chiudere la partita o andare avanti comunque?
                </Text>
                <View style={styles.confirmButtonsStack}>
                  <TouchableOpacity style={[styles.confirmBtnAction, styles.confirmBtnFull, savingPhase && styles.actionBtnDisabled]} disabled={savingPhase} onPress={() => {
                    const phaseType = confirmAdvancePhase?.phaseType;
                    setConfirmAdvancePhase(null);
                    if (phaseType) submitPhaseEvent(phaseType);
                  }}>
                    <Text style={styles.confirmBtnActionText}>{savingPhase ? 'Salvataggio...' : (confirmAdvancePhase?.continueLabel || 'Vai avanti')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtnAction, styles.confirmBtnDestructive, styles.confirmBtnFull, savingPhase && styles.actionBtnDisabled]}
                    disabled={savingPhase}
                    onPress={() => {
                      setConfirmAdvancePhase(null);
                      submitPhaseEvent('match_end');
                    }}
                  >
                    <Text style={styles.confirmBtnActionText}>{savingPhase ? 'Salvataggio...' : 'Fine partita'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.confirmBtnCancel, styles.confirmBtnFull]} disabled={savingPhase} onPress={() => setConfirmAdvancePhase(null)}>
                    <Text style={styles.confirmBtnCancelText}>Annulla</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={!!confirmDeleteEvent}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (deletingLiveEventId) return;
              setConfirmDeleteEvent(null);
            }}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmContent}>
                <View style={styles.confirmIconWrap}>
                  <Ionicons name="trash-outline" size={38} color="#e53935" />
                </View>
                <Text style={styles.confirmTitle}>Elimina evento</Text>
                <Text style={styles.confirmMessage}>
                  Vuoi eliminare "{LIVE_EVENT_TYPE_LABELS[confirmDeleteEvent?.event_type] || confirmDeleteEvent?.event_type || 'evento'}"?
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={styles.confirmBtnCancel}
                    onPress={() => setConfirmDeleteEvent(null)}
                    disabled={!!deletingLiveEventId}
                  >
                    <Text style={styles.confirmBtnCancelText}>Annulla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtnAction, styles.confirmBtnDestructive, deletingLiveEventId && styles.actionBtnDisabled]}
                    onPress={submitDeleteLiveEvent}
                    disabled={!!deletingLiveEventId}
                  >
                    <Text style={styles.confirmBtnActionText}>
                      {deletingLiveEventId ? 'Eliminazione...' : 'Elimina'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={!!confirmTimerAdjust}
            transparent
            animationType="fade"
            onRequestClose={cancelHeroTimerAdjust}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmContent}>
                <View style={styles.confirmIconWrap}>
                  <Ionicons name="timer-outline" size={38} color="#eab308" />
                </View>
                <Text style={styles.confirmTitle}>Modifica cronometro</Text>
                <Text style={styles.confirmMessage}>
                  Vuoi portare il minuto da {confirmTimerAdjust?.currentMinute ?? '-'}' a {confirmTimerAdjust?.targetMinute ?? '-'}'?
                  Il tempo continuera da li.
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity style={styles.confirmBtnCancel} onPress={cancelHeroTimerAdjust}>
                    <Text style={styles.confirmBtnCancelText}>Annulla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmBtnAction} onPress={confirmHeroTimerAdjust}>
                    <Text style={styles.confirmBtnActionText}>Conferma</Text>
                  </TouchableOpacity>
                </View>
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
  tabsScroll: { marginTop: 8, maxHeight: 46 },
  tabsScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 4 },
  tabBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
  },
  tabBtnActive: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  tabText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#667eea' },
  content: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#ececec', padding: 12, marginBottom: 12 },
  /** Formazione: un filo più vicina ai bordi schermo, più padding interno così le maglie non “toccano” il bordo card. */
  cardLineup: { marginHorizontal: -4, paddingLeft: 10, paddingRight: 10, paddingVertical: 12 },
  cardLineupCompact: { marginHorizontal: -6, paddingLeft: 6, paddingRight: 6, paddingVertical: 10 },
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
  standingsFoldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginBottom: 2,
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
  twoColCompact: { gap: 3 },
  col: { flex: 1, minWidth: 0 },
  /** Separatore tra i nomi casa / ospiti. */
  lineupColDivider: {
    width: 1,
    backgroundColor: '#d4d4d4',
    alignSelf: 'stretch',
    marginVertical: 4,
  },
  lineupSectionDivider: {
    marginTop: 4,
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
  },
  lineupUnavailableHeader: {
    alignItems: 'center',
    marginBottom: 6,
  },
  lineupUnavailableHeaderLine: {
    width: '100%',
    height: 1,
    backgroundColor: '#d1d5db',
    marginTop: 6,
  },
  lineupUnavailableGrid: {
    marginTop: 2,
  },
  unavailableTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  lineupEditRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineupEditRowWrapCompact: { gap: 0 },
  lineupInlineActionBtn: {
    width: 22,
    height: 22,
    flexShrink: 0,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc3545',
    marginBottom: 8,
  },
  lineupInlineActionBtnEmbedded: {
    marginBottom: 0,
    marginHorizontal: -1,
  },
  lineupInlineActionBtnHome: {
    marginRight: -7,
  },
  lineupInlineActionBtnAway: {
    marginLeft: -7,
  },
  lineupInlineActionBtnAdd: {
    backgroundColor: '#198754',
  },
  lineupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 4,
  },
  lineupRowCompact: { gap: 2, marginBottom: 9 },
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
  jerseyBadgeCompact: {
    width: 34,
    height: 38,
  },
  jerseyIconCompact: {
    top: 0,
  },
  jerseyNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#111827',
    marginTop: -2,
  },
  jerseyNumberCompact: {
    fontSize: 9,
    marginTop: -1,
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
  jerseyRolePillCompact: {
    minWidth: 12,
    height: 11,
    borderRadius: 3,
    paddingHorizontal: 2,
    bottom: -1,
    right: -1,
  },
  jerseyRolePillTextCompact: {
    fontSize: 6,
    lineHeight: 7,
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
  jerseyRolePillTextMutedCompact: {
    fontSize: 6,
    lineHeight: 7,
  },
  lineupNamePressable: { flex: 1, minWidth: 0 },
  lineupNamePressableWithAction: { paddingHorizontal: 2 },
  lineupNamePressableWithActionHome: { alignItems: 'flex-start' },
  lineupNamePressableWithActionAway: { alignItems: 'flex-end' },
  lineupPlayerNameText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#222',
    textAlign: 'center',
  },
  lineupPlayerNameTextWithActionHome: { textAlign: 'left', paddingLeft: 1 },
  lineupPlayerNameTextWithActionAway: { textAlign: 'right', paddingRight: 1 },
  lineupPlayerNameTextCompact: { fontSize: 13 },
  editorLabel: { fontSize: 12, color: '#666', marginBottom: 6, marginTop: 6 },
  matchEndScoreHint: { fontSize: 12, color: '#555', marginTop: 8, lineHeight: 18 },
  phaseMinuteLabelBelow: { marginTop: 16 },
  phaseMinuteHint: { fontSize: 12, color: '#666', marginBottom: 8, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fafafa' },
  stoppageCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  stoppageCheckTextWrap: { flex: 1, minWidth: 0 },
  stoppageCheckLabel: { fontSize: 13, fontWeight: '800', color: '#111827' },
  stoppageCheckHint: { fontSize: 11, color: '#6b7280', marginTop: 1 },
  rowChips: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  eventWizardTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  eventWizardStepText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  eventWizardNavBtns: { flexDirection: 'row', gap: 8 },
  eventWizardNavBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eventWizardNavBtnPrimary: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  eventWizardNavBtnDisabled: { opacity: 0.45 },
  eventWizardNavBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  eventWizardNavBtnTextDisabled: { color: '#94a3b8' },
  eventWizardNavBtnPrimaryText: { color: '#4f46e5', fontSize: 12, fontWeight: '800' },
  eventTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  eventTypeCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  eventTypeCardActive: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  eventTypeCardText: { color: '#334155', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  eventTypeCardTextActive: { color: '#166534' },
  eventTeamRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  eventTeamCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 8,
  },
  eventTeamCardActive: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  eventTeamCardText: { color: '#334155', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  eventTeamCardTextActive: { color: '#166534' },
  eventPlayersList: { gap: 3, marginTop: 1 },
  eventPlayerRow: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventPlayerRowActive: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  eventPlayerJerseyBadge: {
    width: 46,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  eventPlayerJerseyIcon: { position: 'absolute' },
  eventPlayerShirtNumber: { color: '#475569', fontSize: 12, fontWeight: '900', marginTop: -1 },
  eventPlayerShirtNumberActive: { color: '#312e81' },
  eventPlayerRoleTag: {
    minWidth: 28,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  eventPlayerRoleTagText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  eventPlayerName: { flex: 1, color: '#111827', fontSize: 14, fontWeight: '700' },
  eventPlayerNameActive: { color: '#312e81' },
  eventSummaryCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  eventSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  eventSummaryKey: { color: '#475569', fontSize: 12, fontWeight: '700' },
  eventSummaryVal: { color: '#0f172a', fontSize: 13, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  eventMinuteStepCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 10,
    gap: 8,
  },
  eventSummaryActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  createEventBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createEventBtnText: { color: '#f0fdf4', fontSize: 16, fontWeight: '900' },
  eventMinuteToggleBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eab308',
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  chipText: { color: '#333', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: { backgroundColor: '#667eea', borderRadius: 8, alignItems: 'center', paddingVertical: 10, marginTop: 10 },
  primaryBtnInline: { flex: 1, backgroundColor: '#667eea', borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  actionBtnDisabled: { opacity: 0.55 },
  secondaryBtnLite: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
  secondaryBtnLiteText: { color: '#374151', fontWeight: '700' },
  liveEditEventCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#fafafa',
    padding: 10,
    marginBottom: 10,
  },
  liveEditEventHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveEditEventInfo: { flex: 1, minWidth: 0 },
  liveEditEventTitle: { color: '#111827', fontSize: 13, fontWeight: '800' },
  liveEditEventMeta: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  liveEditEventActions: { flexDirection: 'row', gap: 6 },
  liveEditEventActionBtn: { borderRadius: 8, backgroundColor: '#eef2ff', paddingHorizontal: 8, paddingVertical: 6 },
  liveEditEventActionText: { color: '#4f46e5', fontSize: 11, fontWeight: '800' },
  liveEditEventDeleteBtn: { backgroundColor: '#fee2e2' },
  liveEditEventDeleteText: { color: '#b91c1c' },
  liveEditForm: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb', paddingTop: 8 },
  liveEditFormActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
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
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  confirmMessage: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmButtonsStack: { width: '100%', gap: 10 },
  confirmBtnFull: { width: '100%', flex: 0, minHeight: 46, justifyContent: 'center' },
  confirmBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' },
  confirmBtnCancelText: { color: '#333', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  confirmBtnAction: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#667eea' },
  confirmBtnDestructive: { backgroundColor: '#e53935' },
  confirmBtnActionText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
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
  editorTabScroll: { flexGrow: 0, flexShrink: 0, marginBottom: 12 },
  editorTabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  editorTabRowSingle: { flexGrow: 1 },
  editorTabBtn: {
    minHeight: 38,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  editorTabBtnSingle: { flex: 1 },
  editorTabBtnActive: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  editorTabWithIcon: { flexDirection: 'row', alignItems: 'center' },
  editorTabIcon: { marginRight: 4 },
  editorTabBtnText: { color: '#475569', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  editorTabBtnTextActive: { color: '#667eea' },
  phaseHint: { fontSize: 13, color: '#4b5563', lineHeight: 19, marginBottom: 12 },
  phaseDoneHint: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 14, fontStyle: 'italic' },
  phaseActionBtn: {
    backgroundColor: '#667eea',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  phaseActionBtnStart: {
    backgroundColor: '#16a34a',
    borderColor: '#15803d',
    borderWidth: 1,
    minHeight: 74,
    paddingVertical: 14,
  },
  phaseActionBtnPause: {
    backgroundColor: '#facc15',
    borderColor: '#eab308',
    borderWidth: 1,
    minHeight: 74,
    paddingVertical: 14,
  },
  phaseActionBtnEnd: {
    backgroundColor: '#dc2626',
    borderColor: '#b91c1c',
    borderWidth: 1,
    minHeight: 74,
    paddingVertical: 14,
  },
  phaseActionBtnOutline: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#667eea',
  },
  phaseActionBtnOutlineText: { color: '#667eea', fontWeight: '800', fontSize: 15 },
  phaseActionBtnDisabled: { backgroundColor: '#c4c9d4' },
  phaseActionBtnContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  phaseActionBtnStartIcon: { marginRight: 6 },
  phaseActionBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  phaseActionBtnTextStart: { color: '#f0fdf4', fontSize: 20 },
  phaseActionBtnTextPause: { color: '#111111', fontSize: 20 },
  phaseActionBtnTextEnd: { color: '#fef2f2', fontSize: 20 },
  phaseMinuteHintStart: { marginTop: 20, marginBottom: 3 },
  shootoutActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  shootoutActionBtn: {
    flex: 1,
    minHeight: 86,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shootoutActionBtnActive: { borderColor: '#667eea', borderWidth: 2 },
  shootoutActionBtnMissed: { borderColor: '#fee2e2', backgroundColor: '#fff1f2' },
  shootoutActionText: { color: '#111827', fontSize: 14, fontWeight: '800' },
  shootoutEndMatchBtn: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
    paddingVertical: 12,
  },
  shootoutEndMatchText: { color: '#fff', fontSize: 15, fontWeight: '800' },
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
  eventPlayerBlock: { flexShrink: 1, minWidth: 0 },
  eventPlayer: { color: '#333', flexShrink: 1 },
  eventAssist: { color: '#555', fontSize: 10, marginTop: 1, flexShrink: 1 },
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
  knockoutCard: { marginHorizontal: -8, paddingHorizontal: 5, paddingBottom: 6 },
  knockoutTitle: { fontSize: 16, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },
  knockoutHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  knockoutColumnTitle: { flex: 1.2, fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase' },
  knockoutColumnTitleSpacer: { width: 56 },
  knockoutBracketRow: { flexDirection: 'row', alignItems: 'stretch', gap: 0 },
  knockoutSemisCol: { flex: 1.2, gap: 6, alignSelf: 'flex-start', marginRight: -2 },
  knockoutSemiBlock: { flexGrow: 0, flexShrink: 0 },
  knockoutFinalCol: { flex: 1.08, alignSelf: 'stretch', justifyContent: 'center', paddingTop: 20, marginLeft: -2 },
  knockoutFinalWrap: { alignItems: 'center' },
  knockoutSemiLabelRow: { marginBottom: 2 },
  knockoutSemiSmallLabel: { fontSize: 11, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase' },
  knockoutFlowCol: {
    width: 56,
    height: 112,
    marginTop: 46,
    position: 'relative',
  },
  knockoutBracketTopArm: {
    position: 'absolute',
    left: 6,
    top: 10,
    width: 32,
    height: 1,
    backgroundColor: '#d1d5db',
  },
  knockoutBracketBottomArm: {
    position: 'absolute',
    left: 6,
    bottom: 10,
    width: 32,
    height: 1,
    backgroundColor: '#d1d5db',
  },
  knockoutBracketVertical: {
    position: 'absolute',
    left: 38,
    top: 10,
    width: 1,
    height: 92,
    backgroundColor: '#d1d5db',
  },
  knockoutBracketMiddleArm: {
    position: 'absolute',
    left: 38,
    top: 56,
    width: 14,
    height: 1,
    backgroundColor: '#d1d5db',
  },
  knockoutFinalLabelRow: { height: 0, marginBottom: 0 },
  knockoutStageLabel: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 },
  knockoutMatchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' },
  knockoutMatchStackMeasure: { width: '100%' },
  knockoutMatchStack: { gap: 6, width: '100%' },
  knockoutTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 18 },
  knockoutLogoPlaceholder: { width: 30, height: 30 },
  knockoutTeamBox: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 7,
    minHeight: 32,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 6,
    backgroundColor: '#fff',
  },
  knockoutTeamText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: '#111827' },
  knockoutScoreBox: {
    minWidth: 20,
    height: 22,
    paddingHorizontal: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knockoutScoreTextRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  knockoutScoreText: { fontSize: 12, fontWeight: '800', color: '#111827' },
  knockoutShootoutDivider: { width: 1, height: 10, backgroundColor: '#d1d5db' },
  knockoutShootoutScoreText: { fontSize: 8, fontWeight: '800', color: '#9ca3af' },
  knockoutVs: { width: 28, textAlign: 'center', fontSize: 12, fontWeight: '800', color: '#6b7280' },
  knockoutBranchTopLine: {
    marginTop: 10,
    alignSelf: 'center',
    width: '86%',
    height: 1,
    backgroundColor: '#d1d5db',
  },
  knockoutBranchVertical: {
    alignSelf: 'center',
    width: 1,
    height: 14,
    backgroundColor: '#d1d5db',
    marginBottom: 8,
  },
  knockoutSemisRow: { flexDirection: 'row', gap: 10 },
  knockoutSemiCol: { flex: 1, minWidth: 0, alignItems: 'center' },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  tableLogo: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#f7f7f7' },
  tableLogoFallback: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  th: { fontWeight: '700', color: '#555', fontSize: 13 },
  td: { color: '#222', fontSize: 14 },
  tdTeamName: { flex: 1, flexShrink: 1, fontWeight: '600' },
});
