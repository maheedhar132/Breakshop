const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') out.noOpen = true;
    else if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || path.join(__dirname, '..'));
const topology = JSON.parse(fs.readFileSync(args.topology || path.join(root, 'topology.json'), 'utf8'));
const profile = args.profile || process.env.BS_PROFILE || 'full';
const names = topology.profiles[profile];
if (!names) { console.error(`Unknown profile "${profile}". Available: ${Object.keys(topology.profiles).join(', ')}`); process.exit(1); }

if (process.env.BS_CONTROL_CENTER_PORT && topology.processes['control-center']) topology.processes['control-center'].port = Number(process.env.BS_CONTROL_CENTER_PORT);

const home = path.join(os.homedir(), '.breakshop');
const supervisorPort = Number(process.env.BS_SUPERVISOR_PORT || 5550);
const stateFile = process.env.BS_STATE_FILE || path.join(home, 'supervisor.json');
const logDir = process.env.BS_LOG_DIR || path.join(home, 'logs');
const healthMs = Number(process.env.BS_HEALTH_MS || 2000);
const token = crypto.randomBytes(16).toString('hex');
const base = `http://127.0.0.1:${supervisorPort}`;
const ccDef = topology.processes['control-center'];
const instances = new Map();
const copies = new Map();
let shuttingDown = false;

function childEnv(inst) {
  return {
    ...process.env, BS_TOKEN: token, BS_SUPERVISOR_URL: base, BS_PROFILE: profile,
    BS_JOURNEYS: (topology.journeys[profile] || []).join(','),
    BS_CONTROL_CENTER_URL: `http://127.0.0.1:${ccDef ? ccDef.port : 2605}`,
    BS_PORT: String(inst.port), BS_INSTANCE: inst.id, BS_LOG_DIR: logDir
  };
}

