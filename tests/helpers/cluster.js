const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { request } = require('./http');

const root = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// Starts the real supervisor against a topology (default: the repo's). Returns helpers and a stop().
async function startCluster({ profile = 'full', topology, supervisorPort, extraEnv = {}, sink = false, rootDir = root } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs cluster '));
  const topoPath = path.join(dir, 'topology.json');
  const topo = topology || JSON.parse(fs.readFileSync(path.join(root, 'topology.json'), 'utf8'));
  if (!topology) {
    let base = 30000 + Math.floor(Math.random() * 1500) * 10;
    for (const p of Object.values(topo.processes)) { p.port = base; base += 10; }
  }
  if (sink) topo.processes['control-center'].entry = 'tests/fixtures/event-sink.js';
  if (!topology) {
    topo.profiles[profile] = topo.profiles[profile].filter((n) => fs.existsSync(path.join(rootDir, topo.processes[n].entry)));
  }
  fs.writeFileSync(topoPath, JSON.stringify(topo));
  const port = supervisorPort || await freePort();
  const stateFile = path.join(dir, 'state.json');
  const env = { ...process.env, BS_SUPERVISOR_PORT: String(port), BS_STATE_FILE: stateFile, BS_LOG_DIR: path.join(dir, 'logs'), BS_DATA_DIR: path.join(dir, 'data'), BS_HEALTH_MS: '200', ...extraEnv };
  const child = spawn(process.execPath, [path.join(rootDir, 'supervisor', 'index.js'), '--topology', topoPath, '--root', rootDir, '--profile', profile, '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const supervisorUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    if (child.exitCode !== null) break;
    try { ready = (await request(port, { path: '/status' })).status === 200; } catch { await sleep(100); }
  }
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const api = {
    supervisorUrl, port, dir, child, output: () => output, exited: () => child.exitCode !== null,
    token: () => state().token,
    topology: topo,
    // Calls a running service directly, the way another service would.
    call: async (service, opts) => {
      const d = await api.directory();
      const inst = (d[service] || []).find((i) => i.status === 'up');
      if (!inst) throw new Error(`${service} has no healthy copy`);
      return request(inst.port, { ...opts, headers: { 'x-bs-token': state().token, ...(opts && opts.headers) } });
    },
    events: async () => (await api.call('control-center', { path: '/api/events/recent' })).json.events,
    clearEvents: () => api.call('control-center', { method: 'POST', path: '/api/events/clear' }),
    status: async () => (await request(port, { path: '/status' })).json,
    directory: async () => (await request(port, { path: '/directory' })).json.services,
    post: (p, body, method = 'POST') => request(port, { method, path: p, body, headers: { 'x-bs-token': state().token } }),
    waitUp: async (names, timeoutMs = 20000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const d = await api.directory().catch(() => ({}));
        if (names.every((n) => (d[n] || []).length > 0 && d[n].every((i) => i.status === 'up'))) return d;
        await sleep(150);
      }
      throw new Error('timeout waiting for ' + names.join(','));
    },
    stop: async () => {
      try { await request(port, { method: 'POST', path: '/shutdown', headers: { 'x-bs-token': state().token } }); } catch { /* already stopped */ }
      for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
      if (child.exitCode === null) child.kill();
    }
  };
  return api;
}

module.exports = { startCluster, freePort, sleep };
