const bs = require('../lib/bs-core');

const EVERY_MS = Number(process.env.BS_SCHEDULER_MS || 60000);

// Runs the periodic jobs; every run starts its own trace.
async function setup({ client, log }) {
  async function job(service, path) {
    await bs.runWithContext(bs.newTrace(), async () => {
      try {
        const r = await client.call(service, { method: 'POST', path, body: {} });
        log.info('job finished', { service, path, status: r.status });
      } catch (e) { log.error('job failed', { service, path, error: e.message }); }
    });
  }
  const tick = async () => { await job('billing', '/billing/run'); await job('orders', '/orders/expire-abandoned'); };
  setInterval(tick, EVERY_MS).unref();
  return { 'POST /run-now': async () => { await tick(); return { status: 200, body: { ran: true } }; } };
}

module.exports = { setup };
if (require.main === module) bs.run('scheduler', setup, { db: false });
