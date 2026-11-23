/* Core: helpers, calls to the Control Center, business, traffic, stress, logs and metrics. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const token = $('meta[name=bs-token]').content;
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
};

const OUTCOMES = [
  { key: 'paymentDeclinedRate', owner: 'payment-gateway', label: 'Payment declined' },
  { key: 'kycRejectedRate', owner: 'kyc-provider', label: 'Identity rejected' },
  { key: 'numberUnavailableRate', owner: 'number-inventory', label: 'Number unavailable' },
  { key: 'outOfStockRate', owner: 'plans', label: 'Out of stock' }
];
const SLIDERS = [
  { key: 'latencyMs', label: 'Latency', unit: ' ms', min: 0, max: 5000, step: 50, scale: 1, help: 'Adds this much delay to every request.' },
  { key: 'errorRate', label: 'Errors', unit: '%', min: 0, max: 100, step: 1, scale: 0.01, help: 'Share of requests that fail with a server error.' },
  { key: 'timeoutRate', label: 'Timeouts', unit: '%', min: 0, max: 100, step: 1, scale: 0.01, help: 'Share of requests that never get a reply.' },
  { key: 'cpuBurnPct', label: 'CPU burn', unit: '%', min: 0, max: 50, step: 1, scale: 1, help: 'Keeps the processor busy inside this service.' },
  { key: 'memoryLeakMBPerMin', label: 'Memory leak', unit: ' MB/min', min: 0, max: 200, step: 5, scale: 1, help: 'Holds on to more memory every second, up to a safe cap.' }
];
const TOGGLES = [
  { key: 'slowQuery', label: 'Slow database query', help: 'Every database call takes about a second longer.' },
  { key: 'dependencyFailure', label: 'Dependencies fail', help: 'Every call this service makes to another service fails at once.' }
];
const CLEAN = { latencyMs: 0, errorRate: 0, timeoutRate: 0, cpuBurnPct: 0, memoryLeakMBPerMin: 0, slowQuery: false, dependencyFailure: false };
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const NO_COPIES = new Set(['control-center', 'bus', 'scheduler', 'loadgen-users', 'loadgen-resources']);

let state = null;
let info = null;
let blind = store.get('bs_blind') === '1';
let trafficDirty = false;
let stressInfo = null;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

function toast(text, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}

function setConn(ok, text) {
  $('#connText').textContent = text;
  $('#conn .dot').className = `dot ${ok ? 'up' : 'down'}`;
}

async function api(method, path, body, quiet) {
  try {
    const r = await fetch(path, { method, headers: { 'x-bs-token': token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok && !quiet) toast((data && data.error) || `Request failed (${r.status})`, 'bad');
    return { ok: r.ok, status: r.status, data, offline: false };
  } catch (e) {
    return { ok: false, status: 0, data: null, offline: true };
  }
}

const money = (n, c) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c || 'GBP' }).format(n || 0);
const idle = (el) => document.activeElement !== el;

function setBlind(on) {
  blind = on;
  store.set('bs_blind', on ? '1' : '0');
  document.body.classList.toggle('blind', on);
  $('#blind').checked = on;
  if (on) $('#changedOnly').checked = false;
  render();
}

/* ---------- business ---------- */
const trail = { orders: [], revenue: [], lost: [] };
function spark(id, values) {
  const n = values.length;
  const max = Math.max(...values, 1);
  $(`#${id} polyline`).setAttribute('points', values.map((v, i) => `${n === 1 ? 0 : (i / (n - 1)) * 120},${30 - (v / max) * 26}`).join(' '));
}
function pushTrail(key, v) { trail[key].push(v); if (trail[key].length > 40) trail[key].shift(); }

function buildOutcomes() {
  $('#outcomes').append(...OUTCOMES.map((o) => {
    const input = h('input', { type: 'range', min: 0, max: 100, value: 0, 'data-outcome': o.key });
    const out = h('output', {}, '0%');
    input.addEventListener('input', () => { out.textContent = `${input.value}%`; });
    input.addEventListener('change', () => { api('PUT', '/api/business-outcomes', { [o.key]: Number(input.value) / 100 }); markStep('break'); });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, o.label), h('span', { class: 'range' }, input, out));
  }));
}

function renderBusiness(b) {
  $('#orders').textContent = b.ordersPerMin;
  $('#revenue').textContent = money(b.revenuePerMin, b.currency);
  $('#lost').textContent = money(b.abandonedOrFailedValue, b.currency);
  pushTrail('orders', b.ordersPerMin); pushTrail('revenue', b.revenuePerMin); pushTrail('lost', b.abandonedOrFailedValue);
  spark('sparkOrders', trail.orders); spark('sparkRevenue', trail.revenue); spark('sparkLost', trail.lost);
}

