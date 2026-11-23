/* Services: the map, the list, the inspector, copies and the journey explorer. */
const ROLE_LABEL = { edge: 'Front door', core: 'Shop service', async: 'Works from a queue', partner: 'Outside partner' };
const NODE_W = 112, NODE_H = 40, COL_GAP = 22, ROW_GAP = 12, PAD = 20;

let selected = null;
let journeyShown = null;
let view = store.get('bs_view') || (matchMedia('(min-width: 961px)').matches ? 'map' : 'list');
let mapBuilt = false;
let inspFor = null;
const nodeEls = {};
let edgeEls = [];
let controls = { sliders: {}, toggles: {} };

const faultsOf = (name) => (state && state.services[name] && state.services[name].faults) || null;
const isChanged = (f) => !!f && (SLIDERS.some((s) => f[s.key] > 0) || TOGGLES.some((t) => f[t.key]));
const calledBy = (name) => Object.keys(info.services).filter((n) => info.services[n].calls.includes(name));
const dotsHtml = (instances, r, gap) => instances.slice(0, 6).map((i, k) => `<circle class="d ${i.status}" cx="${k * gap + r}" cy="0" r="${r}"/>`).join('');

function matches(name) {
  const q = $('#serviceFilter').value.trim().toLowerCase();
  if (q && !name.includes(q)) return false;
  return !($('#changedOnly').checked && !blind && !isChanged(faultsOf(name)));
}

/* ---------- map ---------- */
let pos = {};
function buildMap() {
  const names = Object.keys(info.services);
  const cols = Array.from({ length: 6 }, () => []);
  names.forEach((n) => cols[info.services[n].layer].push(n));
  const rows = Math.max(...cols.map((c) => c.length));
  const W = PAD * 2 + 6 * NODE_W + 5 * COL_GAP;
  const H = PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP;
  cols.forEach((list, c) => {
    const total = list.length * NODE_H + (list.length - 1) * ROW_GAP;
    const top = PAD + (H - PAD * 2 - total) / 2;
    list.forEach((n, i) => { pos[n] = { x: PAD + c * (NODE_W + COL_GAP), y: top + i * (NODE_H + ROW_GAP) }; });
  });
  const edges = [];
  for (const [from, s] of Object.entries(info.services)) {
    for (const to of s.calls) {
      const a = pos[from]; const b = pos[to];
      const fwd = info.services[to].layer > s.layer;
      const x1 = fwd ? a.x + NODE_W : a.x; const x2 = fwd ? b.x : b.x + NODE_W;
      const y1 = a.y + NODE_H / 2; const y2 = b.y + NODE_H / 2;
      const dx = Math.max(Math.abs(x2 - x1) / 2, 24) * (fwd ? 1 : -1);
      edges.push(`<path class="edge${s.later ? ' later' : ''}" data-from="${from}" data-to="${to}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" marker-end="url(#arr)"/>`);
    }
  }
  const nodes = names.map((n) => {
    const p = pos[n]; const s = info.services[n];
    return `<g class="node role-${s.role}" data-name="${n}" tabindex="0" role="button" aria-label="${n}. ${ROLE_LABEL[s.role]}. ${s.does}" transform="translate(${p.x} ${p.y})">
      <rect class="box" width="${NODE_W}" height="${NODE_H}" rx="9"/><rect class="strip" width="5" height="${NODE_H}" rx="2.5"/>
      <text class="label" x="14" y="17">${n}</text><g class="dots" transform="translate(14 29)"></g></g>`;
  });
  $('#map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * 0.78)}px"><defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" class="arrowhead"/></marker></defs><g class="edges">${edges.join('')}</g><g class="nodes">${nodes.join('')}</g></svg>`;
  $$('#map .node').forEach((g) => { nodeEls[g.dataset.name] = { g, dots: g.querySelector('.dots') }; });
  edgeEls = $$('#map .edge');
  $('#map').addEventListener('click', (e) => { const g = e.target.closest('.node'); if (g) select(g.dataset.name); });
  $('#map').addEventListener('keydown', (e) => { const g = e.target.closest('.node'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.name, true); } });
}

function updateMap() {
  const inJourney = journeyShown ? new Set(info.journeys[journeyShown].services) : null;
  for (const [name, ref] of Object.entries(nodeEls)) {
    const st = state.services[name];
    ref.dots.innerHTML = st ? dotsHtml(st.instances, 4, 12) : '';
    const g = ref.g;
    g.classList.toggle('selected', name === selected);
    g.classList.toggle('chg', !blind && isChanged(faultsOf(name)));
    g.classList.toggle('dim', !matches(name) || (!!inJourney && !inJourney.has(name)));
    g.classList.toggle('hl', !!inJourney && inJourney.has(name));
  }
  $('#map svg').classList.toggle('has-sel', !!selected || !!inJourney);
  for (const e of edgeEls) {
    const a = e.dataset.from; const b = e.dataset.to;
    e.classList.toggle('on', !!selected && (a === selected || b === selected));
    e.classList.toggle('hlon', !!inJourney && inJourney.has(a) && inJourney.has(b));
  }
}

