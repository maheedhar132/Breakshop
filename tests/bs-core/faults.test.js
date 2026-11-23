const test = require('node:test');
const assert = require('node:assert');
const { createFaults, MEMORY_CAP_BYTES } = require('../../lib/bs-core/faults');
const { createMetrics } = require('../../lib/bs-core/metrics');

test('patch validates ranges', () => {
  const f = createFaults();
  assert.throws(() => f.patch({ errorRate: 2 }), RangeError);
  assert.throws(() => f.patch({ cpuBurnPct: 51 }), RangeError);
  assert.throws(() => f.patch({ nope: 1 }), RangeError);
  assert.throws(() => f.patch({ business: { paymentDeclinedRate: -1 } }), RangeError);
  f.patch({ latencyMs: 200, business: { paymentDeclinedRate: 0.5 } });
  assert.strictEqual(f.get().latencyMs, 200);
  assert.strictEqual(f.get().business.paymentDeclinedRate, 0.5);
});

test('reset restores defaults', () => {
  const f = createFaults();
  f.patch({ latencyMs: 500, slowQuery: true });
  f.reset();
  assert.strictEqual(f.get().latencyMs, 0);
  assert.strictEqual(f.get().slowQuery, false);
});

test('decide returns error roughly errorRate of the time', () => {
  const f = createFaults();
  f.patch({ errorRate: 0.5 });
  let errors = 0;
  for (let i = 0; i < 1000; i++) if (f.decide() === 'error') errors++;
  assert.ok(errors > 400 && errors < 600, `errors=${errors}`);
  f.patch({ errorRate: 0, timeoutRate: 1 });
  assert.strictEqual(f.decide(), 'timeout');
});

test('memory leak stops at 512 MB cap', () => {
  let bytes = 0;
  const f = createFaults({ allocator: (n) => { bytes += n; return null; } });
  f.patch({ memoryLeakMBPerMin: 200 });
  for (let i = 0; i < 5000; i++) f.tick();
  assert.ok(bytes <= MEMORY_CAP_BYTES);
  assert.ok(bytes > MEMORY_CAP_BYTES * 0.9);
  assert.strictEqual(f.retainedBytes(), bytes);
});

test('cpu burn tick blocks for about cpuBurnPct ms', () => {
  const f = createFaults();
  f.patch({ cpuBurnPct: 20 });
  const t = Date.now();
  f.tick();
  assert.ok(Date.now() - t >= 19);
});

test('render contains http_requests_total and duration bucket lines', () => {
  const m = createMetrics('svc');
  m.observe('GET /x', 200, 12);
  m.inc('orders_total', { type: 'sim' });
  m.gauge('inflight', 3);
  const text = m.render();
  assert.match(text, /http_requests_total\{service="svc",route="GET \/x",status="200"\} 1/);
  assert.match(text, /http_request_duration_ms_bucket\{service="svc",route="GET \/x",le="25"\} 1/);
  assert.match(text, /orders_total\{service="svc",type="sim"\} 1/);
  assert.match(text, /inflight\{service="svc"\} 3/);
});
