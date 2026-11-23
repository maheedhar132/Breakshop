const test = require('node:test');
const assert = require('node:assert');
const { startCluster } = require('../helpers/cluster');
const { request } = require('../helpers/http');
const { newTrace, formatTraceparent } = require('../../lib/bs-core/trace');

const NEEDED = ['gateway', 'storefront', 'plans', 'account', 'check-user-id', 'kyc', 'kyc-provider', 'notifications', 'control-center'];

test('gateway and storefront', async (t) => {
  const c = await startCluster({ profile: 'full', sink: true });
  try {
    await c.waitUp(NEEDED);
    const gw = (await c.directory()).gateway[0].port;
    const sf = (await c.directory()).storefront[0].port;

    await t.test('gateway forwards and keeps an incoming traceparent', async () => {
      const tp = newTrace();
      const r = await request(gw, { path: '/api/plans?type=sim', headers: { traceparent: formatTraceparent(tp) } });
      assert.strictEqual(r.status, 200);
      assert.ok(r.json.plans.length >= 3);
      assert.strictEqual(r.headers.traceparent.split('-')[1], tp.traceId);
    });

    await t.test('gateway creates a traceparent when none is sent', async () => {
      const r = await request(gw, { path: '/api/plans' });
      assert.match(r.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    await t.test('unknown /api path returns 404', async () => {
      assert.strictEqual((await request(gw, { path: '/api/nothing/here' })).status, 404);
    });

    await t.test('an account can be created through the storefront proxy', async () => {
      const u = Date.now();
      const r = await request(sf, { method: 'POST', path: '/api/accounts', body: { name: 'Web ' + u, email: `w${u}@example.com`, idDoc: 'X' + u } });
      assert.strictEqual(r.status, 201);
    });

    await t.test('each storefront page returns 200 and contains BreakTel', async () => {
      for (const p of ['/', '/account/new', '/sim', '/broadband', '/recharge', '/transfer']) {
        const r = await request(sf, { path: p });
        assert.strictEqual(r.status, 200, p);
        assert.ok(r.text.includes('BreakTel'), p);
      }
    });

    await t.test('app.js contains a traceparent builder', async () => {
      const r = await request(sf, { path: '/static/app.js' });
      assert.match(r.text, /traceparent/);
      assert.match(r.text, /00-\$\{hex\(16\)\}/);
    });
  } finally { await c.stop(); }
});
