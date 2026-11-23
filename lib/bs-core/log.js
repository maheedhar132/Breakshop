const { currentContext } = require('./trace');

const LEVELS = ['debug', 'info', 'warn', 'error'];
const FILLER = ['cache refreshed', 'heartbeat ok', 'config reloaded', 'connection pool stats', 'gc cycle finished', 'queue depth sampled'];

function defaultStyle() {
  return { format: 'json', levelMix: { debug: 1, info: 6, warn: 2, error: 1 }, volume: 0, noise: 0, sensitive: false };
}

function pickLevel(mix) {
  const total = LEVELS.reduce((s, l) => s + (mix[l] || 0), 0) || 1;
  let r = Math.random() * total;
  for (const l of LEVELS) { r -= mix[l] || 0; if (r <= 0) return l; }
  return 'info';
}

function createLogger(service, opts = {}) {
  const write = opts.write || ((line) => process.stdout.write(line + '\n'));
  let style = defaultStyle();

  function format(level, msg, fields) {
    const ctx = currentContext();
    const ts = new Date().toISOString();
    const useJson = style.format === 'json' || (style.format === 'mixed' && Math.random() < 0.5);
    if (useJson) {
      return JSON.stringify({ ts, level, service, msg, trace_id: ctx ? ctx.traceId : undefined, ...fields });
    }
    const kv = Object.entries(fields || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    return `${ts} ${level.toUpperCase()} ${service} [${ctx ? ctx.traceId : '-'}] ${msg}${kv ? ' ' + kv : ''}`;
  }

  function emit(level, msg, fields) {
    write(format(level, msg, fields));
    for (let i = 0; i < style.volume; i++) {
      write(format(pickLevel(style.levelMix), FILLER[i % FILLER.length], { n: i }));
    }
    if (style.noise > 0 && Math.random() < style.noise) {
      write(format('debug', FILLER[Math.floor(Math.random() * FILLER.length)], { noise: true }));
    }
    if (style.sensitive) {
      write(format('info', 'customer contact updated', { email: 'jane.doe@example.com', card: '4111 1111 1111 1111' }));
    }
  }

  const logger = { setStyle(next) { style = { ...defaultStyle(), ...next }; }, getStyle() { return style; } };
  for (const l of LEVELS) logger[l] = (msg, fields) => emit(l, msg, fields);
  return logger;
}

module.exports = { createLogger, defaultStyle };
