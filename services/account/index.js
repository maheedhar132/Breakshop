const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// Creates customer accounts. The "already registered" check is the check-user-id service's job.
async function setup({ db, client, events }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS customers (customer_id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT,
    id_doc TEXT, segment TEXT, created_at TEXT)`);
  const flow = 'create_account';
  return {
    'POST /accounts': async ({ body }) => {
      const b = body || {};
      const identifier = (b.email || b.phone || '').trim();
      if (!identifier || !b.name) return { status: 400, body: { error: 'name and email or phone are required' } };
      const segment = b.segment || 'consumer';

      const found = bs.must(await client.call('check-user-id', { method: 'POST', path: '/check', body: { identifier } })).body;
      if (found.exists) {
        events.emit({ flow, step: 'check_user_id', outcome: 'business_exception', segment });
        return { status: 409, body: { error: 'already_registered', customerId: found.customerId } };
      }
      events.emit({ flow, step: 'check_user_id', outcome: 'ok', segment });

      const customerId = 'C' + crypto.randomBytes(5).toString('hex');
      const kyc = bs.must(await client.call('kyc', { method: 'POST', path: '/verify', body: { customerId, idDoc: b.idDoc } })).body;
      if (kyc.status !== 'verified') {
        events.emit({ flow, step: 'identity_verified', outcome: 'business_exception', segment });
        return { status: 422, body: { error: 'identity_rejected' } };
      }
      events.emit({ flow, step: 'identity_verified', outcome: 'ok', segment });

      await db.run('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?)', customerId, b.name, b.email || null, b.phone || null, b.idDoc || null, segment, new Date().toISOString());
      bs.must(await client.call('check-user-id', { method: 'POST', path: '/register', body: { identifier, customerId } }));
      events.emit({ flow, step: 'account_created', outcome: 'ok', segment });

      await client.call('notifications', { method: 'POST', path: '/notify', body: { customerId, channel: 'sms', template: 'welcome' } }).catch(() => {});
      events.emit({ flow, step: 'welcome_sent', outcome: 'ok', segment });
      return { status: 201, body: { customerId } };
    },
    'GET /accounts/:id': async ({ params }) => {
      const row = await db.get('SELECT customer_id AS customerId, name, email, phone, segment FROM customers WHERE customer_id = ?', params.id);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'not_found' } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('account', setup);
