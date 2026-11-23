const { createService, main } = require('../../lib/bs-core/server');

// Stands in for the Control Center in journey tests: collects business events.
const events = [];
const svc = createService({
  name: 'control-center',
  routes: {
    'POST /api/events': async ({ body }) => { events.push(body); return { status: 202, body: { ok: true } }; },
    'GET /api/events/recent': async () => ({ status: 200, body: { events } }),
    'POST /api/events/clear': async () => { events.length = 0; return { status: 200, body: { ok: true } }; }
  }
});
svc.log.info = () => {};
main(svc);
