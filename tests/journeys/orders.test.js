const test = require('node:test');
const assert = require('node:assert');
const { startCluster } = require('../helpers/cluster');
const { newCustomer, eventsFor, setFaults, resetFaults, steps, availablePostcode } = require('../helpers/journeys');

const NEEDED = ['account', 'check-user-id', 'kyc', 'kyc-provider', 'notifications', 'plans', 'coverage', 'number-inventory', 'pricing', 'orders', 'payment', 'payment-gateway', 'billing', 'bus', 'control-center'];
const order = (c, body) => c.call('orders', { method: 'POST', path: '/orders', body });

test('order journeys', async (t) => {
  const c = await startCluster({ profile: 'full', sink: true });
  try {
    await c.waitUp(NEEDED);
    const customerId = await newCustomer(c);

    await t.test('buy sim returns 201 and emits plan_selected to payment_authorised in order', async () => {
      const r = await order(c, { type: 'sim', customerId, planId: 'SIM-PLUS' });
      assert.strictEqual(r.status, 201);
      const ev = await eventsFor(c, r, { minCount: 5, waitMs: 3000 });
      assert.deepStrictEqual(steps(ev).slice(0, 5), ['plan_selected', 'number_reserved', 'identity_verified', 'order_created', 'payment_authorised']);
      assert.ok(ev.every((e) => e.correlation_id === ev[0].correlation_id));
      assert.strictEqual(ev[4].amount, 15);
      assert.strictEqual(ev[4].currency, 'GBP');
    });

    await t.test('paymentDeclinedRate 1 returns 402 and a business_exception at payment_authorised', async () => {
      await setFaults(c, 'payment-gateway', { business: { paymentDeclinedRate: 1 } });
      const r = await order(c, { type: 'sim', customerId, planId: 'SIM-PLUS' });
      assert.strictEqual(r.status, 402);
      const ev = await eventsFor(c, r, { minCount: 5, waitMs: 2000 });
      const last = ev[ev.length - 1];
      assert.deepStrictEqual([last.step, last.outcome], ['payment_authorised', 'business_exception']);
      await resetFaults(c, 'payment-gateway');
    });

    await t.test('numberUnavailableRate 1 returns 409', async () => {
      await setFaults(c, 'number-inventory', { business: { numberUnavailableRate: 1 } });
      const r = await order(c, { type: 'sim', customerId, planId: 'SIM-PLUS' });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.error, 'number_unavailable');
      await resetFaults(c, 'number-inventory');
    });

    await t.test('recharge credits billing and emits the recharge steps', async () => {
      const r = await order(c, { type: 'recharge', customerId, amount: 10 });
      assert.strictEqual(r.status, 201);
      const ev = await eventsFor(c, r, { minCount: 4, waitMs: 2000 });
      assert.deepStrictEqual(steps(ev), ['amount_selected', 'payment_authorised', 'credit_applied', 'confirmation_sent']);
      const bill = await c.call('billing', { path: `/billing/${customerId}` });
      assert.ok(bill.json.balance >= 10);
    });

    await t.test('basketValueScale 2 doubles the priced amount', async () => {
      await setFaults(c, 'pricing', { metrics: { basketValueScale: 2 } });
      const r = await c.call('pricing', { method: 'POST', path: '/price', body: { recharge: 10 } });
      assert.strictEqual(r.json.amount, 20);
      await resetFaults(c, 'pricing');
    });

    await t.test('outOfStockRate 1 on broadband returns 409 with business_exception', async () => {
      await setFaults(c, 'plans', { business: { outOfStockRate: 1 } });
      const r = await order(c, { type: 'broadband', customerId, planId: 'BB-FIBRE-100', postcode: await availablePostcode(c) });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.json.error, 'out_of_stock');
      const ev = await eventsFor(c, r, { minCount: 1, waitMs: 2000 });
      assert.strictEqual(ev[ev.length - 1].outcome, 'business_exception');
      await resetFaults(c, 'plans');
    });

    await t.test('broadband succeeds on a covered postcode', async () => {
      const r = await order(c, { type: 'broadband', customerId, planId: 'BB-FIBRE-500', postcode: await availablePostcode(c) });
      assert.strictEqual(r.status, 201);
      const ev = await eventsFor(c, r, { minCount: 4, waitMs: 3000 });
      assert.deepStrictEqual(steps(ev).slice(0, 4), ['plan_selected', 'coverage_confirmed', 'order_created', 'payment_authorised']);
    });
  } finally { await c.stop(); }
});