/* ---------- list ---------- */
function buildList() {
  const names = Object.keys(info.services).sort((a, b) => info.services[a].layer - info.services[b].layer || a.localeCompare(b));
  $('#listView').append(...names.map((n) => {
    const b = h('button', { type: 'button', class: `svc-item role-${info.services[n].role}`, 'data-name': n });
    b.innerHTML = `<i class="role-dot"></i><span class="svc-name">${n}</span><span class="svc-dots"></span><span class="svc-tags"></span>`;
    b.addEventListener('click', () => select(n));
    return b;
  }));
}

function updateList() {
  const inJourney = journeyShown ? new Set(info.journeys[journeyShown].services) : null;
  $$('#listView .svc-item').forEach((b) => {
    const n = b.dataset.name; const st = state.services[n]; const f = faultsOf(n);
    b.hidden = !matches(n);
    b.classList.toggle('selected', n === selected);
    b.classList.toggle('hl', !!inJourney && inJourney.has(n));
    $('.svc-dots', b).innerHTML = st ? st.instances.map((i) => `<i class="dot ${i.status}" title="${i.id}: ${i.status}"></i>`).join('') : '';
    $('.svc-tags', b).innerHTML = !blind && isChanged(f) ? '<span class="tag">changed</span>' : '';
  });
}

function updateCount() {
  const names = Object.keys(info.services);
  $('#serviceCount').textContent = `${names.filter(matches).length} of ${names.length} services`;
  $('#changedOnlyWrap').hidden = blind;
}

/* ---------- inspector ---------- */
function buildInspector() {
  const box = $('#inspControls');
  const send = (patch) => { if (!selected) return; api('PUT', `/api/services/${selected}/faults`, patch).then(refresh); markStep('break'); };
  for (const s of SLIDERS) {
    const input = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: 0 });
    const out = h('output', {}, `0${s.unit}`);
    input.addEventListener('input', () => { out.textContent = `${input.value}${s.unit}`; });
    input.addEventListener('change', () => send({ [s.key]: Number(input.value) * s.scale }));
    box.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, s.label), h('span', { class: 'range' }, input, out), h('span', { class: 'help' }, s.help)));
    controls.sliders[s.key] = { input, out, def: s };
  }
  for (const t of TOGGLES) {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => send(t.key === 'slowQuery' ? { slowQuery: input.checked, slowQueryMs: 1000 } : { [t.key]: input.checked }));
    box.append(h('div', { class: 'field' }, h('label', { class: 'switch' }, input, h('span', { class: 'switch-ui', 'aria-hidden': 'true' }), h('span', {}, t.label)), h('span', { class: 'help' }, t.help)));
    controls.toggles[t.key] = input;
  }
  const setCopies = (n) => n >= 1 && n <= 9 && selected && api('PUT', `/api/services/${selected}/copies`, { copies: n }).then(refresh);
  $('#copyDec').addEventListener('click', () => setCopies(Number($('#copyCount').textContent) - 1));
  $('#copyInc').addEventListener('click', () => setCopies(Number($('#copyCount').textContent) + 1));
  $('#inspReset').addEventListener('click', () => selected && api('PUT', `/api/services/${selected}/faults`, CLEAN).then((r) => { if (r.ok) { toast(`${selected} is back to normal`); refresh(); } }));
  $('#inspector').addEventListener('click', (e) => { const b = e.target.closest('[data-select]'); if (b) select(b.dataset.select); });
}

function relChips(names) {
  return names.length ? names.map((n) => `<button type="button" class="rel-chip" data-select="${n}">${n}</button>`).join('') : '<span class="muted">nothing</span>';
}

