const http = require('node:http');
const { newTrace, parseTraceparent, formatTraceparent, runWithContext } = require('./trace');
const { createLogger, defaultStyle } = require('./log');
const { createFaults } = require('./faults');
const { createMetrics } = require('./metrics');

const VERSION = require('../../package.json').version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function allowedHosts() {
  const extra = (process.env.BS_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...LOCAL, ...extra]);
}

function hostnameOf(value) {
  try { return new URL(value.includes('://') ? value : `http://${value}`).hostname; } catch { return ''; }
}

function compile(key) {
  const space = key.indexOf(' ');
  const method = key.slice(0, space);
  const names = [];
  const parts = key.slice(space + 1).split('/').map((seg) => {
    if (seg === '*') { names.push('*'); return '(.*)'; }
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { key, method, names, re: new RegExp('^' + parts.join('/') + '$') };
}

function createLimiter(max, maxQueue) {
  let active = 0;
  const queue = [];
  return {
    acquire() {
      if (active < max) { active++; return Promise.resolve(true); }
      if (queue.length >= maxQueue) return Promise.resolve(false);
      return new Promise((res) => queue.push(res));
    },
    release() {
      const next = queue.shift();
      if (next) next(true); else active--;
    }
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 1048576) chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', () => resolve(undefined));
  });
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isObj = body !== undefined && typeof body === 'object';
  const payload = body === undefined ? '' : (isObj ? JSON.stringify(body) : String(body));
  res.writeHead(status, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(payload);
}

function createService(def) {
  const name = def.name;
  const instance = process.env.BS_INSTANCE || name;
  const host = process.env.BS_HOST || '127.0.0.1';
  const log = createLogger(name);
  const faults = createFaults();
  const metrics = createMetrics(name);
  const limiter = createLimiter(def.capacity || Number(process.env.BS_CAPACITY) || 50, def.maxQueue || 200);
  const hosts = allowedHosts();
  const routes = Object.entries(def.routes || {}).map(([k, h]) => ({ ...compile(k), handler: h }));
  let server = null;

  const service = { name, instance, log, faults, metrics, port: def.port || Number(process.env.BS_PORT) || 0 };
  service.addRoutes = (map) => { for (const [k, h] of Object.entries(map)) routes.push({ ...compile(k), handler: h }); };

  function adminGuard(req) {
    const origin = req.headers.origin;
    if (origin && !hosts.has(hostnameOf(origin))) return false;
    if (!hosts.has(hostnameOf(req.headers.host || ''))) return false;
    const token = process.env.BS_TOKEN;
    return !token || req.headers['x-bs-token'] === token;
  }

  async function builtin(req, res, path) {
    if (path === '/healthz') return send(res, 200, { status: 'ok', service: name, instance }), true;
    if (path === '/version') return send(res, 200, { service: name, instance, version: VERSION }), true;
    if (path === '/metrics') return send(res, 200, metrics.render(), { 'content-type': 'text/plain; version=0.0.4' }), true;
    if (path === '/readyz') {
      const ok = def.ready ? await def.ready() : true;
      return send(res, ok ? 200 : 503, { ready: !!ok }), true;
    }
    if (path.startsWith('/__admin/')) {
      if (!adminGuard(req)) return send(res, 403, { error: 'forbidden' }), true;
      if (req.method === 'GET' && path === '/__admin/faults') return send(res, 200, faults.get()), true;
      if (req.method === 'PUT' && path === '/__admin/faults') {
        const body = await readBody(req);
        try { faults.patch(body || {}); } catch (e) { return send(res, 400, { error: e.message }), true; }
        log.setStyle(faults.get().style);
        return send(res, 200, faults.get()), true;
      }
      if (req.method === 'POST' && path === '/__admin/reset') {
        faults.reset(); log.setStyle(defaultStyle());
        return send(res, 200, faults.get()), true;
      }
      return send(res, 404, { error: 'not_found' }), true;
    }
    return false;
  }

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const ctx = parseTraceparent(req.headers.traceparent) || newTrace();
    res.setHeader('traceparent', formatTraceparent(ctx));
    await runWithContext(ctx, async () => {
      if (await builtin(req, res, path)) return;
      const route = routes.find((r) => (r.method === 'ANY' || r.method === req.method) && r.re.test(path));
      if (!route) return send(res, 404, { error: 'not_found', path });
      const label = faults.get().metrics.cardinalityExplosion ? `${route.key}#${Math.random().toString(36).slice(2, 8)}` : route.key;
      const admitted = await limiter.acquire();
      if (!admitted) { metrics.observe(label, 503, Date.now() - started); return send(res, 503, { error: 'overloaded', service: name }); }
      let status = 500;
      try {
        const f = faults.get();
        if (f.latencyMs > 0) await sleep(f.latencyMs);
        const verdict = faults.decide();
        if (verdict === 'timeout') {
          await new Promise((r) => { const t = setTimeout(r, 30000); res.on('close', () => { clearTimeout(t); r(); }); });
          status = 504; return send(res, 504, { error: 'timeout', service: name });
        }
        if (verdict === 'error') {
          const err = new Error(`${name}: simulated failure while handling ${req.method} ${path}`);
          log.error('request failed', { error: err.message, stack: err.stack });
          status = 500; return send(res, 500, { error: 'injected_error', service: name, message: err.message });
        }
        const m = route.re.exec(path);
        const params = {};
        route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        const body = await readBody(req);
        const out = await route.handler({ req, params, query: Object.fromEntries(url.searchParams), body, trace: ctx, faults, log, name });
        status = out.status || 200;
        send(res, status, out.body, out.headers);
      } catch (e) {
        status = e.status >= 400 && e.status < 600 ? e.status : 500;
        log.error('unhandled error', { error: e.message, stack: e.stack });
        send(res, status, { error: status === 503 ? 'dependency_unavailable' : 'internal_error', service: name, message: e.message });
      } finally {
        limiter.release();
        metrics.observe(label, status, Date.now() - started);
        log.info('request', { method: req.method, path, status, ms: Date.now() - started });
      }
    });
  }

  service.start = () => new Promise((resolve, reject) => {
    server = http.createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, { error: e.message })); });
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${service.port} is already in use (${name})`) : e));
    server.listen(service.port, host, () => {
      service.port = server.address().port;
      faults.startBackground();
      resolve();
    });
  });

  service.stop = () => new Promise((resolve) => {
    faults.stopBackground();
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });

  return service;
}

async function main(service, extraStop) {
  try { await service.start(); } catch (e) { console.error(e.message); process.exit(1); }
  const stop = async () => { try { if (extraStop) await extraStop(); await service.stop(); } finally { process.exit(0); } };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createService, main, sleep };
