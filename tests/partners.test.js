const test = require('node:test');
const assert = require('node:assert');
const { request } = require('./helpers/http');

async function withPartner(mod, fn) {
  const svc = require(mod).build(); svc.port = 0; svc.log.info = () => {};
  await svc.start();
  try { await fn(svc); } finally { await svc.stop(); }
}

test('payment-gateway declines everything when paymentDeclinedRate is 1', () => withPartner('../partners/payment-gateway', async (s) => {
  assert.strictEqual((await request(s.port, { method: 'POST', path: '/authorise', body: { amount: 5 } })).json.status, 'approved');
  s.faults.patch({ business: { paymentDeclinedRate: 1 } });
  assert.strictEqual((await request(s.port, { method: 'POST', path: '/authorise', body: { amount: 5 } })).json.status, 'declined');
}));

test('kyc-provider rejects at kycRejectedRate 1', () => withPartner('../partners/kyc-provider', async (s) => {
  assert.strictEqual((await request(s.port, { method: 'POST', path: '/check', body: {} })).json.verified, true);
  s.faults.patch({ business: { kycRejectedRate: 1 } });
  assert.strictEqual((await request(s.port, { method: 'POST', path: '/check', body: {} })).json.verified, false);
}));

test('courier returns a trackingId and porting-hub accepts', async () => {
  await withPartner('../partners/courier', async (s) => {
    assert.match((await request(s.port, { method: 'POST', path: '/shipments', body: {} })).json.trackingId, /^TRK-/);
  });
  await withPartner('../partners/porting-hub', async (s) => {
    assert.strictEqual((await request(s.port, { method: 'POST', path: '/port', body: {} })).json.status, 'accepted');
  });
});
