/**
 * Cache in-memory a TTL breve (es. liste partite live).
 * Pensata per ridurre query Supabase con tanti client sullo stesso dato.
 */
function createShortTtlCache({ ttlMs = 6000, maxEntries = 100, producerTimeoutMs = 25000 } = {}) {
  const store = new Map();
  const inflight = new Map();

  function prune(now = Date.now()) {
    for (const [key, entry] of store) {
      if (!entry || entry.expiresAt <= now) store.delete(key);
    }
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey == null) break;
      store.delete(oldestKey);
    }
  }

  function get(key) {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, customTtlMs = ttlMs) {
    const now = Date.now();
    prune(now);
    store.set(key, {
      value,
      expiresAt: now + Math.max(0, Number(customTtlMs) || ttlMs),
    });
  }

  function withTimeout(promise, ms) {
    const timeout = Number(ms);
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.resolve().then(() => promise);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`shortTtlCache producer timeout after ${timeout}ms`));
      }, timeout);
      Promise.resolve()
        .then(() => promise)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
    });
  }

  async function getOrSet(key, producer, customTtlMs = ttlMs) {
    const hit = get(key);
    if (hit !== undefined) return hit;

    if (inflight.has(key)) {
      return inflight.get(key);
    }

    const job = withTimeout(Promise.resolve().then(() => producer()), producerTimeoutMs)
      .then((value) => {
        set(key, value, customTtlMs);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, job);
    return job;
  }

  function del(key) {
    store.delete(key);
    inflight.delete(key);
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  return { get, set, getOrSet, del, clear, ttlMs };
}

module.exports = {
  createShortTtlCache,
};
