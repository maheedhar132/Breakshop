const http = require('node:http');
const { currentContext } = require('./trace');
const { stepIndex } = require('./flows');

function post(url, body) {
  try {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
    if (process.env.BS_TOKEN) headers['x-bs-token'] = process.env.BS_TOKEN;
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers, timeout: 500 }, (res) => res.resume());
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(payload);
  } catch { /* events must never break a request */ }
}

function createEvents({ service, controlCenterUrl, log }) {
  const target = controlCenterUrl || process.env.BS_CONTROL_CENTER_URL || 'http://127.0.0.1:2605';
  let last = 0;
  const nextTs = () => {
    let t = Date.now();
    if (t <= last) t = last + 1;
    last = t;
    return new Date(t).toISOString();
  };

  return {
    emit(e) {
      const ctx = currentContext();
      const evt = {
        type: 'business_event', flow: e.flow, step: e.step, step_index: stepIndex(e.flow, e.step),
        correlation_id: ctx ? ctx.traceId : undefined, ts: nextTs(), outcome: e.outcome,
        amount: e.amount, currency: e.currency || process.env.BS_CURRENCY || 'GBP', segment: e.segment, service
      };
      if (e.elapsedMs !== undefined) evt.elapsed_ms = e.elapsedMs;
      const { ts, ...rest } = evt;
      log.info('business_event', { ...rest, event_ts: ts });
      post(`${target}/api/events`, evt);
    }
  };
}

module.exports = { createEvents };
