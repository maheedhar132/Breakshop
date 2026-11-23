const test = require('node:test');
const assert = require('node:assert');
const { newTrace, parseTraceparent, formatTraceparent, childOf, runWithContext, currentContext } = require('../../lib/bs-core/trace');

test('parseTraceparent rejects malformed headers and all-zero ids', () => {
  assert.strictEqual(parseTraceparent(undefined), null);
  assert.strictEqual(parseTraceparent('garbage'), null);
  assert.strictEqual(parseTraceparent('00-' + '0'.repeat(32) + '-' + 'a'.repeat(16) + '-01'), null);
  assert.strictEqual(parseTraceparent('00-' + 'a'.repeat(32) + '-' + '0'.repeat(16) + '-01'), null);
  assert.ok(parseTraceparent('00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01'));
});

test('formatTraceparent round trips', () => {
  const t = newTrace();
  assert.deepStrictEqual(parseTraceparent(formatTraceparent(t)), t);
  assert.match(formatTraceparent(t), /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('childOf keeps traceId, changes spanId', () => {
  const t = newTrace();
  const c = childOf(t);
  assert.strictEqual(c.traceId, t.traceId);
  assert.notStrictEqual(c.spanId, t.spanId);
});

test('currentContext is visible across await inside runWithContext', async () => {
  const t = newTrace();
  await runWithContext(t, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(currentContext().traceId, t.traceId);
  });
  assert.strictEqual(currentContext(), undefined);
});
