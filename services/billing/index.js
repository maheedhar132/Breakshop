const bs = require('../../lib/bs-core');

// Billing accounts: activation, recharge credit and the nightly invoice run.
async function setup({ db, metrics }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS accounts (customer_id TEXT PRIMARY KEY, balance REAL DEFAULT 0, status TEXT)`);
  await db.exec('CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, customer_id TEXT, amount REAL, at TEXT)');
  return {
    'POST /billing/activate': async ({ body }) => {
      await db.run("INSERT INTO accounts (customer_id, balance, status) VALUES (?, 0, 'active') ON CONFLICT(customer_id) DO UPDATE SET status = 'active'", body.customerId);
      return { status: 200, body: { active: true } };
    },
    'POST /billing/credit': async ({ body }) => {
      if (!(body.amount > 0)) return { status: 400, body: { error: 'amount must be positive' } };
      await db.run("INSERT INTO accounts (customer_id, balance, status) VALUES (?, ?, 'active') ON CONFLICT(customer_id) DO UPDATE SET balance = balance + ?", body.customerId, body.amount, body.amount);
      metrics.inc('credit_applied_total', {}, body.amount);
      const row = await db.get('SELECT balance FROM accounts WHERE customer_id = ?', body.customerId);
      return { status: 200, body: { balance: row.balance } };
    },
    'POST /billing/run': async () => {
      const rows = await db.all("SELECT customer_id, balance FROM accounts WHERE status = 'active' LIMIT 500");
      for (const r of rows) await db.run('INSERT INTO invoices (customer_id, amount, at) VALUES (?, ?, ?)', r.customer_id, 0, new Date().toISOString());
      return { status: 200, body: { invoices: rows.length } };
    },
    'GET /billing/:customerId': async ({ params }) => {
      const row = await db.get('SELECT customer_id AS customerId, balance, status FROM accounts WHERE customer_id = ?', params.customerId);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'no billing account' } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('billing', setup);
