const http = require('node:http');
const { currentContext, newTrace, childOf, formatTraceparent } = require('./trace');

class ServiceUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'ServiceUnavailableError'; this.status = 503; }
}
class DependencyError extends Error {
  constructor(message) { super(message); this.name = 'DependencyError'; this.status = 502; }
}

function once(inst, { method = 'GET', path, body }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ctx = currentContext();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { traceparent: formatTraceparent(ctx ? childOf(ctx) : newTrace()) };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    const req = http.request({ host: inst.host || '127.0.0.1', port: inst.port, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = text ? JSON.parse(text) : undefined; } catch { /* keep text */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createClient({ directory, faults, retries = 1, timeoutMs = 5000 }) {
  const next = new Map();
  async function call(service, req) {
    if (faults && faults.get().dependencyFailure) throw new DependencyError(`${service}: dependency failure injected`);
    let list = directory.resolve(service);
    if (!list.length && directory.refresh) { await directory.refresh(); list = directory.resolve(service); }
    if (!list.length) throw new ServiceUnavailableError(`${service}: no healthy copies`);
    const limit = req.timeoutMs || timeoutMs;
    const deadline = Date.now() + limit;
    const start = next.get(service) || 0;
    next.set(service, start + 1);
    const attempts = Math.min(list.length, retries + 1);
    let last = 'no attempt';
    for (let i = 0; i < attempts; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        const res = await once(list[(start + i) % list.length], req, remaining);
        if ([502, 503, 504].includes(res.status) && i < attempts - 1) { last = `status ${res.status}`; continue; }
        return res;
      } catch (e) { last = e.message; }
    }
    if (directory.refresh) directory.refresh();
    throw new ServiceUnavailableError(`${service}: ${last}`);
  }
  return { call };
}

module.exports = { createClient, ServiceUnavailableError, DependencyError };

// Turns a 5xx answer from a dependency into a thrown error so the caller returns 502/503 too.
function must(res) {
  if (res.status >= 500) throw Object.assign(new Error(`downstream returned ${res.status}`), { status: res.status === 503 ? 503 : 502 });
  return res;
}
module.exports.must = must;
