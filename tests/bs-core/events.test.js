const test = require('node:test');
const assert = require('node:assert');
const { FLOWS, stepIndex } = require('../../lib/bs-core/flows');
const { createEvents } = require('../../lib/bs-core/events');
const { createBus } = require('../../lib/bs-core/bus');
const { createLogger } = require('../../lib/bs-core/log');
const { newTrace, runWithContext, currentContext, formatTraceparent } = require('../../lib/bs-core/trace');

const logger = () => { const lines = []; return { lines, log: createLogger('svc', { write: (l) => lines.push(l) }) }; };

test('stepIndex returns the position and throws on unknown step', () => {
  assert.strictEqual(stepIndex('buy_sim', 'payment_authorised'), 4);
  assert.throws(() => stepIndex('buy_sim', 'nope'));
  assert.throws(() => stepIndex('nope', 'x'));
  assert.deepStrictEqual(Object.keys(FLOWS).sort(), ['buy_broadband', 'buy_sim', 'create_account', 'port_in', 'port_out', 'recharge']);
});

test('emit timestamps strictly increase over 1000 calls and carry the spec fields', () => {
  const { lines, log } = logger();
  const events = createEvents({ service: 'orders', controlCenterUrl: 'http://127.0.0.1:1', log });
  runWithContext(newTrace(), () => {
    for (let i = 0; i < 1000; i++) events.emit({ flow: 'recharge', step: 'amount_selected', outcome: 'ok', amount: 10 });
  });
  const ts = lines.map((l) => Date.parse(JSON.parse(l).event_ts));
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1]);
  const o = JSON.parse(lines[0]);
  for (const k of ['flow', 'step', 'step_index', 'correlation_id', 'outcome', 'amount', 'currency', 'service']) assert.ok(k in o, k);
  assert.strictEqual(o.currency, 'GBP');
});

test('correlation_id equals the active traceId; emit with an unreachable URL does not throw', () => {
  const { lines, log } = logger();
  const events = createEvents({ service: 'orders', controlCenterUrl: 'http://127.0.0.1:1', log });
  const t = newTrace();
  runWithContext(t, () => events.emit({ flow: 'buy_sim', step: 'order_created', outcome: 'ok', amount: 20 }));
  assert.strictEqual(JSON.parse(lines[0]).correlation_id, t.traceId);
});

test("subscribe handler sees the publisher's traceId", async () => {
  const queue = [];
  const client = {
    call: async (service, req) => {
      if (req.method === 'POST') { queue.push(req.body); return { status: 202 }; }
      const messages = queue.splice(0, queue.length);
      return { status: 200, body: { messages } };
    }
  };
  const bus = createBus({ client, pollMs: 20 });
  const seen = new Promise((resolve) => bus.subscribe('order.paid', 'g', async (payload) => resolve({ payload, traceId: currentContext().traceId })));
  const t = newTrace();
  await runWithContext(t, () => bus.publish('order.paid', { orderId: 1 }));
  const got = await seen;
  assert.strictEqual(got.traceId, t.traceId);
  assert.deepStrictEqual(got.payload, { orderId: 1 });
  assert.ok(formatTraceparent(t));
});
