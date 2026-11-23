const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// Takes the money: asks the payment gateway and records the result.
async function setup({ db, client, metrics }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS payments (payment_id TEXT PRIMARY KEY, order_id TEXT, customer_id TEXT,
    amount REAL, currency TEXT, status TEXT, ref TEXT, created_at TEXT)`);
  return {
    'POST /payments': async ({ body }) => {
      const b = body || {};
      if (!(b.amount > 0)) return { status: 400, body: { error: 'amount must be positive' } };
      const res = bs.must(await client.call('payment-gateway', { method: 'POST', path: '/authorise', body: { amount: b.amount, currency: b.currency }, timeoutMs: 8000 }));
      const approved = res.body && res.body.status === 'approved';
      const paymentId = 'P' + crypto.randomBytes(6).toString('hex');
      await db.run('INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?, ?)', paymentId, b.orderId, b.customerId, b.amount, b.currency, approved ? 'authorised' : 'declined', res.body && res.body.ref, new Date().toISOString());
      metrics.inc('payments_total', { status: approved ? 'authorised' : 'declined' });
      if (approved) metrics.inc('payments_value_total', { currency: b.currency }, b.amount);
      return { status: approved ? 200 : 402, body: { status: approved ? 'authorised' : 'declined', paymentId } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('payment', setup);
