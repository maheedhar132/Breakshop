const bs = require('../../lib/bs-core');

// Answers one question: is this customer already registered?
async function setup({ db }) {
  await db.exec('CREATE TABLE IF NOT EXISTS identifiers (identifier TEXT PRIMARY KEY, customer_id TEXT NOT NULL)');
  return {
    'POST /check': async ({ body }) => {
      const identifier = String((body && body.identifier) || '').trim().toLowerCase();
      if (!identifier) return { status: 400, body: { error: 'identifier is required' } };
      const row = await db.get('SELECT customer_id FROM identifiers WHERE identifier = ?', identifier);
      return { status: 200, body: row ? { exists: true, customerId: row.customer_id } : { exists: false } };
    },
    'POST /register': async ({ body }) => {
      const identifier = String((body && body.identifier) || '').trim().toLowerCase();
      await db.run('INSERT OR REPLACE INTO identifiers (identifier, customer_id) VALUES (?, ?)', identifier, body.customerId);
      return { status: 201, body: { registered: true } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('check-user-id', setup);
