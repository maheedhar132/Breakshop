const { sleep } = require('./cluster');

let counter = 0;
const uniq = () => `${Date.now()}${++counter}`;

async function newCustomer(c) {
  const u = uniq();
  const r = await c.call('account', { method: 'POST', path: '/accounts', body: { name: 'Test ' + u, email: `t${u}@example.com`, phone: '07' + u.slice(-9), idDoc: 'ID-' + u } });
  if (r.status !== 201) throw new Error('could not create customer: ' + r.text);
  return r.json.customerId;
}

const traceOf = (res) => res.headers.traceparent.split('-')[1];

async function eventsFor(c, res, { waitMs = 0, minCount = 0 } = {}) {
  const trace = traceOf(res);
  const end = Date.now() + waitMs;
  for (;;) {
    const list = (await c.events()).filter((e) => e.correlation_id === trace);
    if (list.length >= minCount || Date.now() >= end) return list;
    await sleep(100);
  }
}

const setFaults = (c, service, body) => c.call(service, { method: 'PUT', path: '/__admin/faults', body });
const resetFaults = (c, service) => c.call(service, { method: 'POST', path: '/__admin/reset' });
const steps = (list) => list.map((e) => e.step);

async function availablePostcode(c) {
  for (const pc of ['M1 1AA', 'B2 4QA', 'LS1 4DY', 'EH1 1YZ', 'CF10 1EP', 'G1 1XQ', 'NE1 4ST', 'BS1 4DJ']) {
    const r = await c.call('coverage', { path: `/coverage?postcode=${encodeURIComponent(pc)}` });
    if (r.json.available) return pc;
  }
  throw new Error('no covered postcode found');
}

module.exports = { newCustomer, traceOf, eventsFor, setFaults, resetFaults, steps, availablePostcode, uniq };
