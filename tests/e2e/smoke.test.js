const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { startCluster, sleep } = require('../helpers/cluster');
const { request } = require('../helpers/http');
const { availablePostcode, uniq } = require('../helpers/journeys');

function rssMB(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const kb = Number((out.split('","')[4] || '').replace(/[^0-9]/g, ''));
      return kb / 1024;
    }
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024;
  } catch { return 0; }
}

test('end to end: every journey, copies and failover, abandoned orders', { timeout: 240000 }, async (t) => {
  const c = await startCluster({ profile: 'full' });
  try {
    const names = Object.keys((await c.status()).processes);
    await c.waitUp(names, 60000);
    const dir = await c.directory();
    const ccPort = dir['control-center'][0].port;
    const gwPort = () => dir.gateway[0].port;
    const cc = (method, p, body) => request(ccPort, { method, path: p, body, headers: { 'x-bs-token': c.token() } });
    const gw = (method, p, body) => request(gwPort(), { method, path: '/api/' + p, body });
    const events = async () => (await cc('GET', '/api/events/recent')).json.events;
    const forTrace = async (res) => (await events()).filter((e) => e.correlation_id === res.headers.traceparent.split('-')[1]);

    await t.test('memory: summed resident memory is logged and never fails the test', async () => {
      await sleep(1500);
      const st = await c.status();
      const total = Object.values(st.processes).flatMap((p) => p.instances).reduce((s, i) => s + (i.pid ? rssMB(i.pid) : 0), 0);
      console.log(`memory: ${Object.keys(st.processes).length} processes use about ${Math.round(total)} MB`);
      if (total > 1500) console.warn(`memory: above the 1.5 GB target (${Math.round(total)} MB)`);
    });

    let customerId; let number;
    await t.test('every journey runs through the gateway and keeps one trace id', async () => {
      const u = uniq();
      const created = await gw('POST', 'accounts', { name: 'Smoke ' + u, email: `s${u}@example.com`, phone: '07' + u.slice(-9), idDoc: 'S' + u });
      assert.strictEqual(created.status, 201); customerId = created.json.customerId;
      const sim = await gw('POST', 'orders', { type: 'sim', customerId, planId: 'SIM-PLUS' });
      assert.strictEqual(sim.status, 201); number = sim.json.number;
      const bb = await gw('POST', 'orders', { type: 'broadband', customerId, planId: 'BB-FIBRE-100', postcode: await availablePostcode({ call: async (s, o) => request(dir[s][0].port, o) }) });
      assert.strictEqual(bb.status, 201);
      const rc = await gw('POST', 'orders', { type: 'recharge', customerId, amount: 10 });
      assert.strictEqual(rc.status, 201);
      const pin = await gw('POST', 'port-in', { number: '07911 654321', fromOperator: 'OtherTel', customerId });
      assert.strictEqual(pin.status, 202);
      const pout = await gw('POST', 'port-out', { number: '07911 654321', customerId });
      assert.strictEqual(pout.status, 202);
      await sleep(1500);
      for (const [name, res, min] of [['create', created, 4], ['sim', sim, 7], ['broadband', bb, 6], ['recharge', rc, 4], ['port-in', pin, 4], ['port-out', pout, 3]]) {
        const ev = await forTrace(res);
        assert.ok(ev.length >= min, `${name}: only ${ev.length} events`);
        assert.ok(ev.every((e) => e.correlation_id === ev[0].correlation_id));
      }
      const biz = (await cc('GET', '/api/business')).json;
      assert.ok(biz.revenuePerMin > 0 && biz.ordersPerMin >= 3, JSON.stringify(biz));
    });

    await t.test('three copies of payment: two stopped still serve, all stopped returns 503 and the generator records abandoned', async () => {
      assert.strictEqual((await cc('PUT', '/api/services/payment/copies', { copies: 3 })).status, 200);
      await c.waitUp(['payment'], 30000);
      assert.strictEqual((await c.directory()).payment.length, 3);
      await cc('POST', '/api/services/payment/instances/payment-0/stop');
      await cc('POST', '/api/services/payment/instances/payment-1/stop');
      await sleep(2500);
      for (let i = 0; i < 20; i++) assert.strictEqual((await gw('POST', 'orders', { type: 'recharge', customerId, amount: 5 })).status, 201, `recharge ${i}`);
      await cc('POST', '/api/services/payment/instances/payment-2/stop');
      await sleep(2500);
      const down = await gw('POST', 'orders', { type: 'recharge', customerId, amount: 5 });
      assert.ok([502, 503].includes(down.status), `expected 5xx, got ${down.status}`);
      assert.strictEqual((await cc('PUT', '/api/load', { rps: 5, shape: 'steady', patienceSeconds: 3, mix: { recharge: 1 } })).status, 200);
      await sleep(4000);
      const state = (await cc('GET', '/api/state')).json;
      assert.ok(state.loadStats.errors + state.loadStats.abandoned > 0, JSON.stringify(state.loadStats));
      assert.ok((await events()).some((e) => e.outcome === 'abandoned'));
      await cc('POST', '/api/load/stop');
      await cc('POST', '/api/reset');
      await c.waitUp(['payment'], 30000);
    });

    await t.test('slow payment: orders drop and abandoned value rises', async () => {
      await cc('POST', '/api/reset');
      await sleep(2500);
      const start = () => cc('PUT', '/api/load', { rps: 5, shape: 'steady', patienceSeconds: 2, mix: { recharge: 1 } });
      const count = async (since) => {
        const ev = (await events()).filter((e) => Date.parse(e.ts) >= since);
        return { paid: ev.filter((e) => e.step === 'payment_authorised' && e.outcome === 'ok').length, gone: ev.filter((e) => e.outcome === 'abandoned').length };
      };
      const t0 = Date.now(); await start(); await sleep(8000);
      const healthy = await count(t0);
      await cc('POST', '/api/load/stop'); await sleep(1500);
      await cc('PUT', '/api/services/payment/faults', { latencyMs: 4000 });
      const t1 = Date.now(); await start(); await sleep(8000);
      const slow = await count(t1);
      const biz = (await cc('GET', '/api/business')).json;
      await cc('POST', '/api/load/stop'); await cc('POST', '/api/reset');
      assert.ok(healthy.paid > slow.paid, `healthy ${healthy.paid} vs slow ${slow.paid}`);
      assert.ok(slow.gone > healthy.gone, `abandoned slow ${slow.gone} vs healthy ${healthy.gone}`);
      assert.ok(biz.abandonedOrFailedValue > 0, JSON.stringify(biz));
    });
  } finally { await c.stop(); }
});
