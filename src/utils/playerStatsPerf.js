const PREFIX = '[PlayerStatsPerf]';

export const PLAYER_STATS_PERF_ENABLED =
  typeof __DEV__ !== 'undefined' ? __DEV__ : false;

let nextSessionId = 0;

function fmtMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '?';
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function logLine(message, extra) {
  if (!PLAYER_STATS_PERF_ENABLED) return;
  if (extra != null && typeof extra === 'object') {
    console.log(`${PREFIX} ${message}`, extra);
    return;
  }
  if (extra != null) {
    console.log(`${PREFIX} ${message}`, extra);
    return;
  }
  console.log(`${PREFIX} ${message}`);
}

function noopSession() {
  return {
    id: 0,
    mark: () => {},
    time: () => () => {},
    track: async (_label, fn) => fn(),
    end: () => 0,
  };
}

export function createPlayerStatsPerfSession(meta = {}) {
  if (!PLAYER_STATS_PERF_ENABLED) return noopSession();

  const id = nextSessionId + 1;
  nextSessionId = id;
  const startedAt = Date.now();

  logLine(`session#${id} ▶ start`, meta);

  return {
    id,
    mark(label, extra) {
      const elapsed = Date.now() - startedAt;
      logLine(`session#${id} · ${label} @ ${fmtMs(elapsed)}`, extra);
    },
    time(label) {
      const t0 = Date.now();
      return (extra) => {
        const duration = Date.now() - t0;
        logLine(`session#${id} · ${label} took ${fmtMs(duration)}`, extra);
        return duration;
      };
    },
    async track(label, fn) {
      const finish = this.time(label);
      try {
        const result = await fn();
        finish({ ok: true });
        return result;
      } catch (error) {
        finish({ ok: false, error: error?.message || String(error) });
        throw error;
      }
    },
    end(label = 'complete', extra) {
      const total = Date.now() - startedAt;
      logLine(`session#${id} ■ ${label} total ${fmtMs(total)}`, extra);
      return total;
    },
  };
}

export function logPlayerStatsTabSwitch(mainTab, subTab, extra) {
  logLine(`tab → ${mainTab}${subTab ? `/${subTab}` : ''}`, extra);
}

export async function trackPlayerStatsApiCall(label, requestFactory) {
  if (!PLAYER_STATS_PERF_ENABLED) return requestFactory();

  const finish = (() => {
    const t0 = Date.now();
    return (meta) => {
      logLine(`api ${label} ${fmtMs(Date.now() - t0)}`, meta);
    };
  })();

  try {
    const response = await requestFactory();
    finish({ ok: true, status: response?.status });
    return response;
  } catch (error) {
    finish({
      ok: false,
      status: error?.response?.status,
      error: error?.message || String(error),
    });
    throw error;
  }
}