function spawnInstance(inst) {
  const def = topology.processes[inst.name];
  inst.stopped = false;
  inst.status = 'down';
  fs.mkdirSync(logDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logDir, `${inst.id}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [path.join(root, def.entry)], { cwd: root, env: childEnv(inst), stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  inst.proc = child;
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.on('exit', () => {
    inst.proc = null;
    logStream.end();
    if (inst.stopped || inst.removed || shuttingDown) { inst.status = 'stopped'; return; }
    inst.status = 'down';
    inst.restarts++;
    setTimeout(() => { if (!inst.proc && !inst.stopped && !inst.removed && !shuttingDown) spawnInstance(inst); }, Math.min(500 * 2 ** (inst.restarts - 1), 15000));
  });
}

function ensureInstances(name) {
  const def = topology.processes[name];
  const list = instances.get(name) || [];
  for (let i = 0; i < copies.get(name); i++) {
    let inst = list[i];
    if (!inst) { inst = { id: `${name}-${i}`, name, index: i, port: def.port + i, status: 'down', stopped: false, removed: false, proc: null, restarts: 0 }; list[i] = inst; }
    if (inst.removed) { inst.removed = false; inst.stopped = false; }
    if (!inst.proc && !inst.stopped) spawnInstance(inst);
  }
  for (let i = copies.get(name); i < list.length; i++) {
    const inst = list[i];
    if (inst && !inst.removed) { inst.removed = true; inst.stopped = true; if (inst.proc) inst.proc.kill(); else inst.status = 'stopped'; }
  }
  instances.set(name, list);
}

function visible(name) { return (instances.get(name) || []).filter((i) => i && !i.removed); }

function directory() {
  const services = {};
  for (const n of names) services[n] = visible(n).map((i) => ({ id: i.id, host: '127.0.0.1', port: i.port, status: i.status }));
  return { services };
}

function status() {
  const processes = {};
  for (const n of names) processes[n] = { copies: copies.get(n), instances: visible(n).map((i) => ({ id: i.id, port: i.port, status: i.status, restarts: i.restarts, pid: i.proc ? i.proc.pid : null })) };
  return { profile, journeys: topology.journeys[profile] || [], processes };
}

function probe(inst) {
  const req = http.get({ host: '127.0.0.1', port: inst.port, path: '/healthz', timeout: 800 }, (res) => {
    res.resume();
    if (inst.proc && !inst.stopped) { inst.status = res.statusCode === 200 ? 'up' : 'down'; if (inst.status === 'up') inst.restarts = 0; }
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => { if (inst.proc && !inst.stopped) inst.status = 'down'; });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const list of instances.values()) for (const i of list) if (i && i.proc) { i.stopped = true; i.proc.kill(); }
  try { fs.unlinkSync(stateFile); } catch { /* already gone */ }
  setTimeout(() => process.exit(code), 300);
}

function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
  });
}

function reply(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorised(req) {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
  if (req.headers.origin) return false;
  return req.headers['x-bs-token'] === token;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (req.method === 'GET' && p === '/directory') return reply(res, 200, directory());
  if (req.method === 'GET' && p === '/status') return reply(res, 200, status());
  if (req.method === 'GET' && p === '/healthz') return reply(res, 200, { status: 'ok' });
  if (!authorised(req)) return reply(res, 403, { error: 'forbidden' });
  let m;
  if (req.method === 'POST' && p === '/shutdown') { reply(res, 200, { ok: true }); return shutdown(0); }
  if (req.method === 'PUT' && (m = /^\/processes\/([^/]+)\/copies$/.exec(p))) {
    const body = await readJson(req);
    if (!names.includes(m[1])) return reply(res, 404, { error: 'unknown process' });
    if (!Number.isInteger(body.copies) || body.copies < 1 || body.copies > 9) return reply(res, 400, { error: 'copies must be an integer from 1 to 9' });
    copies.set(m[1], body.copies);
    ensureInstances(m[1]);
    return reply(res, 200, status().processes[m[1]]);
  }
  if (req.method === 'POST' && (m = /^\/processes\/([^/]+)\/instances\/([^/]+)\/(stop|start)$/.exec(p))) {
    const inst = visible(m[1]).find((i) => i.id === m[2]);
    if (!inst) return reply(res, 404, { error: 'unknown instance' });
    if (m[3] === 'stop') { inst.stopped = true; if (inst.proc) inst.proc.kill(); else inst.status = 'stopped'; }
    else if (!inst.proc) spawnInstance(inst);
    return reply(res, 200, { id: inst.id, status: inst.status });
  }
  return reply(res, 404, { error: 'not found' });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, shell: false }).on('error', () => {}).unref(); } catch { /* optional */ }
}

async function main() {
  const wanted = [supervisorPort];
  for (const n of names) { copies.set(n, topology.processes[n].copies || 1); for (let i = 0; i < copies.get(n); i++) wanted.push(topology.processes[n].port + i); }
  for (const port of wanted) {
    if (!(await isFree(port))) { console.error(`Port ${port} is already in use. Stop whatever is using it (or run stop first) and try again.${topology.processes['control-center'] && port === topology.processes['control-center'].port ? ' To keep it running, choose another Control Center port with BS_CONTROL_CENTER_PORT.' : ''}`); process.exit(1); }
  }
  const server = http.createServer((req, res) => { handle(req, res).catch((e) => reply(res, 500, { error: e.message })); });
  await new Promise((resolve) => server.listen(supervisorPort, '127.0.0.1', resolve));
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port: supervisorPort, token }), { mode: 0o600 });
  for (const n of names) ensureInstances(n);
  setInterval(() => { for (const n of names) for (const i of visible(n)) if (i.proc) probe(i); }, healthMs).unref();
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('exit', () => { for (const list of instances.values()) for (const i of list) if (i && i.proc) i.proc.kill(); });
  const shop = topology.processes.storefront;
  console.log(`BreakShop (${profile}) starting ${names.length} processes.
  Control Center: http://localhost:${ccDef ? ccDef.port : 2605}${shop && names.includes('storefront') ? `
  Shop:           http://localhost:${shop.port}` : ''}`);
  if (!args.noOpen && ccDef) setTimeout(() => openBrowser(`http://localhost:${ccDef.port}`), 3000);
}

main();
