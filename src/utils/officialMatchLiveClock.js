import { parseAppDate } from './dateTime';

/**
 * Logica cronometro hero / lista partite (fasi, minuti, anello secondi).
 * Allineata a `MatchDetailScreen` — etichette supplementari: PT sup / FT sup (come PT/FT regolamentari).
 */

export function formatHHmm(dateStr) {
  const d = parseAppDate(dateStr);
  if (!d || Number.isNaN(d.getTime())) return '--:--';
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

export function formatCountdown(dateStr) {
  const d = parseAppDate(dateStr);
  const target = d ? d.getTime() : NaN;
  const now = Date.now();
  const diff = Math.max(0, (Number.isFinite(target) ? target : now) - now);
  const sec = Math.floor(diff / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (days > 0) return `${days}g ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${seconds}s`;
}

export const LIVE_PHASE_TYPES = new Set([
  'match_start',
  'half_time',
  'second_half_start',
  'second_half_end',
  'extra_first_half_start',
  'extra_half_time',
  'extra_second_half_start',
  'extra_second_half_end',
  'penalties_start',
  'match_end',
]);

export function parseEventCreatedAtMs(ev) {
  if (!ev?.created_at) return null;
  const d = parseAppDate(ev.created_at, { assumeUtcWhenMissingTz: true });
  const t = d ? d.getTime() : NaN;
  return Number.isNaN(t) ? null : t;
}

export function getLastLivePhaseEvent(events) {
  if (!Array.isArray(events)) return null;
  const phase = events.filter((e) => LIVE_PHASE_TYPES.has(e.event_type)).sort((a, b) => a.id - b.id);
  return phase.length ? phase[phase.length - 1] : null;
}

export function heroRunningMinuteStr(minuteStr, elapsedInPhaseSec) {
  const e = Math.max(0, Math.floor(elapsedInPhaseSec));
  return {
    variant: 'running',
    minuteStr,
    ringProgress: (e % 60) / 60,
    showSub: false,
  };
}

export function regulationHalfMinutes(match) {
  const halfMin = Number(match?.regulation_half_minutes);
  return Number.isFinite(halfMin) && halfMin >= 15 ? halfMin : 30;
}

export function extraFirstHalfMinutes(match) {
  const n = Number(match?.extra_first_half_minutes);
  return Number.isFinite(n) && n >= 5 ? n : 15;
}

export function extraSecondHalfMinutes(match) {
  const n = Number(match?.extra_second_half_minutes);
  return Number.isFinite(n) && n >= 5 ? n : 15;
}

/**
 * Minuto cumulativo in un tempo che continua dopo una pausa.
 */
export function continuationCumulativeMinute(elapsedSec, baseEndPrevSegment, segmentRegulationMinutes) {
  const flo = Math.floor(Math.max(0, elapsedSec) / 60);
  const segReg = Number(segmentRegulationMinutes);
  if (!Number.isFinite(segReg) || segReg < 1) {
    return baseEndPrevSegment + 1 + flo;
  }
  if (flo < segReg) {
    return baseEndPrevSegment + 1 + flo;
  }
  const endReg = baseEndPrevSegment + segReg;
  return endReg + (flo - segReg + 1);
}

export function heroRunningAdjustedSegmentSec(events, elapsedOffsetSec = 0) {
  const last = getLastLivePhaseEvent(events);
  if (!last) return { last: null, segSec: 0 };
  const t0 = parseEventCreatedAtMs(last);
  if (t0 == null) return { last, segSec: 0 };
  const raw = Math.max(0, Math.floor((Date.now() - t0) / 1000));
  const segSec = Math.max(0, raw + (Number(elapsedOffsetSec) || 0));
  return { last, segSec };
}

/** Stato hero / riga lista: countdown, PT/FT, supplementari, rigori, fine partita; running = anello secondi. */
export function computeLiveHeroClock(events, match, tick, elapsedOffsetSec = 0) {
  void tick;
  const last = getLastLivePhaseEvent(events);
  const kick = match?.kickoff_at;
  const H = regulationHalfMinutes(match);
  const et1 = extraFirstHalfMinutes(match);
  const et2 = extraSecondHalfMinutes(match);

  if (!last) {
    return {
      variant: 'static',
      main: formatCountdown(kick),
      sub: formatHHmm(kick),
      showSub: true,
    };
  }
  if (last.event_type === 'match_end') {
    return { variant: 'static', main: 'Fine partita', sub: null, showSub: false };
  }
  if (last.event_type === 'penalties_start') {
    return { variant: 'static', main: 'Rigori', sub: null, showSub: false };
  }
  if (last.event_type === 'extra_second_half_end') {
    return { variant: 'static', main: 'FT sup', sub: null, showSub: false };
  }
  if (last.event_type === 'extra_second_half_start') {
    const { segSec } = heroRunningAdjustedSegmentSec(events, elapsedOffsetSec);
    const cum = continuationCumulativeMinute(segSec, 2 * H + et1, et2);
    return heroRunningMinuteStr(`${cum}\u2032`, segSec);
  }
  if (last.event_type === 'extra_half_time') {
    return { variant: 'static', main: 'PT sup', sub: null, showSub: false };
  }
  if (last.event_type === 'extra_first_half_start') {
    const { segSec } = heroRunningAdjustedSegmentSec(events, elapsedOffsetSec);
    const cum = continuationCumulativeMinute(segSec, 2 * H, et1);
    return heroRunningMinuteStr(`${cum}\u2032`, segSec);
  }
  if (last.event_type === 'second_half_end') {
    return { variant: 'static', main: 'FT', sub: null, showSub: false };
  }
  if (last.event_type === 'second_half_start') {
    const { segSec } = heroRunningAdjustedSegmentSec(events, elapsedOffsetSec);
    const cum = continuationCumulativeMinute(segSec, H, H);
    return heroRunningMinuteStr(`${cum}\u2032`, segSec);
  }
  if (last.event_type === 'half_time') {
    return { variant: 'static', main: 'PT', sub: null, showSub: false };
  }
  if (last.event_type === 'match_start') {
    const { segSec } = heroRunningAdjustedSegmentSec(events, elapsedOffsetSec);
    const m = Math.floor(segSec / 60);
    return heroRunningMinuteStr(`${m}\u2032`, segSec);
  }
  return { variant: 'static', main: formatCountdown(kick), sub: formatHHmm(kick), showSub: true };
}

const RUNNING_PHASE_TYPES = new Set(['match_start', 'second_half_start', 'extra_first_half_start', 'extra_second_half_start']);

export function matchListNeedsLiveTick(phaseEvents) {
  const last = getLastLivePhaseEvent(phaseEvents);
  if (!last) return false;
  return RUNNING_PHASE_TYPES.has(last.event_type);
}
