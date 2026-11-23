const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const store = new AsyncLocalStorage();
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function newTrace() {
  return { traceId: hex(16), spanId: hex(8), flags: '01' };
}

function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim().toLowerCase());
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2], flags: m[3] };
}

function formatTraceparent(ctx) {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.flags || '01'}`;
}

function childOf(ctx) {
  return { traceId: ctx.traceId, spanId: hex(8), flags: ctx.flags || '01' };
}

function runWithContext(ctx, fn) {
  return store.run(ctx, fn);
}

function currentContext() {
  return store.getStore();
}

module.exports = { newTrace, parseTraceparent, formatTraceparent, childOf, runWithContext, currentContext };
