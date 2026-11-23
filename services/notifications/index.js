const bs = require('../../lib/bs-core');

// Sends (pretend) SMS and email messages.
async function setup({ db, metrics }) {
  await db.exec('CREATE TABLE IF NOT EXISTS sent (id INTEGER PRIMARY KEY, customer_id TEXT, channel TEXT, template TEXT, at TEXT)');
  return {
    'POST /notify': async ({ body }) => {
      if (!body || !body.customerId || !body.template) return { status: 400, body: { error: 'customerId and template are required' } };
      await bs.sleep(20 + Math.random() * 40);
      await db.run('INSERT INTO sent (customer_id, channel, template, at) VALUES (?, ?, ?, ?)', body.customerId, body.channel || 'sms', body.template, new Date().toISOString());
      metrics.inc('notifications_sent_total', { channel: body.channel || 'sms', template: body.template });
      return { status: 202, body: { queued: true } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('notifications', setup);
