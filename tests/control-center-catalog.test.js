const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const bs = require('../lib/bs-core');
const { build } = require('../control-center/server');
const { SERVICES, JOURNEYS } = require('../control-center/catalog');
const { request } = require('./helpers/http');

const topo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'topology.json'), 'utf8'));

test('every service, partner and the bus in topology.json is described in the catalog', () => {
  for (const [name, p] of Object.entries(topo.processes)) {
    if (['service', 'partner', 'bus'].includes(p.kind)) assert.ok(SERVICES[name], `${name} is missing from catalog.js`);
  }
  for (const name of Object.keys(SERVICES)) assert.ok(topo.processes[name], `${name} is not a real process`);
});

test('every call in the catalog points at a described service, and layers are 0 to 5', () => {
  for (const [name, s] of Object.entries(SERVICES)) {
    assert.ok(Number.isInteger(s.layer) && s.layer >= 0 && s.layer <= 5, name);
    assert.ok(['edge', 'core', 'async', 'partner'].includes(s.role), name);
    assert.ok(s.does && s.does.length > 10, `${name} needs a description`);
    for (const target of s.calls) assert.ok(SERVICES[target], `${name} calls unknown ${target}`);
  }
});

test('journeys match the business flows and only list real services', () => {
  assert.deepStrictEqual(Object.keys(JOURNEYS).sort(), Object.keys(bs.FLOWS).sort());
  for (const [name, j] of Object.entries(JOURNEYS)) for (const s of j.services) assert.ok(SERVICES[s], `${name} lists unknown ${s}`);
});

test('/api/info needs the token and returns the structure, journey steps and folders', async () => {
  const cc = build({ token: 'tok', supervisorUrl: 'http://127.0.0.1:1', port: 0 });
  cc.log.info = () => {};
  await cc.start();
  try {
    assert.strictEqual((await request(cc.port, { path: '/api/info' })).status, 403);
    const r = await request(cc.port, { path: '/api/info', headers: { 'x-bs-token': 'tok' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.journeys.buy_sim.steps.length, 7);
    assert.ok(r.json.services.payment.calls.includes('payment-gateway'));
    assert.strictEqual(typeof r.json.logDir, 'string');
    assert.strictEqual(typeof r.json.dataDir, 'string');
    assert.doesNotMatch(JSON.stringify(r.json), /history|answer|explain|cause/i);
  } finally { await cc.stop(); }
});
