const test = require('node:test');
const assert = require('node:assert');
const { startCluster } = require('../helpers/cluster');
const { newCustomer, eventsFor, steps, availablePostcode } = require('../helpers/journeys');

const NEEDED = ['account', 'check-user-id', 'kyc', 'kyc-provider', 'notifications', 'plans', 'coverage', 'number-inventory', 'pricing', 'orders', 'payment', 'payment-gateway', 'billing', 'bus', 'provisioning', 'fulfilment', 'porting', 'porting-hub', 'courier', 'control-center'];
const post = (c, service, path, body) => c.call(service, { method: 'POST', path, body });

test('async fulfilment and porting', async (t) => {
  const c = await startCluster({ profile: 'full', sink: true });
  try {
    await c.waitUp(NEEDED);
    const customerId = await newCustomer(c);

    await t.test('a paid SIM order produces sim_dispatched and sim_activated with the order trace id', async () => {
      const r = await post(c, 'orders', '/orders', { type: 'sim', customerId, planId: 'SIM-ESSENTIAL' });
      assert.strictEqual(r.status, 201);
      const ev = await eventsFor(c, r, { minCount: 7, waitMs: 6000 });
      assert.deepStrictEqual(steps(ev).slice(0, 5), ['plan_selected', 'number_reserved', 'identity_verified', 'order_created', 'payment_authorised']);
      assert.ok(steps(ev).includes('sim_dispatched'), steps(ev).join());
      assert.ok(steps(ev).includes('sim_activated'), steps(ev).join());
      const num = r.json.number;
      const inv = await c.call('number-inventory', { path: `/numbers/${encodeURIComponent(num)}` });
      assert.strictEqual(inv.json.status, 'assigned');
      globalThis.__assignedNumber = num;
    });

    await t.test('a paid broadband order produces install_booked and service_activated', async () => {
      const r = await post(c, 'orders', '/orders', { type: 'broadband', customerId, planId: 'BB-FIBRE-100', postcode: await availablePostcode(c) });
      assert.strictEqual(r.status, 201);
      const ev = await eventsFor(c, r, { minCount: 6, waitMs: 6000 });
      assert.ok(steps(ev).includes('install_booked') && steps(ev).includes('service_activated'), steps(ev).join());
    });

    await t.test('port-in emits the port_in steps in order', async () => {
      const r = await post(c, 'porting', '/port-in', { number: '07911 123456', fromOperator: 'OtherTel', customerId });
      assert.strictEqual(r.status, 202);
      const ev = await eventsFor(c, r, { minCount: 4, waitMs: 3000 });
      assert.deepStrictEqual(steps(ev), ['port_requested', 'identity_verified', 'hub_accepted', 'number_ported']);
    });

    await t.test('port-out of an owned number succeeds; an unknown number returns 404 with business_exception', async () => {
      const ok = await post(c, 'porting', '/port-out', { number: '07911 123456', customerId });
      assert.strictEqual(ok.status, 202);
      const bad = await post(c, 'porting', '/port-out', { number: '07000 000000', customerId });
      assert.strictEqual(bad.status, 404);
      const ev = await eventsFor(c, bad, { minCount: 1, waitMs: 2000 });
      assert.deepStrictEqual([ev[0].step, ev[0].outcome], ['port_requested', 'business_exception']);
    });
  } finally { await c.stop(); }
});
