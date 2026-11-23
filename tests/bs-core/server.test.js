const test = require('node:test');
const assert = require('node:assert');
const { createService, sleep } = require('../../lib/bs-core/server');
const { newTrace, formatTraceparent } = require('../../lib/bs-core/trace');
const { request } = require('../helpers/http');

async function make(routes = {}, extra = {}) {
  const svc = createService({ name: 'demo', port: 0, routes, ...extra });
  svc.log.setStyle({ format: 'json' });
  svc.log.info = () => {}; svc.log.error = () => {};
  await svc.start();
  return svc;
}

test('healthz readyz version answer 200', async () => {
  const s = await make();
  for (const p of ['/healthz', '/readyz', '/version']) assert.strictEqual((await request(s.port, { path: p })).status, 200);
  await s.stop();
});

test('path params and query reach the handler', async () => {
  const s = await make({ 'GET /plans/:id': async ({ params, query }) => ({ status: 200, body: { id: params.id, type: query.type } }) });
  const r = await request(s.port, { path: '/plans/42?type=sim' });
  assert.deepStrictEqual(r.json, { id: '42', type: 'sim' });
  await s.stop();
});

test('incoming traceparent is reused and echoed; missing one is created', async () => {
  const s = await make({ 'GET /x': async () => ({ status: 200, body: { ok: true } }) });
  const t = newTrace();
  const r = await request(s.port, { path: '/x', headers: { traceparent: formatTraceparent(t) } });
  assert.strictEqual(r.headers.traceparent, formatTraceparent(t));
  const r2 = await request(s.port, { path: '/x' });
  assert.match(r2.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  await s.stop();
});

test('PUT /__admin/faults latencyMs 200 slows a route by at least 200 ms', async () => {
  const s = await make({ 'GET /x': async () => ({ status: 200, body: {} }) });
  await request(s.port, { method: 'PUT', path: '/__admin/faults', body: { latencyMs: 200 } });
  const t = Date.now();
  await request(s.port, { path: '/x' });
  assert.ok(Date.now() - t >= 195);
  const bad = await request(s.port, { method: 'PUT', path: '/__admin/faults', body: { errorRate: 5 } });
  assert.strictEqual(bad.status, 400);
  await s.stop();
});

test('errorRate 1 returns 500 with a JSON error naming the service', async () => {
  const s = await make({ 'GET /x': async () => ({ status: 200, body: {} }) });
  await request(s.port, { method: 'PUT', path: '/__admin/faults', body: { errorRate: 1 } });
  const r = await request(s.port, { path: '/x' });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.json.service, 'demo');
  await s.stop();
});

test('Origin evil.example and Host rebind.example on an admin route return 403', async () => {
  const s = await make();
  const a = await request(s.port, { path: '/__admin/faults', headers: { origin: 'https://evil.example' } });
  assert.strictEqual(a.status, 403);
  const b = await request(s.port, { path: '/__admin/faults', headers: { host: 'rebind.example' } });
  assert.strictEqual(b.status, 403);
  assert.strictEqual((await request(s.port, { path: '/__admin/faults', headers: { origin: 'http://localhost:2605' } })).status, 200);
  await s.stop();
});

test('BS_TOKEN is required on admin routes when set', async () => {
  process.env.BS_TOKEN = 'secret';
  const s = await make();
  assert.strictEqual((await request(s.port, { path: '/__admin/faults' })).status, 403);
  assert.strictEqual((await request(s.port, { path: '/__admin/faults', headers: { 'x-bs-token': 'secret' } })).status, 200);
  delete process.env.BS_TOKEN;
  await s.stop();
});

test('capacity 1 with 3 slow concurrent calls queues them', async () => {
  const s = await make({ 'GET /slow': async () => { await sleep(100); return { status: 200, body: {} }; } }, { capacity: 1 });
  const t = Date.now();
  await Promise.all([1, 2, 3].map(() => request(s.port, { path: '/slow' })));
  assert.ok(Date.now() - t >= 290, `took ${Date.now() - t}`);
  await s.stop();
});

test('queue overflow returns 503', async () => {
  const s = await make({ 'GET /slow': async () => { await sleep(150); return { status: 200, body: {} }; } }, { capacity: 1, maxQueue: 1 });
  const rs = await Promise.all([1, 2, 3, 4].map(() => request(s.port, { path: '/slow' })));
  assert.ok(rs.some((r) => r.status === 503));
  assert.ok(rs.some((r) => r.status === 200));
  await s.stop();
});

test('/metrics lists the route count', async () => {
  const s = await make({ 'GET /x': async () => ({ status: 200, body: {} }) });
  await request(s.port, { path: '/x' });
  const m = await request(s.port, { path: '/metrics' });
  assert.match(m.text, /http_requests_total\{service="demo",route="GET \/x",status="200"\} 1/);
  await s.stop();
});

test('wildcard routes match the rest of the path', async () => {
  const s = await make({ 'ANY /api/*': async ({ params }) => ({ status: 200, body: { rest: params['*'] } }) });
  const r = await request(s.port, { method: 'POST', path: '/api/orders/1', body: { a: 1 } });
  assert.strictEqual(r.json.rest, 'orders/1');
  await s.stop();
});
