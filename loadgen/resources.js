const os = require('node:os');
const http = require('node:http');
const { Worker } = require('node:worker_threads');
const bs = require('../lib/bs-core');

const BUSY_LIMIT = 70;
const WORKER_SOURCE = `const { workerData } = require('node:worker_threads');
setInterval(() => { const end = Date.now() + workerData.duty * 100; while (Date.now() < end) { /* burn */ } }, 100);`;

// How busy the machine is right now (percent), sampled over a quarter of a second.
async function sampleBusy() {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((s, v) => s + v, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap();
  await bs.sleep(250);
  const b = snap();
  return b.total === a.total ? 0 : 100 * (1 - (b.idle - a.idle) / (b.total - a.total));
}

// CPU burn runs in worker threads, so this process stays responsive and PANIC always answers.
const realWorkers = (count, duty) => {
  const workers = Array.from({ length: count }, () => new Worker(WORKER_SOURCE, { eval: true, workerData: { duty } }));
  return { stop: () => workers.forEach((w) => w.terminate()) };
};
const realMemory = (mb) => { const held = Buffer.alloc(mb * 1024 * 1024, 1); return { release: () => { held.fill(0, 0, 0); } }; };

function putFaults(directory, name, patch) {
  return Promise.all(directory.resolve(name).map((i) => new Promise((resolve) => {
    const payload = JSON.stringify(patch);
    const req = http.request({ host: '127.0.0.1', port: i.port, path: '/__admin/faults', method: 'PUT', timeout: 1500, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-bs-token': process.env.BS_TOKEN || '' } }, (res) => { res.resume(); resolve(); });
    req.on('error', resolve); req.on('timeout', () => req.destroy());
    req.end(payload);
  })));
}

async function setup(ctx, opts = {}) {
  const cores = opts.cores || os.cpus().length;
  const totalMB = opts.totalMB || Math.floor(os.totalmem() / 1048576);
  const probe = opts.probe || sampleBusy;
  const startWorkers = opts.workerFactory || realWorkers;
  const hold = opts.allocate || realMemory;
  let directory = opts.directory;
  if (!directory) { directory = bs.createDirectoryFromEnv(); await directory.start(); }
  const applyService = opts.applyService || ((name, patch) => putFaults(directory, name, patch));
  let active = null;

  async function stop() {
    if (!active) return;
    const a = active; active = null;
    clearTimeout(a.timer);
    if (a.workers) a.workers.stop();
    if (a.memory) a.memory.release();
    if (a.service) await applyService(a.target, { cpuBurnPct: 0, memoryLeakMBPerMin: 0 });
  }

  return {
    'POST /stress': async ({ body }) => {
      const b = body || {};
      const applied = {
        target: b.target || 'host',
        cpuPct: Math.max(0, Math.min(50, Number(b.cpuPct) || 0)),
        memoryMB: Math.max(0, Math.min(Math.floor(totalMB / 4), 1024, Number(b.memoryMB) || 0)),
        durationSec: Math.max(1, Math.min(600, Number(b.durationSec) || 60))
      };
      if ((await probe()) > BUSY_LIMIT) return { status: 409, body: { error: 'machine_busy' } };
      await stop();
      const a = { ...applied, service: applied.target !== 'host', endsAt: Date.now() + applied.durationSec * 1000 };
      if (a.service) {
        await applyService(a.target, { cpuBurnPct: Math.min(50, applied.cpuPct), memoryLeakMBPerMin: Math.min(200, Math.round(applied.memoryMB * 60 / applied.durationSec)) });
      } else {
        if (applied.cpuPct > 0) { const n = Math.max(1, Math.ceil((applied.cpuPct / 100) * cores)); a.workers = startWorkers(n, (applied.cpuPct / 100 * cores) / n); }
        if (applied.memoryMB > 0) a.memory = hold(applied.memoryMB);
      }
      a.timer = setTimeout(() => { stop().catch(() => {}); }, applied.durationSec * 1000);
      a.timer.unref();
      active = a;
      return { status: 202, body: { applied } };
    },
    'POST /panic': async () => { await stop(); return { status: 200, body: { stopped: true } }; },
    'GET /state': async () => ({ status: 200, body: { active: active && { target: active.target, cpuPct: active.cpuPct, memoryMB: active.memoryMB, endsAt: active.endsAt } } })
  };
}

module.exports = { setup };
if (require.main === module) bs.run('loadgen-resources', setup, { db: false });
