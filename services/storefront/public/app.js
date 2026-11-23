// Every request from this page starts a W3C trace, so one click is one trace id all the way through.
function newTraceparent() {
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `00-${hex(16)}-${hex(8)}-01`;
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' });
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
};

async function api(path, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch('/api/' + path, { ...options, signal: ctl.signal, headers: { 'content-type': 'application/json', traceparent: newTraceparent(), ...(options.headers || {}) } });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, data, trace: (res.headers.get('traceparent') || '').split('-')[1] };
  } catch (e) {
    return { status: 0, data: null, error: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

/* account chip */
function renderAccount() {
  const id = store.get('bs_customer');
  $('#account').innerHTML = id
    ? `<span class="chip-acct">Account <code>${esc(id)}</code></span><button type="button" class="link" id="signout">Sign out</button>`
    : '<a class="btn btn-primary btn-sm" href="/account/new">Create account</a>';
  const out = $('#signout');
  if (out) out.addEventListener('click', () => { store.del('bs_customer'); renderAccount(); $$('input[name=customerId]').forEach((i) => { i.value = ''; }); });
}
renderAccount();
$$('input[name=customerId]').forEach((i) => { i.value = store.get('bs_customer') || ''; });

/* plans */
let plansPromise = null;
const loadPlans = () => (plansPromise = plansPromise || api('plans').then((r) => { if (r.status !== 200) plansPromise = null; return r; }));
const price = (p) => `${gbp.format(p.monthly)}/month`;

async function renderHomePlans() {
  const box = $('#plans');
  if (!box) return;
  box.setAttribute('aria-busy', 'true');
  const r = await loadPlans();
  box.setAttribute('aria-busy', 'false');
  const plans = (r.data && r.data.plans) || [];
  if (r.status !== 200 || !plans.length) {
    box.innerHTML = '<div class="notice" role="alert">We could not load our plans just now. <button type="button" class="link" id="retryPlans">Try again</button></div>';
    $('#retryPlans').addEventListener('click', renderHomePlans);
    return;
  }
  const group = (title, type, href) => `<div class="plan-group"><h3>${title}</h3><div class="plan-row">${plans.filter((p) => p.type === type).map((p) => `
    <article class="plan"><h4>${esc(p.name)}</h4><p class="price">${gbp.format(p.monthly)}<small>/month</small></p>${p.oneOff ? `<p class="muted">plus ${gbp.format(p.oneOff)} set-up</p>` : '<p class="muted">No set-up fee</p>'}
    <a class="btn btn-outline" href="${href}?plan=${encodeURIComponent(p.planId)}">Choose<span class="sr-only"> ${esc(p.name)}</span></a></article>`).join('')}</div></div>`;
  box.innerHTML = group('SIM plans', 'sim', '/sim') + group('Broadband', 'broadband', '/broadband');
}

async function renderPlanPickers() {
  const wanted = new URLSearchParams(location.search).get('plan');
  for (const box of $$('[data-plans]')) {
    const r = await loadPlans();
    const list = ((r.data && r.data.plans) || []).filter((p) => p.type === box.dataset.plans);
    if (r.status !== 200 || !list.length) { box.innerHTML = '<div class="notice" role="alert">We could not load the plans. Refresh the page to try again.</div>'; continue; }
    box.innerHTML = list.map((p, i) => `<label class="plan-opt"><input type="radio" name="planId" value="${esc(p.planId)}" ${p.planId === wanted || (!wanted && i === 0) ? 'checked' : ''}><span><b>${esc(p.name)}</b><i>${price(p)}</i></span></label>`).join('');
  }
}

/* forms */
function fieldError(input, message) {
  const field = input.closest('.field');
  let el = field.querySelector('.error');
  if (!message) { if (el) el.remove(); input.removeAttribute('aria-invalid'); return; }
  if (!el) { el = Object.assign(document.createElement('p'), { className: 'error', id: `err-${input.name}` }); field.append(el); }
  el.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', el.id);
}

function validate(form) {
  let first = null;
  for (const input of $$('input[required]', form)) {
    if (input.closest('[hidden]') || input.type === 'radio') continue;
    const name = ($(`label[for=${input.id}]`) || { textContent: input.name }).textContent.toLowerCase().replace(/\bid\b/, 'ID');
    let msg = '';
    if (!input.value.trim()) msg = `Enter your ${name}`;
    else if (input.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.value)) msg = 'Enter an email address like name@example.com';
    else if (input.type === 'number' && !(Number(input.value) >= Number(input.min || 1))) msg = `The ${name} must be at least ${input.min || 1}`;
    fieldError(input, msg);
    if (msg && !first) first = input;
  }
  const radios = $$('input[name=planId]', form);
  if (radios.length && !radios.some((r) => r.checked)) { const box = $('[data-plans]', form); box.insertAdjacentHTML('afterend', '<p class="error" role="alert">Choose a plan</p>'); }
  if (first) first.focus();
  return !first;
}

const rowsHtml = (rows) => `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
function outcome(endpoint, type, r) {
  const d = r.data || {};
  if (r.status === 0) return { kind: 'bad', title: 'We could not reach BreakTel', text: r.error === 'timeout' ? 'This is taking longer than usual. Please try again in a moment.' : 'Check your connection and try again.' };
  if (r.status >= 500) return { kind: 'bad', title: 'Something went wrong on our side', text: 'Nothing has been charged. Please try again in a moment.' };
  if (r.status === 201 || r.status === 202) {
    if (endpoint === 'accounts') return { kind: 'ok', title: 'Welcome to BreakTel', text: 'Your account is ready.', rows: [['Customer ID', `<code>${esc(d.customerId)}</code>`]] };
    if (endpoint.startsWith('port-')) return { kind: 'ok', title: 'Transfer started', text: 'We will text you when it is complete.', rows: [['Transfer reference', `<code>${esc(d.portId)}</code>`]] };
    const rows = [['Order', `<code>${esc(d.orderId)}</code>`]];
    if (d.number) rows.push(['Your number', esc(d.number)]);
    return { kind: 'ok', title: type === 'recharge' ? 'Top-up complete' : type === 'sim' ? 'Your SIM is on its way' : 'Broadband ordered', text: type === 'recharge' ? 'Your credit has been added.' : 'We will send you a message when it is active.', rows };
  }
  const map = {
    already_registered: { kind: 'warn', title: 'You already have an account', text: 'That email or number is already registered.', use: d.customerId },
    identity_rejected: { kind: 'warn', title: 'We could not verify your ID', text: 'Check the document number and try again.' },
    payment_declined: { kind: 'warn', title: 'Your payment was declined', text: 'Nothing has been charged. Try another card or try again later.' },
    number_unavailable: { kind: 'warn', title: 'No number available right now', text: 'Please try again in a few minutes.' },
    out_of_stock: { kind: 'warn', title: 'That one is out of stock', text: 'Pick another plan or try again later.' },
    no_coverage: { kind: 'warn', title: 'Not available at that postcode yet', text: 'We are not in your area yet. Try another postcode.' }
  };
  if (map[d.error]) return map[d.error];
  if (r.status === 404) return { kind: 'warn', title: 'We could not find that', text: 'Check the details and try again.' };
  return { kind: 'warn', title: 'We could not complete that', text: d.error ? String(d.error).replace(/_/g, ' ') : 'Please check your details and try again.' };
}

function showResult(box, o, r) {
  const ref = r.trace ? `<dt>Reference</dt><dd><code>${esc(r.trace)}</code> <button type="button" class="link" data-copy="${esc(r.trace)}">Copy</button></dd>` : '';
  const icon = o.kind === 'ok' ? 'check' : 'alert';
  box.className = `result ${o.kind}`;
  box.innerHTML = `<h2><svg class="ic" aria-hidden="true"><use href="#i-${icon}"/></svg>${esc(o.title)}</h2><p>${esc(o.text || '')}</p>${o.rows ? rowsHtml(o.rows) : ''}
    ${o.use ? `<div class="actions"><button type="button" class="btn btn-outline btn-sm" data-use="${esc(o.use)}">Use ${esc(o.use)}</button></div>` : ''}
    <dl>${ref}</dl><details><summary>Technical details</summary><pre>${esc(JSON.stringify({ status: r.status, body: r.data }, null, 2))}</pre></details>`;
  box.hidden = false;
  box.focus();
  box.scrollIntoView({ block: 'nearest' });
  const copy = $('[data-copy]', box);
  if (copy) copy.addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(copy.dataset.copy).then(() => { copy.textContent = 'Copied'; }); });
  const use = $('[data-use]', box);
  if (use) use.addEventListener('click', () => { store.set('bs_customer', use.dataset.use); renderAccount(); use.textContent = 'Saved as your account'; use.disabled = true; });
}

function wireForm(form) {
  const box = $('#result');
  $$('.quick .chip', form).forEach((chip) => chip.addEventListener('click', () => {
    $('#amount', form).value = chip.dataset.amount;
    $$('.quick .chip', form).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  }));
  $$('input', form).forEach((i) => i.addEventListener('input', () => fieldError(i, '')));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    $$('.error[role=alert]', form).forEach((e) => e.remove());
    if (!validate(form)) return;
    const body = Object.fromEntries(new FormData(form).entries());
    if (body.amount) body.amount = Number(body.amount);
    if (form.dataset.type) body.type = form.dataset.type;
    let endpoint = form.dataset.endpoint;
    if (form.hasAttribute('data-direction')) { endpoint = `port-${body.direction}`; delete body.direction; }
    const button = $('button[type=submit]', form);
    const label = button.textContent;
    button.disabled = true; button.innerHTML = '<span class="spin" aria-hidden="true"></span>Working'; form.setAttribute('aria-busy', 'true');
    const r = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    button.disabled = false; button.textContent = label; form.removeAttribute('aria-busy');
    if (r.data && r.data.customerId && endpoint === 'accounts' && r.status === 201) { store.set('bs_customer', r.data.customerId); renderAccount(); }
    showResult(box, outcome(endpoint, form.dataset.type, r), r);
  });
}

const dir = $$('input[name=direction]');
if (dir.length) {
  const only = $('[data-only]');
  dir.forEach((r) => r.addEventListener('change', () => { if (r.checked) only.hidden = r.value === 'out'; }));
}
$$('form.form').forEach(wireForm);
renderHomePlans();
renderPlanPickers();