/* ---------- traffic ---------- */
let journeysBuilt = false;
function updateMixBar() {
  const rows = $$('[data-journey]');
  const total = rows.reduce((s, i) => s + Number(i.value), 0) || 1;
  $('#mixbar').innerHTML = rows.map((i, k) => `<i style="flex:${Number(i.value)};background:${PALETTE[k % PALETTE.length]}"></i>`).join('');
  rows.forEach((i) => { i.closest('.mix-row').querySelector('.pct').textContent = `${Math.round((Number(i.value) / total) * 100)}%`; });
}

function buildMix(journeys) {
  if (journeysBuilt || !journeys.length || !info) return;
  journeysBuilt = true;
  $('#mix').append(...journeys.map((j, k) => {
    const title = (info.journeys[j] && info.journeys[j].title) || j.replace('_', ' ');
    const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(100 / journeys.length), 'data-journey': j, 'aria-label': `How often customers do: ${title}` });
    input.addEventListener('input', () => { trafficDirty = true; updateMixBar(); });
    const name = h('span', { class: 'field-label' }, h('button', { type: 'button', class: 'jlink', 'data-show-journey': j, style: `border-color:${PALETTE[k % PALETTE.length]}` }, title), h('span', { class: 'pct' }, ''));
    return h('div', { class: 'field mix-row' }, name, input);
  }));
  updateMixBar();
}

function syncTraffic(cfg) {
  if (!cfg || trafficDirty || !cfg.running) return;
  const set = (id, v, fmt = (x) => x) => { const el = $(id); if (idle(el)) { el.value = v; const o = $(`${id}Out`); if (o) o.textContent = fmt(v); } };
  set('#rps', cfg.rps); set('#patience', cfg.patienceSeconds); set('#existing', Math.round(cfg.existingUserRatio * 100), (v) => `${v}%`);
  const radio = $(`input[name=shape][value=${cfg.shape}]`);
  if (radio) radio.checked = true;
  for (const [j, w] of Object.entries(cfg.mix || {})) { const i = $(`[data-journey=${j}]`); if (i && idle(i)) i.value = w; }
  updateMixBar();
}

function renderStats(s) {
  if (!s) return;
  $('#loadStats').innerHTML = [['started', s.started], ['completed', s.completed], ['abandoned', s.abandoned], ['errors', s.errors], ['in flight', s.inflight]].map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
}

function trafficBody() {
  const mix = {};
  $$('[data-journey]').forEach((i) => { mix[i.dataset.journey] = Number(i.value); });
  return { rps: Number($('#rps').value), shape: $('input[name=shape]:checked').value, patienceSeconds: Number($('#patience').value), existingUserRatio: Number($('#existing').value) / 100, mix };
}

/* ---------- stress ---------- */
function tickStress() {
  const el = $('#stressState');
  el.classList.toggle('on', !!stressInfo);
  $('#panicTop').hidden = !stressInfo;
  if (!stressInfo) { el.textContent = 'Idle'; return; }
  const left = Math.max(0, Math.round((stressInfo.endsAt - Date.now()) / 1000));
  el.textContent = `Running on ${stressInfo.target}: ${stressInfo.cpuPct}% CPU, ${stressInfo.memoryMB} MB, stops in ${left}s`;
}
setInterval(tickStress, 1000);

/* ---------- logs and metrics ---------- */
function syncStyle(f) {
  if (!f || blind) return;
  const put = (id, v, fmt) => { const el = $(id); if (idle(el)) { el.value = v; $(`${id}Out`).textContent = fmt(v); } };
  if (!$('#logs').matches(':focus-within')) {
    const radio = $(`input[name=logFormat][value=${f.style.format}]`);
    if (radio) radio.checked = true;
    put('#logVolume', f.style.volume, (v) => v); put('#logNoise', Math.round(f.style.noise * 100), (v) => `${v}%`);
    $('#logSensitive').checked = f.style.sensitive;
  }
  if (!$('#metrics').matches(':focus-within')) {
    put('#basket', Math.round(f.metrics.basketValueScale * 10), (v) => `${(v / 10).toFixed(1)}x`); put('#discount', Math.round(f.metrics.discountRate * 100), (v) => `${v}%`);
    $('#cardinality').checked = f.metrics.cardinalityExplosion;
  }
}

function syncOutcomes(services) {
  if (blind) return;
  for (const o of OUTCOMES) {
    const f = services[o.owner] && services[o.owner].faults;
    const input = $(`[data-outcome=${o.key}]`);
    if (f && idle(input)) { input.value = Math.round(f.business[o.key] * 100); input.nextElementSibling.textContent = `${input.value}%`; }
  }
}

