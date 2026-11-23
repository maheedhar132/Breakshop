const test = require('node:test');
const assert = require('node:assert');
const { setup } = require('../loadgen/resources');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeOpts = (extra = {}) => ({ cores: 4, totalMB: 8192, probe: async () => 10, directory: { resolve: () => [] }, workerFactory: () => ({ stop() {} }), allocate: () => ({ release() {} }), ...extra });

test('cpuPct 500 and memoryMB 999999 are clamped and reported in applied', async () => {
  const r = await setup({}, fakeOpts());
  const res = await r['POST /stress']({ body: { target: 'host', cpuPct: 500, memoryMB: 999999, durationSec: 99999 } });
  assert.strictEqual(res.status, 202);
  assert.deepStrictEqual(res.body.applied, { target: 'host', cpuPct: 50, memoryMB: 1024, durationSec: 600 });
  await r['POST /panic']({});
});

test('memory is capped at a quarter of the RAM when that is lower', async () => {
  const r = await setup({}, fakeOpts({ totalMB: 2000 }));
  const res = await r['POST /stress']({ body: { cpuPct: 0, memoryMB: 5000, durationSec: 5 } });
  assert.strictEqual(res.body.applied.memoryMB, 500);
  await r['POST /panic']({});
});

test('a stress while the machine is busy returns 409 machine_busy', async () => {
  const r = await setup({}, fakeOpts({ probe: async () => 90 }));
  const res = await r['POST /stress']({ body: { cpuPct: 10, durationSec: 5 } });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'machine_busy');
});

test('panic answers 200 within 500 ms while a real host CPU burn is running', async () => {
  const r = await setup({}, { probe: async () => 0, directory: { resolve: () => [] } });
  const started = await r['POST /stress']({ body: { target: 'host', cpuPct: 12, memoryMB: 0, durationSec: 30 } });
  assert.strictEqual(started.status, 202);
  await sleep(400);
  const t = Date.now();
  const p = await r['POST /panic']({});
  assert.strictEqual(p.status, 200);
  assert.ok(Date.now() - t < 500, `panic took ${Date.now() - t} ms`);
  assert.strictEqual((await r['GET /state']({})).body.active, null);
});

test('after durationSec 1 the state is idle', async () => {
  const r = await setup({}, fakeOpts());
  await r['POST /stress']({ body: { cpuPct: 10, durationSec: 1 } });
  assert.ok((await r['GET /state']({})).body.active);
  await sleep(1300);
  assert.strictEqual((await r['GET /state']({})).body.active, null);
});

test("a service target sets that service's fault fields and resets them afterwards", async () => {
  const calls = [];
  const r = await setup({}, fakeOpts({ applyService: async (name, patch) => { calls.push([name, patch]); } }));
  await r['POST /stress']({ body: { target: 'payment', cpuPct: 20, memoryMB: 100, durationSec: 1 } });
  assert.deepStrictEqual(calls[0], ['payment', { cpuBurnPct: 20, memoryLeakMBPerMin: 200 }]);
  await sleep(1300);
  assert.deepStrictEqual(calls[1], ['payment', { cpuBurnPct: 0, memoryLeakMBPerMin: 0 }]);
});
