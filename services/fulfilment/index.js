const bs = require('../../lib/bs-core');

// Ships SIM cards (via the courier) and books broadband installations. Also listens for order.paid.
async function setup({ db, client, events, bus, log }) {
  await db.exec('CREATE TABLE IF NOT EXISTS fulfilments (order_id TEXT PRIMARY KEY, kind TEXT, reference TEXT, at TEXT)');

  bus.subscribe('order.paid', 'fulfilment', async (m) => {
    try {
      if (m.type === 'sim') {
        const r = bs.must(await client.call('courier', { method: 'POST', path: '/shipments', body: { orderId: m.orderId }, timeoutMs: 8000 }));
        await db.run('INSERT OR REPLACE INTO fulfilments VALUES (?, ?, ?, ?)', m.orderId, 'shipment', r.body.trackingId, new Date().toISOString());
        events.emit({ flow: 'buy_sim', step: 'sim_dispatched', outcome: 'ok', segment: m.segment });
      } else if (m.type === 'broadband') {
        await bs.sleep(60 + Math.random() * 80);
        const slot = new Date(Date.now() + (3 + Math.floor(Math.random() * 10)) * 86400000).toISOString().slice(0, 10);
        await db.run('INSERT OR REPLACE INTO fulfilments VALUES (?, ?, ?, ?)', m.orderId, 'install', slot, new Date().toISOString());
        events.emit({ flow: 'buy_broadband', step: 'install_booked', outcome: 'ok', segment: m.segment });
      }
    } catch (e) { log.error('fulfilment failed', { orderId: m.orderId, error: e.message, stack: e.stack }); }
  });

  return {
    'GET /fulfilments/:orderId': async ({ params }) => {
      const row = await db.get('SELECT order_id AS orderId, kind, reference FROM fulfilments WHERE order_id = ?', params.orderId);
      return row ? { status: 200, body: row } : { status: 404, body: { error: 'not fulfilled yet' } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('fulfilment', setup);
