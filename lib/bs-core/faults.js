const { defaultStyle } = require('./log');

const MEMORY_CAP_BYTES = 512 * 1024 * 1024;
const TICK_MS = 100;

function defaults() {
  return {
    latencyMs: 0, errorRate: 0, timeoutRate: 0, dependencyFailure: false,
    cpuBurnPct: 0, memoryLeakMBPerMin: 0, slowQuery: false, slowQueryMs: 0,
    business: { paymentDeclinedRate: 0, kycRejectedRate: 0, numberUnavailableRate: 0, outOfStockRate: 0 },
    style: defaultStyle(),
    metrics: { basketValueScale: 1, discountRate: 0, cardinalityExplosion: false }
  };
}

const NUM = (min, max) => ({ min, max });
const RULES = {
  latencyMs: NUM(0, 30000), errorRate: NUM(0, 1), timeoutRate: NUM(0, 1), dependencyFailure: 'bool',
  cpuBurnPct: NUM(0, 50), memoryLeakMBPerMin: NUM(0, 200), slowQuery: 'bool', slowQueryMs: NUM(0, 10000),
  business: {
    paymentDeclinedRate: NUM(0, 1), kycRejectedRate: NUM(0, 1), numberUnavailableRate: NUM(0, 1), outOfStockRate: NUM(0, 1)
  },
  style: {
    format: ['json', 'plain', 'mixed'], levelMix: 'object', volume: NUM(0, 20), noise: NUM(0, 1), sensitive: 'bool'
  },
  metrics: { basketValueScale: NUM(0.1, 10), discountRate: NUM(0, 1), cardinalityExplosion: 'bool' }
};

function check(rule, value, path) {
  if (rule === 'bool') { if (typeof value !== 'boolean') throw new RangeError(`${path} must be boolean`); return; }
  if (rule === 'object') { if (typeof value !== 'object' || value === null) throw new RangeError(`${path} must be an object`); return; }
  if (Array.isArray(rule)) { if (!rule.includes(value)) throw new RangeError(`${path} must be one of ${rule.join(', ')}`); return; }
  if (typeof value !== 'number' || Number.isNaN(value) || value < rule.min || value > rule.max) {
    throw new RangeError(`${path} must be a number between ${rule.min} and ${rule.max}`);
  }
}

function validate(rules, partial, path = '') {
  for (const [k, v] of Object.entries(partial)) {
    const rule = rules[k];
    if (rule === undefined) throw new RangeError(`unknown setting ${path}${k}`);
    if (rule && typeof rule === 'object' && !Array.isArray(rule) && rule.min === undefined) {
      if (typeof v !== 'object' || v === null) throw new RangeError(`${path}${k} must be an object`);
      validate(rule, v, `${path}${k}.`);
    } else check(rule, v, path + k);
  }
}

function merge(target, partial) {
  for (const [k, v] of Object.entries(partial)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) merge(target[k], v);
    else target[k] = v;
  }
}

function createFaults(opts = {}) {
  const allocator = opts.allocator || ((bytes) => Buffer.alloc(bytes, 1));
  let state = defaults();
  let retained = [];
  let retainedBytes = 0;
  let timer = null;

  const faults = {
    get: () => state,
    patch(partial) {
      validate(RULES, partial);
      merge(state, partial);
      if (partial.memoryLeakMBPerMin === 0) { retained = []; retainedBytes = 0; }
      return state;
    },
    reset() {
      state = defaults();
      retained = []; retainedBytes = 0;
      return state;
    },
    decide() {
      if (Math.random() < state.timeoutRate) return 'timeout';
      if (Math.random() < state.errorRate) return 'error';
      return null;
    },
    retainedBytes: () => retainedBytes,
    tick() {
      if (state.cpuBurnPct > 0) {
        const until = Date.now() + state.cpuBurnPct;
        while (Date.now() < until) { /* burn */ }
      }
      if (state.memoryLeakMBPerMin > 0) {
        const chunk = Math.floor(state.memoryLeakMBPerMin * 1024 * 1024 * TICK_MS / 60000);
        if (chunk > 0 && retainedBytes + chunk <= MEMORY_CAP_BYTES) {
          retained.push(allocator(chunk));
          retainedBytes += chunk;
        }
      }
    },
    startBackground() {
      if (timer) return;
      timer = setInterval(() => faults.tick(), TICK_MS);
      timer.unref();
    },
    stopBackground() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
  return faults;
}

module.exports = { createFaults, MEMORY_CAP_BYTES };
