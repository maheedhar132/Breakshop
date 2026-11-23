const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// Orchestrates every purchase journey. Each step calls the service that owns it and emits one business event.
async function setup({ db, client, events, bus, metrics }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, type TEXT, customer_id TEXT, plan_id TEXT,
    amount REAL, currency TEXT, status TEXT, trace_id TEXT, created_at TEXT, updated_at TEXT)`);
  const call = async (service, req) => bs.must(await client.call(service, req));
  const post = (service, path, body) => call(service, { method: 'POST', path, body });
  const setStatus = (id, status) => db.run('UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?', status, new Date().toISOString(), id);

  function journey(b, flow) {
    const segment = b.segment || 'consumer';
    const em = (step, outcome, amount, currency) => events.emit({ flow, step, outcome, amount, currency, segment });
    return { segment, em };
  }

  async function priceAndStock(b, flow, j) {
    const price = await post('pricing', '/price', { planId: b.planId, promoCode: b.promoCode });
    if (price.status !== 200) return { fail: { status: price.status, body: price.body } };
    const stock = await post('plans', '/stock/reserve', { planId: b.planId });
    if (stock.status === 409) { j.em('plan_selected', 'business_exception', price.body.amount, price.body.currency); return { fail: { status: 409, body: stock.body } }; }
    j.em('plan_selected', 'ok', price.body.amount, price.body.currency);
    return price.body;
  }

  async function createOrder(b, type, price) {
    const orderId = 'O' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();
    const trace = bs.currentContext();
    await db.run('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', orderId, type, b.customerId, b.planId || null, price.amount, price.currency, 'created', trace && trace.traceId, now, now);
    return orderId;
  }

  async function pay(orderId, b, price, j) {
    const r = await post('payment', '/payments', { orderId, customerId: b.customerId, amount: price.amount, currency: price.currency });
    if (r.status === 402) {
      j.em('payment_authorised', 'business_exception', price.amount, price.currency);
      await setStatus(orderId, 'payment_declined');
      metrics.inc('orders_total', { status: 'payment_declined' });
      return false;
    }
    if (r.status !== 200) throw Object.assign(new Error(`payment answered ${r.status}`), { status: 502 });
    j.em('payment_authorised', 'ok', price.amount, price.currency);
    await setStatus(orderId, 'paid');
    metrics.inc('orders_total', { status: 'paid' });
    metrics.inc('revenue_total', { currency: price.currency }, price.amount);
    return true;
  }

  async function buySim(b) {
    const flow = 'buy_sim'; const j = journey(b, flow);
    const price = await priceAndStock(b, flow, j);
    if (price.fail) return price.fail;
    const num = await post('number-inventory', '/numbers/reserve', { customerId: b.customerId });
    if (num.status === 409) { j.em('number_reserved', 'business_exception'); return { status: 409, body: num.body }; }
    j.em('number_reserved', 'ok');
    const release = () => post('number-inventory', '/numbers/release', { number: num.body.number }).catch(() => {});
    const kyc = await post('kyc', '/verify', { customerId: b.customerId, idDoc: b.idDoc || 'on-file' });
    if (kyc.body.status !== 'verified') { await release(); j.em('identity_verified', 'business_exception'); return { status: 422, body: { error: 'identity_rejected' } }; }
    j.em('identity_verified', 'ok');
    const orderId = await createOrder(b, 'sim', price);
    j.em('order_created', 'ok', price.amount, price.currency);
    if (!(await pay(orderId, b, price, j))) { await release(); return { status: 402, body: { error: 'payment_declined', orderId } }; }
    await bus.publish('order.paid', { orderId, type: 'sim', customerId: b.customerId, number: num.body.number, planId: b.planId, segment: j.segment });
    return { status: 201, body: { orderId, status: 'paid', number: num.body.number } };
  }

  async function buyBroadband(b) {
    const flow = 'buy_broadband'; const j = journey(b, flow);
    const price = await priceAndStock(b, flow, j);
    if (price.fail) return price.fail;
    const cov = await call('coverage', { path: `/coverage?postcode=${encodeURIComponent(b.postcode || '')}` });
    if (cov.status !== 200 || !cov.body.available) { j.em('coverage_confirmed', 'business_exception'); return { status: 409, body: { error: 'no_coverage' } }; }
    j.em('coverage_confirmed', 'ok');
    const orderId = await createOrder(b, 'broadband', price);
    j.em('order_created', 'ok', price.amount, price.currency);
    if (!(await pay(orderId, b, price, j))) return { status: 402, body: { error: 'payment_declined', orderId } };
    await bus.publish('order.paid', { orderId, type: 'broadband', customerId: b.customerId, planId: b.planId, postcode: b.postcode, segment: j.segment });
    return { status: 201, body: { orderId, status: 'paid' } };
  }

  async function recharge(b) {
    const flow = 'recharge'; const j = journey(b, flow);
    const price = await post('pricing', '/price', { recharge: Number(b.amount) });
    if (price.status !== 200) return { status: price.status, body: price.body };
    j.em('amount_selected', 'ok', price.body.amount, price.body.currency);
    const orderId = await createOrder(b, 'recharge', price.body);
    if (!(await pay(orderId, b, price.body, j))) return { status: 402, body: { error: 'payment_declined', orderId } };
    await post('billing', '/billing/credit', { customerId: b.customerId, amount: price.body.amount });
    j.em('credit_applied', 'ok', price.body.amount, price.body.currency);
    await client.call('notifications', { method: 'POST', path: '/notify', body: { customerId: b.customerId, channel: 'sms', template: 'recharge' } }).catch(() => {});
    j.em('confirmation_sent', 'ok');
    return { status: 201, body: { orderId, status: 'paid' } };
  }

  const handlers = { sim: buySim, broadband: buyBroadband, recharge };
  return {
    'POST /orders': async ({ body }) => {
      const b = body || {};
      if (!handlers[b.type]) return { status: 400, body: { error: 'type must be sim, broadband or recharge' } };
      if (!b.customerId) return { status: 400, body: { error: 'customerId is required' } };
      return handlers[b.type](b);
    },
    'GET /orders/:id': async ({ params }) => {
      const row = await db.get('SELECT order_id AS orderId, type, customer_id AS customerId, amount, currency, status FROM orders WHERE order_id = ?', params.id);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'not_found' } };
    },
    'POST /orders/expire-abandoned': async () => {
      const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
      const r = await db.run("UPDATE orders SET status = 'expired' WHERE status = 'created' AND created_at < ?", cutoff);
      return { status: 200, body: { expired: r.changes } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('orders', setup);
