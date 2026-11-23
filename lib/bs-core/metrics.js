const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function labelText(labels) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return '';
  return '{' + entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',') + '}';
}

function createMetrics(service) {
  const counters = new Map();
  const gauges = new Map();
  const hist = new Map();

  function inc(name, labels, by = 1) {
    const key = name + labelText({ service, ...labels });
    counters.set(key, (counters.get(key) || 0) + by);
  }

  function gauge(name, value) {
    gauges.set(name + labelText({ service }), value);
  }

  function observe(route, status, ms) {
    inc('http_requests_total', { route, status });
    let h = hist.get(route);
    if (!h) { h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }; hist.set(route, h); }
    BUCKETS.forEach((b, i) => { if (ms <= b) h.buckets[i]++; });
    h.sum += ms; h.count++;
  }

  function render() {
    const out = [];
    for (const [k, v] of counters) out.push(`${k} ${v}`);
    for (const [k, v] of gauges) out.push(`${k} ${v}`);
    for (const [route, h] of hist) {
      BUCKETS.forEach((b, i) => out.push(`http_request_duration_ms_bucket${labelText({ service, route, le: b })} ${h.buckets[i]}`));
      out.push(`http_request_duration_ms_bucket${labelText({ service, route, le: '+Inf' })} ${h.count}`);
      out.push(`http_request_duration_ms_sum${labelText({ service, route })} ${h.sum}`);
      out.push(`http_request_duration_ms_count${labelText({ service, route })} ${h.count}`);
    }
    return out.join('\n') + '\n';
  }

  return { inc, gauge, observe, render };
}

module.exports = { createMetrics };
