const bs = require('../lib/bs-core');

const KEEP = 5000;

function build() {
  const svc = bs.createService({ name: 'bus' });
  const topics = new Map();
  const topic = (name) => { if (!topics.has(name)) topics.set(name, { offset: 0, messages: [], cursors: new Map() }); return topics.get(name); };

  svc.addRoutes({
    'POST /publish/:topic': async ({ params, body }) => {
      const t = topic(params.topic);
      t.messages.push({ traceparent: body && body.traceparent, payload: body && body.payload });
      if (t.messages.length > KEEP) { t.messages.shift(); t.offset++; }
      return { status: 202, body: { queued: true } };
    },
    'GET /poll/:topic': async ({ params, query }) => {
      const t = topic(params.topic);
      const group = query.group || 'default';
      const max = Math.min(Number(query.max) || 20, 100);
      const from = Math.max(t.cursors.get(group) || 0, t.offset);
      const messages = t.messages.slice(from - t.offset, from - t.offset + max);
      t.cursors.set(group, from + messages.length);
      return { status: 200, body: { messages } };
    }
  });
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
