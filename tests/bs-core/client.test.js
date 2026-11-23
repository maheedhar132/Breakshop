const test = require('node:test');
const assert = require('node:assert');
const { createService } = require('../../lib/bs-core/server');
const { createDirectory } = require('../../lib/bs-core/directory');
const { createClient, ServiceUnavailableError, DependencyError } = require('../../lib/bs-core/client');
const { createFaults } = require('../../lib/bs-core/faults');
const { newTrace, runWithContext } = require('../../lib/bs-core/trace');

async function copy(id, routes) {
  const s = createService({ name: 'target', port: 0, routes: routes || { 'GET /who': async ({ trace }) => ({ status: 200, body: { id, traceId: trace.traceId } }) } });
  s.log.info = () => {}; s.log.error = () => {};
  await s.start();
  return s;
}
const dirOf = (insts) => { const d = createDirectory({ supervisorUrl: 'http://127.0.0.1:1' }); d.set({ target: insts }); return d; };
const inst = (s, status = 'up') => ({ id: String(s.port), host: '127.0.0.1', port: s.port, status });

test('round robin alternates between two copies', async () => {
  const a = await copy('a'); const b = await copy('b');
  const c = createClient({ directory: dirOf([inst(a), inst(b)]) });
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await c.call('target', { path: '/who' })).body.id);
  assert.deepStrictEqual(ids, ['a', 'b', 'a', 'b']);
  await a.stop(); await b.stop();
});

test('a dead copy is skipped and the request succeeds on the other', async () => {
  const a = await copy('a'); const b = await copy('b');
  const dead = inst(a); await a.stop();
  const c = createClient({ directory: dirOf([dead, inst(b)]) });
  for (let i = 0; i < 4; i++) assert.strictEqual((await c.call('target', { path: '/who' })).body.id, 'b');
  await b.stop();
});

test('all copies down rejects with ServiceUnavailableError status 503 quickly', async () => {
  const a = await copy('a'); const dead = inst(a); await a.stop();
  const c = createClient({ directory: dirOf([dead]), timeoutMs: 1000 });
  const t = Date.now();
  await assert.rejects(c.call('target', { path: '/who' }), (e) => e instanceof ServiceUnavailableError && e.status === 503);
  assert.ok(Date.now() - t < 1500);
  await assert.rejects(createClient({ directory: dirOf([]) }).call('target', { path: '/who' }), ServiceUnavailableError);
});

test("traceparent keeps the caller's traceId", async () => {
  const a = await copy('a');
  const c = createClient({ directory: dirOf([inst(a)]) });
  const t = newTrace();
  const r = await runWithContext(t, () => c.call('target', { path: '/who' }));
  assert.strictEqual(r.body.traceId, t.traceId);
  await a.stop();
});

test('dependencyFailure rejects without any network call', async () => {
  const faults = createFaults(); faults.patch({ dependencyFailure: true });
  const c = createClient({ directory: dirOf([{ id: 'x', host: '127.0.0.1', port: 1, status: 'up' }]), faults });
  await assert.rejects(c.call('target', { path: '/who' }), DependencyError);
});

test('a 5xx from one copy retries on the other', async () => {
  const bad = await copy('bad', { 'GET /who': async () => ({ status: 503, body: { error: 'x' } }) });
  const good = await copy('good');
  const c = createClient({ directory: dirOf([inst(bad), inst(good)]) });
  for (let i = 0; i < 4; i++) assert.strictEqual((await c.call('target', { path: '/who' })).body.id, 'good');
  await bad.stop(); await good.stop();
});
