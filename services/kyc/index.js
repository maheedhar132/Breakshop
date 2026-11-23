const bs = require('../../lib/bs-core');

// Identity verification. Asks the KYC provider and remembers the answer.
async function setup({ db, client }) {
  await db.exec('CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY, customer_id TEXT, status TEXT, at TEXT)');
  return {
    'POST /verify': async ({ body }) => {
      const res = bs.must(await client.call('kyc-provider', { method: 'POST', path: '/check', body: { idDoc: body && body.idDoc }, timeoutMs: 8000 }));
      const status = res.body && res.body.verified ? 'verified' : 'rejected';
      await db.run('INSERT INTO checks (customer_id, status, at) VALUES (?, ?, ?)', body && body.customerId, status, new Date().toISOString());
      return { status: 200, body: { status } };
    },
    'GET /status/:customerId': async ({ params }) => {
      const row = await db.get('SELECT status, at FROM checks WHERE customer_id = ? ORDER BY id DESC LIMIT 1', params.customerId);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'no check on file' } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('kyc', setup);
