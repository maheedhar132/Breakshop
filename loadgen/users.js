const bs = require('../lib/bs-core');

const MAX_INFLIGHT = 200;
const SHAPES = ['steady', 'spike', 'ramp', 'wave', 'random'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

class Abandon extends Error { constructor(kind) { super(kind); this.kind = kind; } }

// Pretend customers: picks journeys by weight and gives up when the shop is too slow or broken.
async function setup({ client, events, log, metrics }) {
  const available = (process.env.BS_JOURNEYS || Object.keys(bs.FLOWS).join(',')).split(',').filter(Boolean);
  const stats = { started: 0, completed: 0, abandoned: 0, errors: 0, inflight: 0, skipped: 0 };
  const pool = [];
  let plans = null;
  let cfg = { rps: 0, shape: 'steady', patienceSeconds: 8, existingUserRatio: 0.3, mix: Object.fromEntries(available.map((j) => [j, 1])) };
  let timer = null; let since = 0; let carry = 0; let randomFactor = 1; let randomAt = 0;

  async function api(j, method, path, body) {
    const remaining = j.deadline - Date.now();
    if (remaining <= 0) throw new Abandon('patience');
    let res;
    try { res = await client.call('gateway', { method, path, body, timeoutMs: remaining }); } catch (e) { throw new Abandon('timeout'); }
    if (res.status >= 500) throw new Abandon('error');
    return res;
  }

  const person = () => { const n = digits(9); return { name: 'Customer ' + n, email: `c${n}@example.com`, phone: '07' + digits(9), idDoc: 'ID' + n }; };
  async function createCustomer(j, p = person()) {
    const r = await api(j, 'POST', '/api/accounts', { ...p, segment: j.segment });
    if (r.status === 201) { const c = { ...p, customerId: r.body.customerId, numbers: [] }; if (pool.length < 500) pool.push(c); return c; }
    return null;
  }
  async function customerFor(j) {
    if (pool.length) return pick(pool);
    const c = await createCustomer(j);
    if (!c) throw new Abandon('error');
    return c;
  }
  async function planFor(j, type) {
    if (!plans) { const r = await api(j, 'GET', '/api/plans'); plans = (r.body && r.body.plans) || []; }
    const list = plans.filter((p) => p.type === type);
    const plan = list.length ? pick(list) : { planId: type === 'sim' ? 'SIM-PLUS' : 'BB-FIBRE-100', monthly: 20, oneOff: 0 };
    j.amount = Math.round((plan.monthly + plan.oneOff) * 100) / 100;
    return plan;
  }

  const JOURNEYS = {
    async create_account(j) {
      const reuse = pool.length && Math.random() < cfg.existingUserRatio;
      await (reuse ? api(j, 'POST', '/api/accounts', { ...pick(pool), segment: j.segment }) : createCustomer(j));
    },
    async buy_sim(j) {
      const c = await customerFor(j); const plan = await planFor(j, 'sim');
      const r = await api(j, 'POST', '/api/orders', { type: 'sim', customerId: c.customerId, planId: plan.planId, idDoc: c.idDoc, segment: j.segment });
      if (r.status === 201 && r.body.number) c.numbers.push(r.body.number);
    },
    async buy_broadband(j) {
      const c = await customerFor(j); const plan = await planFor(j, 'broadband');
      await api(j, 'POST', '/api/orders', { type: 'broadband', customerId: c.customerId, planId: plan.planId, postcode: `${pick(['M', 'B', 'LS', 'EH', 'CF', 'G'])}${1 + Math.floor(Math.random() * 20)} ${1 + Math.floor(Math.random() * 9)}${pick(['AA', 'BX', 'QT'])}`, segment: j.segment });
    },
    async recharge(j) {
      const c = await customerFor(j); j.amount = pick([5, 10, 20, 30]);
      await api(j, 'POST', '/api/orders', { type: 'recharge', customerId: c.customerId, amount: j.amount, segment: j.segment });
    },
    async port_in(j) {
      const c = await customerFor(j); const number = `07900 ${digits(6)}`;
      const r = await api(j, 'POST', '/api/port-in', { number, fromOperator: pick(['OtherTel', 'MobileCo', 'NetOne']), customerId: c.customerId, idDoc: c.idDoc, segment: j.segment });
      if (r.status === 202) c.numbers.push(number);
    },
    async port_out(j) {
      const owner = pool.find((c) => c.numbers.length) || await customerFor(j);
      const number = owner.numbers.length ? pick(owner.numbers) : `07900 ${digits(6)}`;
      const r = await api(j, 'POST', '/api/port-out', { number, customerId: owner.customerId, segment: j.segment });
      if (r.status === 202) owner.numbers = owner.numbers.filter((n) => n !== number);
    }
  };

  async function runJourney(flow) {
    const j = { flow, start: Date.now(), amount: 0, segment: pick(['consumer', 'consumer', 'business']) };
    j.deadline = j.start + cfg.patienceSeconds * 1000 * (0.5 + Math.random());
    stats.started++; stats.inflight++;
    await bs.runWithContext(bs.newTrace(), async () => {
      try { await JOURNEYS[flow](j); stats.completed++; } catch (e) {
        if (e instanceof Abandon) {
          if (e.kind === 'error') stats.errors++; else stats.abandoned++;
          events.emit({ flow, step: bs.FLOWS[flow][0], outcome: 'abandoned', amount: j.amount, segment: j.segment, elapsedMs: Date.now() - j.start });
        } else log.error('journey crashed', { flow, error: e.message, stack: e.stack });
      } finally { stats.inflight--; }
    });
  }

  function rate(t) {
    const r = cfg.rps;
    if (cfg.shape === 'spike') return t % 60 < 10 ? r * 2 : r * 0.3;
    if (cfg.shape === 'ramp') return r * Math.min(1, t / 120);
    if (cfg.shape === 'wave') return r * (0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 120));
    if (cfg.shape === 'random') { if (t - randomAt >= 5) { randomAt = t; randomFactor = 0.2 + Math.random() * 1.6; } return r * randomFactor; }
    return r;
  }

  function tick() {
    const t = (Date.now() - since) / 1000;
    carry += rate(t) * 0.1;
    const weights = Object.entries(cfg.mix).filter(([, w]) => w > 0);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    while (carry >= 1) {
      carry -= 1;
      if (!total) continue;
      if (stats.inflight >= MAX_INFLIGHT) { stats.skipped++; continue; }
      let roll = Math.random() * total; let flow = weights[0][0];
      for (const [name, w] of weights) { roll -= w; if (roll <= 0) { flow = name; break; } }
      runJourney(flow).catch(() => {});
    }
  }

  function validate(b) {
    const next = { ...cfg, ...b };
    if (!(next.rps >= 0 && next.rps <= 200)) return 'rps must be between 0 and 200';
    if (!SHAPES.includes(next.shape)) return `shape must be one of ${SHAPES.join(', ')}`;
    if (!(next.patienceSeconds >= 1 && next.patienceSeconds <= 60)) return 'patienceSeconds must be between 1 and 60';
    if (!(next.existingUserRatio >= 0 && next.existingUserRatio <= 1)) return 'existingUserRatio must be between 0 and 1';
    for (const [name, w] of Object.entries(next.mix || {})) {
      if (!available.includes(name)) return `journey ${name} is not available in this profile`;
      if (!(w >= 0)) return `weight for ${name} must be zero or more`;
    }
    return null;
  }

  function stop() { if (timer) clearInterval(timer); timer = null; cfg.rps = 0; }

  return {
    'PUT /config': async ({ body }) => {
      const err = validate(body || {});
      if (err) return { status: 400, body: { error: err } };
      cfg = { ...cfg, ...body };
      since = Date.now(); carry = 0; randomAt = -10;
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 100);
      for (let i = pool.length; i < 10; i++) bs.runWithContext(bs.newTrace(), () => createCustomer({ deadline: Date.now() + 8000, segment: 'consumer' })).catch(() => {});
      return { status: 200, body: cfg };
    },
    'GET /config': async () => ({ status: 200, body: { ...cfg, running: !!timer } }),
    'POST /stop': async () => { stop(); return { status: 200, body: { stopped: true } }; },
    'GET /stats': async () => ({ status: 200, body: { ...stats, pool: pool.length } })
  };
}

module.exports = { setup };
if (require.main === module) bs.run('loadgen-users', setup, { db: false });
