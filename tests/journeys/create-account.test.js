const test = require('node:test');
const assert = require('node:assert');
const { startCluster } = require('../helpers/cluster');

const NEEDED = ['account', 'check-user-id', 'kyc', 'kyc-provider', 'notifications', 'control-center'];
const person = (n) => ({ name: 'Jane ' + n, email: `jane${n}-${Date.now()}@example.com`, phone: '0770' + String(Date.now()).slice(-7), idDoc: 'PASS-' + n });

test('create-account journey', async () => {
  const c = await startCluster({ profile: 'lite', sink: true });
  try {
    await c.waitUp(NEEDED);

    const p = person(1);
    const created = await c.call('account', { method: 'POST', path: '/accounts', body: p });
    assert.strictEqual(created.status, 201);
    assert.match(created.json.customerId, /^C[0-9a-f]{10}$/);

    const again = await c.call('account', { method: 'POST', path: '/accounts', body: p });
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.json.error, 'already_registered');

    await new Promise((r) => setTimeout(r, 300));
    const events = await c.events();
    const firstTrace = created.headers.traceparent.split('-')[1];
    const mine = events.filter((e) => e.correlation_id === firstTrace);
    assert.deepStrictEqual(mine.map((e) => e.step), ['check_user_id', 'identity_verified', 'account_created', 'welcome_sent']);
    const ts = mine.map((e) => Date.parse(e.ts));
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1]);
    const secondTrace = again.headers.traceparent.split('-')[1];
    const dup = events.filter((e) => e.correlation_id === secondTrace);
    assert.deepStrictEqual(dup.map((e) => [e.step, e.outcome]), [['check_user_id', 'business_exception']]);

    await c.call('kyc-provider', { method: 'PUT', path: '/__admin/faults', body: { business: { kycRejectedRate: 1 } } });
    const rejected = await c.call('account', { method: 'POST', path: '/accounts', body: person(2) });
    assert.strictEqual(rejected.status, 422);
    await new Promise((r) => setTimeout(r, 300));
    const rt = rejected.headers.traceparent.split('-')[1];
    const rejEvents = (await c.events()).filter((e) => e.correlation_id === rt);
    assert.strictEqual(rejEvents[rejEvents.length - 1].outcome, 'business_exception');
    assert.strictEqual(rejEvents[rejEvents.length - 1].step, 'identity_verified');
  } finally { await c.stop(); }
});
