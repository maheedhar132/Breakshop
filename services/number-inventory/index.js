const bs = require('../../lib/bs-core');

// Phone numbers: reserve one, release it, assign it to a customer.
async function setup({ db, faults }) {
  await db.exec('CREATE TABLE IF NOT EXISTS numbers (number TEXT PRIMARY KEY, status TEXT NOT NULL, customer_id TEXT)');
  const count = (await db.get('SELECT count(*) AS n FROM numbers')).n;
  if (count === 0) {
    await db.exec('BEGIN');
    for (let i = 0; i < 2000; i++) await db.run('INSERT OR IGNORE INTO numbers VALUES (?, ?, NULL)', `07700 ${String(900000 + i)}`, 'free');
    await db.exec('COMMIT');
  }
  return {
    'POST /numbers/reserve': async () => {
      if (Math.random() < faults.get().business.numberUnavailableRate) return { status: 409, body: { error: 'number_unavailable' } };
      const row = await db.get("SELECT number FROM numbers WHERE status = 'free' ORDER BY RANDOM() LIMIT 1");
      if (!row) return { status: 409, body: { error: 'number_unavailable' } };
      const r = await db.run("UPDATE numbers SET status = 'reserved' WHERE number = ? AND status = 'free'", row.number);
      return r.changes ? { status: 200, body: { number: row.number } } : { status: 409, body: { error: 'number_unavailable' } };
    },
    'POST /numbers/release': async ({ body }) => {
      await db.run("UPDATE numbers SET status = 'free', customer_id = NULL WHERE number = ?", body.number);
      return { status: 200, body: { released: true } };
    },
    'POST /numbers/assign': async ({ body }) => {
      await db.run("UPDATE numbers SET status = 'assigned', customer_id = ? WHERE number = ?", body.customerId, body.number);
      return { status: 200, body: { assigned: true } };
    },
    'POST /numbers/adopt': async ({ body }) => {
      await db.run("INSERT OR REPLACE INTO numbers VALUES (?, 'assigned', ?)", body.number, body.customerId);
      return { status: 200, body: { adopted: true } };
    },
    'GET /numbers/:number': async ({ params }) => {
      const row = await db.get('SELECT number, status, customer_id AS customerId FROM numbers WHERE number = ?', params.number);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'unknown number' } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('number-inventory', setup);
