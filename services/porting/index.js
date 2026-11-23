const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// Moves numbers between operators: SIM transfer in and out.
async function setup({ db, client, events }) {
  await db.exec('CREATE TABLE IF NOT EXISTS ports (port_id TEXT PRIMARY KEY, direction TEXT, number TEXT, customer_id TEXT, status TEXT, at TEXT)');
  const post = async (service, path, body) => bs.must(await client.call(service, { method: 'POST', path, body, timeoutMs: 8000 }));
  const record = (direction, b, status) => {
    const portId = 'PT' + crypto.randomBytes(5).toString('hex');
    return db.run('INSERT INTO ports VALUES (?, ?, ?, ?, ?, ?)', portId, direction, b.number, b.customerId, status, new Date().toISOString()).then(() => portId);
  };

  return {
    'POST /port-in': async ({ body }) => {
      const b = body || {}; const flow = 'port_in'; const em = (step, outcome) => events.emit({ flow, step, outcome, segment: b.segment || 'consumer' });
      if (!b.number || !b.customerId) return { status: 400, body: { error: 'number and customerId are required' } };
      em('port_requested', 'ok');
      const kyc = await post('kyc', '/verify', { customerId: b.customerId, idDoc: b.idDoc || 'on-file' });
      if (kyc.body.status !== 'verified') { em('identity_verified', 'business_exception'); return { status: 422, body: { error: 'identity_rejected' } }; }
      em('identity_verified', 'ok');
      await post('porting-hub', '/port', { number: b.number, direction: 'in' });
      em('hub_accepted', 'ok');
      await post('number-inventory', '/numbers/adopt', { number: b.number, customerId: b.customerId });
      await post('billing', '/billing/activate', { customerId: b.customerId });
      const portId = await record('in', b, 'complete');
      em('number_ported', 'ok');
      return { status: 202, body: { portId } };
    },
    'POST /port-out': async ({ body }) => {
      const b = body || {}; const flow = 'port_out'; const em = (step, outcome) => events.emit({ flow, step, outcome, segment: b.segment || 'consumer' });
      if (!b.number || !b.customerId) return { status: 400, body: { error: 'number and customerId are required' } };
      const known = await client.call('number-inventory', { path: `/numbers/${encodeURIComponent(b.number)}` });
      bs.must(known);
      if (known.status !== 200 || known.body.customerId !== b.customerId) { em('port_requested', 'business_exception'); return { status: 404, body: { error: 'number not found for this customer' } }; }
      em('port_requested', 'ok');
      await post('porting-hub', '/port', { number: b.number, direction: 'out' });
      em('hub_accepted', 'ok');
      await post('number-inventory', '/numbers/release', { number: b.number });
      const portId = await record('out', b, 'complete');
      em('number_released', 'ok');
      return { status: 202, body: { portId } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('porting', setup);
