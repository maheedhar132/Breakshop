const bs = require('../../lib/bs-core');

// Switches paid orders on. Listens for order.paid on the bus, so it works a little behind the shop.
async function setup({ db, client, events, bus, log }) {
  await db.exec('CREATE TABLE IF NOT EXISTS provisioned (order_id TEXT PRIMARY KEY, type TEXT, customer_id TEXT, at TEXT)');
  const post = async (service, path, body) => bs.must(await client.call(service, { method: 'POST', path, body }));

  bus.subscribe('order.paid', 'provisioning', async (m) => {
    try {
      await bs.sleep(250 + Math.random() * 150);
      if (m.type === 'sim') {
        await post('number-inventory', '/numbers/assign', { number: m.number, customerId: m.customerId });
        await post('billing', '/billing/activate', { customerId: m.customerId, orderId: m.orderId });
        events.emit({ flow: 'buy_sim', step: 'sim_activated', outcome: 'ok', segment: m.segment });
      } else if (m.type === 'broadband') {
        await post('billing', '/billing/activate', { customerId: m.customerId, orderId: m.orderId });
        events.emit({ flow: 'buy_broadband', step: 'service_activated', outcome: 'ok', segment: m.segment });
      }
      await db.run('INSERT OR REPLACE INTO provisioned VALUES (?, ?, ?, ?)', m.orderId, m.type, m.customerId, new Date().toISOString());
      await bus.publish('order.provisioned', { orderId: m.orderId, type: m.type });
    } catch (e) { log.error('provisioning failed', { orderId: m.orderId, error: e.message, stack: e.stack }); }
  });

  return {
    'GET /provisioned': async () => ({ status: 200, body: { count: (await db.get('SELECT count(*) AS n FROM provisioned')).n } })
  };
}

module.exports = { setup };
if (require.main === module) bs.run('provisioning', setup);
