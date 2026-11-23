const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// Login and sessions.
async function setup({ db }) {
  await db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, customer_id TEXT, created_at TEXT)');
  return {
    'POST /login': async ({ body }) => {
      if (!body || !body.customerId) return { status: 400, body: { error: 'customerId is required' } };
      const token = crypto.randomBytes(16).toString('hex');
      await db.run('INSERT INTO sessions (token, customer_id, created_at) VALUES (?, ?, ?)', token, body.customerId, new Date().toISOString());
      return { status: 200, body: { session: token } };
    },
    'GET /session': async ({ query }) => {
      const row = await db.get('SELECT customer_id FROM sessions WHERE token = ?', query.token || '');
      return { status: row ? 200 : 401, body: row ? { valid: true, customerId: row.customer_id } : { valid: false } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('auth', setup);
