const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { startCluster, freePort, sleep } = require('./helpers/cluster');
const { request } = require('./helpers/http');

async function freeBlock() {
  for (let i = 0; i < 50; i++) {
    const base = 41000 + Math.floor(Math.random() * 2000) * 10;
    const servers = [];
    try {
      for (let k = 0; k < 10; k++) { const s = net.createServer(); await new Promise((res, rej) => { s.once('error', rej); s.listen(base + k, '127.0.0.1', res); }); servers.push(s); }
      servers.forEach((s) => s.close());
      await sleep(30);
      return base;
    } catch { servers.forEach((s) => s.close()); }
  }
  throw new Error('no free port block');
}

async function fixtureTopology() {
  const a = await freeBlock(); let b = await freeBlock(); while (Math.abs(b - a) < 10) b = await freeBlock();
  return {
    profiles: { full: ['echo-a', 'echo-b'], lite: ['echo-a'] }, journeys: { full: [], lite: [] },
    processes: {
      'echo-a': { kind: 'service', entry: 'tests/fixtures/echo-service.js', port: a, copies: 1 },
      'echo-b': { kind: 'service', entry: 'tests/fixtures/echo-service.js', port: b, copies: 1 }
    }
  };
}

test('directory lists every copy as up; copies 3 uses consecutive ports; reducing stops extras', async () => {
  const topo = await fixtureTopology();
  const c = await startCluster({ topology: topo });
  try {
    let d = await c.waitUp(['echo-a', 'echo-b']);
    assert.strictEqual(d['echo-a'].length, 1);
    await c.post('/processes/echo-a/copies', { copies: 3 }, 'PUT');
    d = await c.waitUp(['echo-a']);
    assert.deepStrictEqual(d['echo-a'].map((i) => i.port), [topo.processes['echo-a'].port, topo.processes['echo-a'].port + 1, topo.processes['echo-a'].port + 2]);
    await c.post('/processes/echo-a/copies', { copies: 1 }, 'PUT');
    d = await c.directory();
    assert.strictEqual(d['echo-a'].length, 1);
    const bad = await c.post('/processes/echo-a/copies', { copies: 20 }, 'PUT');
    assert.strictEqual(bad.status, 400);
  } finally { await c.stop(); }
});

test('a killed copy is restarted and becomes up again', async () => {
  const c = await startCluster({ topology: await fixtureTopology() });
  try {
    await c.waitUp(['echo-a']);
    const pid = (await c.status()).processes['echo-a'].instances[0].pid;
    process.kill(pid);
    let restarted = false;
    for (let i = 0; i < 60 && !restarted; i++) {
      await sleep(200);
      const inst = (await c.status()).processes['echo-a'].instances[0];
      restarted = inst.status === 'up' && inst.pid && inst.pid !== pid;
    }
    assert.ok(restarted, 'copy did not come back with a new pid');
  } finally { await c.stop(); }
});

test('a copy stopped via the API stays down until started', async () => {
  const c = await startCluster({ topology: await fixtureTopology() });
  try {
    await c.waitUp(['echo-a']);
    await c.post('/processes/echo-a/instances/echo-a-0/stop');
    await sleep(1800);
    assert.strictEqual((await c.directory())['echo-a'][0].status, 'stopped');
    await c.post('/processes/echo-a/instances/echo-a-0/start');
    await c.waitUp(['echo-a']);
  } finally { await c.stop(); }
});

test('non-GET without x-bs-token returns 403', async () => {
  const c = await startCluster({ topology: await fixtureTopology() });
  try {
    const r = await request(c.port, { method: 'PUT', path: '/processes/echo-a/copies', body: { copies: 2 } });
    assert.strictEqual(r.status, 403);
  } finally { await c.stop(); }
});

test('starting with the supervisor port occupied exits non-zero and names the port', async () => {
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, '127.0.0.1', r));
  const c = await startCluster({ topology: await fixtureTopology(), supervisorPort: port });
  try {
    for (let i = 0; i < 50 && !c.exited(); i++) await sleep(100);
    assert.ok(c.exited());
    assert.notStrictEqual(c.child.exitCode, 0);
    assert.match(c.output(), new RegExp(`Port ${port} is already in use`));
  } finally { blocker.close(); await c.stop(); }
});

test('a service port taken by something else also fails fast', async () => {
  const topo = await fixtureTopology();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(topo.processes['echo-a'].port, '127.0.0.1', r));
  const c = await startCluster({ topology: topo });
  try {
    for (let i = 0; i < 50 && !c.exited(); i++) await sleep(100);
    assert.notStrictEqual(c.child.exitCode, 0);
    assert.match(c.output(), new RegExp(`Port ${topo.processes['echo-a'].port} is already in use`));
  } finally { blocker.close(); await c.stop(); }
});
