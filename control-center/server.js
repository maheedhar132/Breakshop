const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const bs = require('../lib/bs-core');
const { SERVICES, JOURNEYS } = require('./catalog');

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const NOT_FAULTABLE = new Set(['control-center', 'bus', 'loadgen-users', 'loadgen-resources', 'scheduler']);
const OWNERS = { paymentDeclinedRate: 'payment-gateway', kycRejectedRate: 'kyc-provider', numberUnavailableRate: 'number-inventory', outOfStockRate: 'plans' };
const FIVE_MIN = 5 * 60000;

const hostOf = (v) => { try { return new URL(String(v).includes('://') ? v : `http://${v}`).hostname; } catch { return ''; } };
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => Math.round(a + Math.random() * (b - a));

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) deepMerge((target[k] = target[k] || {}), v); else target[k] = v;
  }
  return target;
}

function httpJson(method, url, body, token, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { 'x-bs-token': token || '' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let parsed; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = undefined; } resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function build(opts = {}) {
  const token = opts.token !== undefined ? opts.token : (process.env.BS_TOKEN || '');
  const supervisor = opts.supervisorUrl || process.env.BS_SUPERVISOR_URL || 'http://127.0.0.1:5550';
  const svc = bs.createService({ name: 'control-center', port: opts.port });
  const desired = {};
  const events = [];
  let cache = { at: 0, value: null };

  const status = async () => {
    if (cache.value && Date.now() - cache.at < 700) return cache.value;
    const r = await httpJson('GET', `${supervisor}/status`, undefined, token);
    cache = { at: Date.now(), value: r.body };
    return r.body;
  };
  const up = async (name) => (((await status()).processes[name] || {}).instances || []).filter((i) => i.status === 'up');
  const direct = async (name, method, p, body) => {
    const first = (await up(name))[0];
    if (!first) return null;
    return httpJson(method, `http://127.0.0.1:${first.port}${p}`, body, token).catch(() => null);
  };
  const toAll = async (name, method, p, body) => Promise.all((await up(name)).map((i) => httpJson(method, `http://127.0.0.1:${i.port}${p}`, body, token).catch(() => ({ status: 0 }))));

  async function applyFaults(name, patch) {
    const results = await toAll(name, 'PUT', '/__admin/faults', patch);
    const bad = results.find((r) => r.status === 400);
    if (bad) return { status: 400, body: bad.body };
    deepMerge((desired[name] = desired[name] || {}), patch);
    return { status: 200, body: { ok: true } };
  }

  const guard = (handler, { needToken = true } = {}) => async (c) => {
    const h = c.req.headers;
    const ok = LOCAL.has(hostOf(h.host || '')) && (!h.origin || LOCAL.has(hostOf(h.origin))) && (!needToken || !token || h['x-bs-token'] === token);
    return ok ? handler(c) : { status: 403, body: { error: 'forbidden' } };
  };

  const pubDir = path.join(__dirname, 'public');
  const file = (f) => fs.readFileSync(path.join(pubDir, f), 'utf8');
  const TYPES = { 'app.js': 'application/javascript', 'map.js': 'application/javascript', 'guide.js': 'application/javascript', 'style.css': 'text/css' };

  function business() {
    const cutoff = Date.now() - 60000;
    const recent = events.filter((e) => Date.parse(e.ts) >= cutoff);
    const paid = recent.filter((e) => e.step === 'payment_authorised' && e.outcome === 'ok');
    const lost = recent.filter((e) => e.outcome === 'abandoned' || (e.outcome === 'business_exception' && e.step === 'payment_authorised'));
    const sum = (list) => Math.round(list.reduce((s, e) => s + (e.amount || 0), 0) * 100) / 100;
    const currency = (events[events.length - 1] || {}).currency || process.env.BS_CURRENCY || 'GBP';
    return { ordersPerMin: paid.length, revenuePerMin: sum(paid), abandonedOrFailedValue: sum(lost), currency };
  }

  async function state() {
    const s = await status();
    const services = {};
    await Promise.all(Object.entries(s.processes).map(async ([name, p]) => {
      const f = NOT_FAULTABLE.has(name) ? null : await direct(name, 'GET', '/__admin/faults');
      services[name] = { copies: p.copies, instances: p.instances, faults: f && f.status === 200 ? f.body : null };
    }));
    const [load, stats, stress] = await Promise.all([direct('loadgen-users', 'GET', '/config'), direct('loadgen-users', 'GET', '/stats'), direct('loadgen-resources', 'GET', '/state')]);
    return { profile: s.profile, journeys: s.journeys, services, load: load && load.body, loadStats: stats && stats.body, stress: stress && stress.body };
  }

  async function randomize() {
    const s = await status();
    const name = pick(Object.keys(s.processes).filter((n) => !NOT_FAULTABLE.has(n)));
    const patch = pick([() => ({ latencyMs: rand(300, 3000) }), () => ({ errorRate: rand(10, 50) / 100 }), () => ({ cpuBurnPct: rand(10, 40) }),
      () => ({ memoryLeakMBPerMin: rand(20, 100) }), () => ({ slowQuery: true, slowQueryMs: rand(400, 2000) }), () => ({ timeoutRate: rand(5, 25) / 100 })])();
    await applyFaults(name, patch);
    return { status: 200, body: { ok: true } };
  }

  async function reset() {
    for (const k of Object.keys(desired)) delete desired[k];
    const s = await status();
    for (const [name, p] of Object.entries(s.processes)) {
      if (!NOT_FAULTABLE.has(name)) await toAll(name, 'POST', '/__admin/reset');
      if (p.copies !== 1) await httpJson('PUT', `${supervisor}/processes/${name}/copies`, { copies: 1 }, token).catch(() => {});
      for (const i of p.instances) if (i.status === 'stopped') await httpJson('POST', `${supervisor}/processes/${name}/instances/${i.id}/start`, undefined, token).catch(() => {});
    }
    await direct('loadgen-users', 'POST', '/stop'); await direct('loadgen-resources', 'POST', '/panic');
    cache = { at: 0, value: null };
    return { status: 200, body: { ok: true } };
  }

  svc.addRoutes({
    'GET /': guard(async () => ({ status: 200, body: file('index.html').replace('__BS_TOKEN__', token), headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }), { needToken: false }),
    'GET /static/:f': guard(async ({ params }) => (TYPES[params.f] ? { status: 200, body: file(params.f), headers: { 'content-type': TYPES[params.f], 'cache-control': 'no-store' } } : { status: 404, body: 'not found' }), { needToken: false }),
    'GET /api/state': guard(async () => ({ status: 200, body: await state() })),
    'GET /api/info': guard(async () => ({
      status: 200,
      body: {
        logDir: process.env.BS_LOG_DIR || path.join(os.homedir(), '.breakshop', 'logs'),
        dataDir: bs.defaultDataDir(),
        services: SERVICES,
        journeys: Object.fromEntries(Object.entries(JOURNEYS).map(([k, v]) => [k, { ...v, steps: bs.FLOWS[k] }]))
      }
    })),
    'GET /api/business': guard(async () => ({ status: 200, body: business() })),
    'PUT /api/services/:name/faults': guard(async ({ params, body }) => ((await status()).processes[params.name] ? applyFaults(params.name, body || {}) : { status: 404, body: { error: 'unknown service' } })),
    'PUT /api/services/:name/copies': guard(async ({ params, body }) => {
      const r = await httpJson('PUT', `${supervisor}/processes/${params.name}/copies`, body, token);
      cache = { at: 0, value: null };
      return { status: r.status, body: r.body };
    }),
    'POST /api/services/:name/instances/:id/:action': guard(async ({ params }) => {
      const r = await httpJson('POST', `${supervisor}/processes/${params.name}/instances/${params.id}/${params.action}`, undefined, token);
      cache = { at: 0, value: null };
      return { status: r.status, body: r.body };
    }),
    'PUT /api/load': guard(async ({ body }) => { const r = await direct('loadgen-users', 'PUT', '/config', body); return r ? { status: r.status, body: r.body } : { status: 503, body: { error: 'load generator is not running' } }; }),
    'POST /api/load/stop': guard(async () => { await direct('loadgen-users', 'POST', '/stop'); return { status: 200, body: { ok: true } }; }),
    'POST /api/stress': guard(async ({ body }) => { const r = await direct('loadgen-resources', 'POST', '/stress', body); return r ? { status: r.status, body: r.body } : { status: 503, body: { error: 'stress generator is not running' } }; }),
    'POST /api/panic': guard(async () => { await direct('loadgen-resources', 'POST', '/panic'); return { status: 200, body: { ok: true } }; }),
    'PUT /api/logs': guard(async ({ body }) => { const names = Object.keys((await status()).processes).filter((n) => !NOT_FAULTABLE.has(n)); for (const n of names) await applyFaults(n, { style: body || {} }); return { status: 200, body: { ok: true } }; }),
    'PUT /api/metrics': guard(async ({ body }) => { const names = Object.keys((await status()).processes).filter((n) => !NOT_FAULTABLE.has(n)); for (const n of names) await applyFaults(n, { metrics: body || {} }); return { status: 200, body: { ok: true } }; }),
    'PUT /api/business-outcomes': guard(async ({ body }) => {
      for (const [k, v] of Object.entries(body || {})) if (OWNERS[k]) { const r = await applyFaults(OWNERS[k], { business: { [k]: v } }); if (r.status !== 200) return r; }
      return { status: 200, body: { ok: true } };
    }),
    'POST /api/randomize': guard(randomize),
    'POST /api/reset': guard(reset),
    'POST /api/events': guard(async ({ body }) => {
      events.push(body);
      const cutoff = Date.now() - FIVE_MIN;
      while (events.length && (Date.parse(events[0].ts) < cutoff || events.length > 50000)) events.shift();
      return { status: 202, body: { ok: true } };
    }),
    'GET /api/events/recent': guard(async () => ({ status: 200, body: { events } }))
  });

  const timer = setInterval(() => { for (const name of Object.keys(desired)) toAll(name, 'PUT', '/__admin/faults', desired[name]).catch(() => {}); }, 2000);
  timer.unref();
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
