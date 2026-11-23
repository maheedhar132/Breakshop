const test = require('node:test');
const assert = require('node:assert');
const { createLogger } = require('../../lib/bs-core/log');
const { newTrace, runWithContext } = require('../../lib/bs-core/trace');

function capture() {
  const lines = [];
  return { lines, log: createLogger('svc', { write: (l) => lines.push(l) }) };
}

test('json lines parse and contain trace_id, level, service, msg', () => {
  const { lines, log } = capture();
  const t = newTrace();
  runWithContext(t, () => log.info('hello', { a: 1 }));
  const o = JSON.parse(lines[0]);
  assert.strictEqual(o.trace_id, t.traceId);
  assert.strictEqual(o.level, 'info');
  assert.strictEqual(o.service, 'svc');
  assert.strictEqual(o.msg, 'hello');
  assert.strictEqual(o.a, 1);
});

test('plain format is "ts LEVEL service [trace_id] msg"', () => {
  const { lines, log } = capture();
  log.setStyle({ format: 'plain' });
  const t = newTrace();
  runWithContext(t, () => log.warn('careful'));
  assert.match(lines[0], new RegExp(`^\\S+ WARN svc \\[${t.traceId}\\] careful$`));
});

test('volume 3 emits 3 extra lines per call', () => {
  const { lines, log } = capture();
  log.setStyle({ volume: 3 });
  log.info('x');
  assert.strictEqual(lines.length, 4);
});

test('sensitive true adds a line containing an email-like and card-like value', () => {
  const { lines, log } = capture();
  log.setStyle({ sensitive: true });
  log.info('x');
  const all = lines.join('\n');
  assert.match(all, /@example\.com/);
  assert.match(all, /\d{4} \d{4} \d{4} \d{4}/);
});

test('mixed format produces both json and plain lines over many calls', () => {
  const { lines, log } = capture();
  log.setStyle({ format: 'mixed' });
  for (let i = 0; i < 100; i++) log.info('m');
  assert.ok(lines.some((l) => l.startsWith('{')));
  assert.ok(lines.some((l) => !l.startsWith('{')));
});
