const bs = require('../../lib/bs-core');

const SEED = [
  ['SIM-ESSENTIAL', 'Essential SIM, 5 GB', 'sim', 7.5, 0],
  ['SIM-PLUS', 'Plus SIM, 30 GB', 'sim', 15, 0],
  ['SIM-UNLIMITED', 'Unlimited SIM', 'sim', 25, 0],
  ['BB-FIBRE-100', 'Fibre 100 Mbps', 'broadband', 29.99, 30],
  ['BB-FIBRE-500', 'Fibre 500 Mbps', 'broadband', 39.99, 30],
  ['BB-FIBRE-1G', 'Fibre 1 Gbps', 'broadband', 54.99, 60]
];

// The product catalogue, and a pretend stock check.
async function setup({ db, faults }) {
  await db.exec('CREATE TABLE IF NOT EXISTS plans (plan_id TEXT PRIMARY KEY, name TEXT, type TEXT, monthly REAL, one_off REAL)');
  for (const row of SEED) await db.run('INSERT OR IGNORE INTO plans VALUES (?, ?, ?, ?, ?)', ...row);
  const shape = 'plan_id AS planId, name, type, monthly, one_off AS oneOff';
  return {
    'GET /plans': async ({ query }) => {
      const rows = query.type ? await db.all(`SELECT ${shape} FROM plans WHERE type = ?`, query.type) : await db.all(`SELECT ${shape} FROM plans`);
      return { status: 200, body: { plans: rows } };
    },
    'GET /plans/:id': async ({ params }) => {
      const row = await db.get(`SELECT ${shape} FROM plans WHERE plan_id = ?`, params.id);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'unknown plan' } };
    },
    'POST /stock/reserve': async () => {
      if (Math.random() < faults.get().business.outOfStockRate) return { status: 409, body: { error: 'out_of_stock' } };
      return { status: 200, body: { reserved: true } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('plans', setup);