/* ---------- render and refresh ---------- */
function render() {
  if (!state) return;
  const all = Object.values(state.services).flatMap((v) => v.instances);
  setConn(true, `Live: ${all.filter((i) => i.status === 'up').length} of ${all.length} running`);
  const prof = $('#profile'); prof.hidden = false; prof.textContent = `${state.profile} profile`;
  buildMix(state.journeys || []);
  syncTraffic(state.load); renderStats(state.loadStats);
  stressInfo = state.stress && state.stress.active ? state.stress.active : null; tickStress();
  const first = Object.values(state.services).find((v) => v.faults);
  if (first) syncStyle(first.faults);
  syncOutcomes(state.services);
  renderServices(); renderNow(); renderGuide(); renderLookup();
}

async function refresh() {
  if (document.hidden) return;
  if (!info) { const r = await api('GET', '/api/info', undefined, true); if (r.ok) info = r.data; }
  const [st, biz] = await Promise.all([api('GET', '/api/state', undefined, true), api('GET', '/api/business', undefined, true)]);
  if (!st.ok) { setConn(false, st.offline ? 'Cannot reach BreakShop' : 'BreakShop is not responding'); return; }
  state = st.data;
  if (biz.ok) renderBusiness(biz.data);
  render();
}

/* ---------- wiring ---------- */
buildOutcomes();
const range = (id, outId, fmt) => { const el = $(id); const out = $(outId); el.addEventListener('input', () => { out.textContent = fmt(el.value); }); };
range('#rps', '#rpsOut', (v) => v); range('#existing', '#existingOut', (v) => `${v}%`);
range('#logVolume', '#logVolumeOut', (v) => v); range('#logNoise', '#logNoiseOut', (v) => `${v}%`);
range('#basket', '#basketOut', (v) => `${(v / 10).toFixed(1)}x`); range('#discount', '#discountOut', (v) => `${v}%`);
['#rps', '#patience', '#existing'].forEach((id) => $(id).addEventListener('input', () => { trafficDirty = true; }));
$$('input[name=shape]').forEach((r) => r.addEventListener('change', () => { trafficDirty = true; }));

async function startTraffic(body) {
  const r = await api('PUT', '/api/load', body);
  if (r.ok) { trafficDirty = false; toast('Traffic applied'); markStep('traffic'); refresh(); }
}
$('#loadStart').addEventListener('click', () => startTraffic(trafficBody()));
$('#guideTraffic').addEventListener('click', () => {
  const mix = {};
  (state ? state.journeys : []).forEach((j) => { mix[j] = 1; });
  startTraffic({ rps: 10, shape: 'steady', patienceSeconds: 8, existingUserRatio: 0.3, mix });
});
$('#loadStop').addEventListener('click', () => api('POST', '/api/load/stop').then(() => { trafficDirty = false; toast('Traffic stopped'); refresh(); }));
$('#stressGo').addEventListener('click', () => api('POST', '/api/stress', { target: $('#stressTarget').value, cpuPct: Number($('#stressCpu').value), memoryMB: Number($('#stressMem').value), durationSec: Number($('#stressDur').value) }).then((r) => { if (r.ok) { toast('Stress started'); refresh(); } }));
const panic = () => api('POST', '/api/panic').then(() => { toast('All stress stopped'); refresh(); });
$('#panic').addEventListener('click', panic); $('#panicTop').addEventListener('click', panic);
$('#logApply').addEventListener('click', () => api('PUT', '/api/logs', { format: $('input[name=logFormat]:checked').value, volume: Number($('#logVolume').value), noise: Number($('#logNoise').value) / 100, sensitive: $('#logSensitive').checked }).then((r) => { if (r.ok) { toast('Logging changed'); markStep('break'); } }));
$('#metricsApply').addEventListener('click', () => api('PUT', '/api/metrics', { basketValueScale: Number($('#basket').value) / 10, discountRate: Number($('#discount').value) / 100, cardinalityExplosion: $('#cardinality').checked }).then((r) => { if (r.ok) { toast('Metrics changed'); markStep('break'); } }));
$('#randomize').addEventListener('click', () => api('POST', '/api/randomize').then((r) => { if (r.ok) { toast(blind ? 'Something has been injected. Blind mode keeps it hidden.' : 'Something has been injected'); markStep('break'); refresh(); } }));
$('#reset').addEventListener('click', () => api('POST', '/api/reset').then((r) => { if (r.ok) { trafficDirty = false; toast('Back to normal: faults cleared, copies reset, traffic and stress stopped'); refresh(); } }));
$('#blind').addEventListener('change', (e) => setBlind(e.target.checked));
document.body.classList.toggle('blind', blind);
$('#blind').checked = blind;
