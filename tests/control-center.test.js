const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createService } = require('../lib/bs-core/server');
const { build } = require('../control-center/server');
const { request } = require('./helpers/http');

const TOKEN = 'test-token';

async function fixture() {
  process.env.BS_TOKEN = TOKEN;
  const copies = [];
  const make = async (name) => { const s = createService({ name, port: 0 }); s.log.info = () => {}; await s.start(); copies.push(s); return s; };
  const pay = [await make('payment'), await make('payment')];
  const gw = await make('payment-gateway');
  const calls = [];
  const processes = {
    payment: { copies: 2, instances: pay.map((s, i) => ({ id: `payment-${i}`, port: s.port, status: 'up' })) },
    'payment-gateway': { copies: 1, instances: [{ id: 'payment-gateway-0', port: gw.port, status: 'up' }] },
    orders: { copies: 1, instances: [{ id: 'orders-0', port: 1, status: 'down' }] }
  };
  const sup = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/status' ? { profile: 'full', journeys: ['recharge'], processes } : { ok: true }));
  });
  await new Promise((r) => sup.listen(0, '127.0.0.1', r));
  const cc = build({ token: TOKEN, supervisorUrl: `http://127.0.0.1:${sup.address().port}`, port: 0 });
  cc.log.info = () => {};
  await cc.start();
  const api = (method, p, body, headers = {}) => request(cc.port, { method, path: p, body, headers: { 'x-bs-token': TOKEN, ...headers } });
  const stop = async () => { await cc.stop(); for (const s of copies) await s.stop(); sup.close(); delete process.env.BS_TOKEN; };
  return { api, pay, gw, calls, cc, stop };
}

test('request without the token returns 403; foreign Origin and Host return 403', async () => {
  const f = await fixture();
  try {
    assert.strictEqual((await request(f.cc.port, { path: '/api/state' })).status, 403);
    assert.strictEqual((await f.api('GET', '/api/state', undefined, { origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await f.api('GET', '/api/state', undefined, { host: 'evil.example' })).status, 403);
    assert.strictEqual((await f.api('GET', '/', undefined, { host: 'evil.example' })).status, 403);
    assert.strictEqual((await f.api('GET', '/api/state')).status, 200);
  } finally { await f.stop(); }
});

test('PUT faults on a service with 2 copies changes both; invalid values are rejected', async () => {
  const f = await fixture();
  try {
    const r = await f.api('PUT', '/api/services/payment/faults', { latencyMs: 120 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(f.pay.map((s) => s.faults.get().latencyMs), [120, 120]);
    const bad = await f.api('PUT', '/api/services/payment/faults', { errorRate: 9 });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await f.api('PUT', '/api/services/nope/faults', {})).status, 404);
  } finally { await f.stop(); }
});

test('reset restores defaults and the state shows no history, answer or explanation', async () => {
  const f = await fixture();
  try {
    await f.api('PUT', '/api/services/payment/faults', { latencyMs: 500, errorRate: 0.3 });
    await f.api('POST', '/api/reset');
    assert.deepStrictEqual(f.pay.map((s) => s.faults.get().latencyMs), [0, 0]);
    const state = await f.api('GET', '/api/state');
    assert.strictEqual(state.status, 200);
    assert.doesNotMatch(JSON.stringify(state.json), /history|answer|explain|cause/i);
  } finally { await f.stop(); }
});

test('business rates are routed to the service that owns them', async () => {
  const f = await fixture();
  try {
    await f.api('PUT', '/api/business-outcomes', { paymentDeclinedRate: 0.4 });
    assert.strictEqual(f.gw.faults.get().business.paymentDeclinedRate, 0.4);
  } finally { await f.stop(); }
});

test('business aggregates: 3 payments of 10 and one abandoned of 10', async () => {
  const f = await fixture();
  try {
    const ev = (step, outcome) => ({ type: 'business_event', flow: 'recharge', step, outcome, amount: 10, currency: 'GBP', ts: new Date().toISOString() });
    for (let i = 0; i < 3; i++) await f.api('POST', '/api/events', ev('payment_authorised', 'ok'));
    await f.api('POST', '/api/events', ev('amount_selected', 'abandoned'));
    const b = (await f.api('GET', '/api/business')).json;
    assert.deepStrictEqual(b, { ordersPerMin: 3, revenuePerMin: 30, abandonedOrFailedValue: 10, currency: 'GBP' });
    assert.strictEqual((await f.api('GET', '/api/events/recent')).json.events.length, 4);
  } finally { await f.stop(); }
});

test('randomize response body is exactly {ok: true} and copies are proxied to the supervisor', async () => {
  const f = await fixture();
  try {
    const r = await f.api('POST', '/api/randomize');
    assert.deepStrictEqual(r.json, { ok: true });
    await f.api('PUT', '/api/services/payment/copies', { copies: 3 });
    assert.ok(f.calls.includes('PUT /processes/payment/copies'));
  } finally { await f.stop(); }
});
