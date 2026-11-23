const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('../loadgen/users');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A pretend gateway: records calls, answers like the real one.
function fake(handler) {
  const calls = []; const events = [];
  const client = { call: async (service, req) => { calls.push(req); return handler(req); } };
  const ctx = { client, events: { emit: (e) => events.push(e) }, log: { info() {}, error() {} }, metrics: { inc() {} } };
  return { ctx, calls, events };
}
const ok = (req) => {
  if (req.method === 'GET') return { status: 200, body: { plans: [{ planId: 'SIM-PLUS', type: 'sim', monthly: 15, oneOff: 0 }, { planId: 'BB-FIBRE-100', type: 'broadband', monthly: 30, oneOff: 30 }] } };
  if (req.path === '/api/accounts') return { status: 201, body: { customerId: 'C' + Math.random().toString(16).slice(2, 12) } };
  return { status: 201, body: { orderId: 'O1', number: '07700 900001' } };
};

test('mix with only recharge issues only recharge orders (plus account seeding)', async () => {
  const f = fake(ok);
  const r = await setup(f.ctx);
  assert.strictEqual((await r['PUT /config']({ body: { rps: 20, shape: 'steady', mix: { recharge: 1 } } })).status, 200);
  await sleep(1000);
  await r['POST /stop']({});
  const orders = f.calls.filter((c) => c.path === '/api/orders');
  assert.ok(orders.length > 5);
  assert.ok(orders.every((c) => c.body.type === 'recharge'));
  assert.ok(f.calls.every((c) => ['/api/orders', '/api/accounts'].includes(c.path)));
});

test('steady 20 rps issues about 20 calls per second (within 25%)', async () => {
  const f = fake(ok);
  const r = await setup(f.ctx);
  await r['PUT /config']({ body: { rps: 20, shape: 'steady', mix: { recharge: 1 } } });
  await sleep(2000);
  await r['POST /stop']({});
  const n = f.calls.filter((c) => c.path === '/api/orders').length;
  assert.ok(n >= 30 && n <= 50, `orders=${n}`);
});

test('a gateway that answers 503 produces abandoned events and the generator keeps running', async () => {
  const f = fake(() => { const e = new Error('no healthy copies'); e.status = 503; throw e; });
  const r = await setup(f.ctx);
  await r['PUT /config']({ body: { rps: 20, shape: 'steady', mix: { recharge: 1, buy_sim: 1 } } });
  await sleep(700);
  const first = (await r['GET /stats']({})).body.started;
  await sleep(700);
  const stats = (await r['GET /stats']({})).body;
  await r['POST /stop']({});
  assert.ok(stats.started > first, 'generator stalled');
  assert.ok(f.events.length > 0 && f.events.every((e) => e.outcome === 'abandoned'));
  assert.ok(stats.abandoned > 0);
});

test('a slow gateway beyond patience produces abandoned with elapsedMs set', async () => {
  const f = fake(async (req) => { if (req.path === '/api/orders') { await sleep(Math.min(req.timeoutMs + 50, 3000)); throw new Error('timeout'); } return ok(req); });
  const r = await setup(f.ctx);
  await r['PUT /config']({ body: { rps: 5, shape: 'steady', patienceSeconds: 1, mix: { recharge: 1 } } });
  await sleep(2500);
  await r['POST /stop']({});
  const ab = f.events.filter((e) => e.outcome === 'abandoned');
  assert.ok(ab.length > 0);
  assert.ok(ab.every((e) => e.elapsedMs >= 400 && e.elapsedMs <= 2000 && e.step === 'amount_selected'));
});

test('invalid configuration is rejected', async () => {
  const r = await setup(fake(ok).ctx);
  assert.strictEqual((await r['PUT /config']({ body: { rps: 500 } })).status, 400);
  assert.strictEqual((await r['PUT /config']({ body: { shape: 'zigzag' } })).status, 400);
  assert.strictEqual((await r['PUT /config']({ body: { mix: { nonsense: 1 } } })).status, 400);
});