function renderInspector() {
  $('#inspEmpty').hidden = !!selected;
  $('#inspBody').hidden = !selected;
  if (!selected) return;
  const s = info.services[selected]; const st = state.services[selected]; const f = faultsOf(selected);
  $('#inspTitle').textContent = selected;
  const role = $('#inspRole'); role.textContent = ROLE_LABEL[s.role]; role.className = `role role-${s.role}`;
  $('#inspDoes').textContent = s.does;
  $('#inspCalls').innerHTML = relChips(s.calls);
  $('#inspCalledBy').innerHTML = relChips(calledBy(selected));
  $('#inspControls').hidden = !f;
  $('#copies').hidden = !f || NO_COPIES.has(selected);
  $('#inspReset').hidden = !f;
  $('#inspBlind').hidden = !(blind && f);
  const fresh = inspFor !== selected;
  inspFor = selected;
  if (f && (!blind || fresh)) {
    for (const { input, out, def } of Object.values(controls.sliders)) {
      const v = blind ? 0 : Math.round(f[def.key] / def.scale);
      if (fresh || idle(input)) { input.value = v; out.textContent = `${v}${def.unit}`; }
    }
    for (const [key, input] of Object.entries(controls.toggles)) if (fresh || idle(input)) input.checked = blind ? false : !!f[key];
  }
  if (st) {
    $('#copyCount').textContent = st.copies;
    const inst = $('#inspInst');
    const sig = `${selected}|${st.instances.map((i) => `${i.id}:${i.status}`).join()}`;
    if (inst.dataset.sig !== sig) {
      inst.dataset.sig = sig;
      inst.replaceChildren(...st.instances.map((i) => {
        const up = i.status === 'up';
        const b = h('button', { type: 'button', class: up ? '' : 'is-down', 'aria-label': `${up ? 'Break' : 'Start'} copy ${Number(i.id.split('-').pop()) + 1} of ${selected}` }, `Copy ${Number(i.id.split('-').pop()) + 1} · ${up ? 'Break' : `Start (${i.status})`}`);
        b.insertAdjacentHTML('afterbegin', `<i class="dot ${i.status}" aria-hidden="true"></i>`);
        b.addEventListener('click', () => { api('POST', `/api/services/${selected}/instances/${i.id}/${up ? 'stop' : 'start'}`).then(refresh); markStep('break'); });
        return b;
      }));
    }
    const first = st.instances.find((i) => i.status === 'up') || st.instances[0];
    const link = $('#inspMetrics');
    link.hidden = !first || !f;
    if (first) link.href = `http://localhost:${first.port}/metrics`;
  }
}

function select(name, fromKeyboard) {
  selected = name;
  renderServices();
  if (fromKeyboard) $('#inspTitle').focus();
  if (!matchMedia('(min-width: 1100px)').matches) $('#inspector').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------- journeys ---------- */
function showJourney(name) {
  if (journeyShown === name) { clearJourney(); return; }
  journeyShown = name;
  const j = info.journeys[name];
  const box = $('#journeyInfo');
  box.hidden = false;
  box.innerHTML = `<header><h3>${j.title}</h3><button type="button" class="btn btn-ghost btn-sm" id="journeyClose">${icon('x')}Close</button></header>
    <p>${j.blurb}</p>
    <div class="journey-cols"><div><b>Steps</b><ol>${j.steps.map((s) => `<li>${s.replace(/_/g, ' ')}</li>`).join('')}</ol></div>
    <div><b>Services it touches</b><div class="chips-row">${j.services.map((n) => `<button type="button" class="rel-chip" data-select="${n}">${n}</button>`).join('')}</div><p class="muted">They are lit up on the map.</p></div></div>`;
  $('#journeyClose').addEventListener('click', clearJourney);
  $$('[data-show-journey]').forEach((b) => b.classList.toggle('on', b.dataset.showJourney === name));
  box.querySelectorAll('[data-select]').forEach((b) => b.addEventListener('click', () => { select(b.dataset.select); $('#services').scrollIntoView(); }));
  if (state) renderServices();
}

function clearJourney() {
  journeyShown = null;
  $('#journeyInfo').hidden = true;
  $$('[data-show-journey]').forEach((b) => b.classList.remove('on'));
  if (state) renderServices();
}

/* ---------- view, stress targets, entry point ---------- */
function applyView() {
  $('#mapView').hidden = view !== 'map';
  $('#listView').hidden = view !== 'list';
  const radio = $(`input[name=view][value=${view}]`);
  if (radio) radio.checked = true;
}

function fillStressTargets() {
  const sel = $('#stressTarget');
  sel.innerHTML = '<option value="host">Whole machine</option>';
  for (const role of ['edge', 'core', 'async', 'partner']) {
    const g = h('optgroup', { label: ROLE_LABEL[role] });
    Object.keys(info.services).filter((n) => info.services[n].role === role && n !== 'bus').forEach((n) => g.append(new Option(n, n)));
    if (g.children.length) sel.append(g);
  }
}

function renderServices() {
  if (!info || !state) return;
  if (!mapBuilt) { mapBuilt = true; buildMap(); buildList(); buildInspector(); fillStressTargets(); applyView(); }
  updateMap(); updateList(); updateCount(); renderInspector();
}

$('#mix').addEventListener('click', (e) => { const b = e.target.closest('[data-show-journey]'); if (b) showJourney(b.dataset.showJourney); });
$$('input[name=view]').forEach((r) => r.addEventListener('change', () => { view = r.value; store.set('bs_view', view); applyView(); }));
$('#serviceFilter').addEventListener('input', () => renderServices());
$('#changedOnly').addEventListener('change', () => renderServices());
