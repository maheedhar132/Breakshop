const test = require('node:test');
const assert = require('node:assert');
const { build } = require('../bus');
const { request } = require('./helpers/http');

async function withBus(fn) {
  const svc = build(); svc.port = 0; svc.log.info = () => {};
  await svc.start();
  try { await fn(svc.port); } finally { await svc.stop(); }
}

test('two groups each receive a published message once', () => withBus(async (port) => {
  await request(port, { method: 'POST', path: '/publish/order.paid', body: { traceparent: 'x', payload: { id: 1 } } });
  const a = await request(port, { path: '/poll/order.paid?group=a' });
  const b = await request(port, { path: '/poll/order.paid?group=b' });
  assert.strictEqual(a.json.messages.length, 1);
  assert.strictEqual(b.json.messages.length, 1);
  assert.deepStrictEqual(a.json.messages[0].payload, { id: 1 });
}));

test('a message is not redelivered to the same group after polling', () => withBus(async (port) => {
  await request(port, { method: 'POST', path: '/publish/t', body: { payload: 1 } });
  assert.strictEqual((await request(port, { path: '/poll/t?group=g' })).json.messages.length, 1);
  assert.strictEqual((await request(port, { path: '/poll/t?group=g' })).json.messages.length, 0);
  await request(port, { method: 'POST', path: '/publish/t', body: { payload: 2 } });
  assert.strictEqual((await request(port, { path: '/poll/t?group=g' })).json.messages[0].payload, 2);
}));
