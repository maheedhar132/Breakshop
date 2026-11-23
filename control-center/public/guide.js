/* Guidance: the "Now" strip, the start-here guide, help, where to look, and start-up. */
const STEPS = ['traffic', 'shop', 'lookup', 'break'];
const stepDone = (k) => store.get(`bs_step_${k}`) === '1';
const guideHidden = () => store.get('bs_guide_hidden') === '1';

function markStep(k) {
  if (stepDone(k)) return;
  store.set(`bs_step_${k}`, '1');
  if (state) renderGuide();
}

function renderGuide() {
  const g = $('#guide');
  g.hidden = guideHidden();
  if (g.hidden) return;
  const running = !!(state && state.load && state.load.running);
  $$('#guide li').forEach((li) => {
    const k = li.dataset.step;
    const done = stepDone(k) || (k === 'traffic' && running);
    li.classList.toggle('done', done);
    const b = $('b', li);
    let note = $('.sr-only', b);
    if (done && !note) b.insertAdjacentHTML('beforeend', '<span class="sr-only"> (done)</span>');
    if (!done && note) note.remove();
  });
}

function renderNow() {
  if (!state) return;
  const parts = [];
  const load = state.load;
  parts.push(load && load.running ? `Traffic: ${load.rps} a second, ${load.shape}` : 'No traffic yet');
  if (blind) {
    parts.push('Changes hidden (blind mode)');
  } else {
    const names = Object.keys(state.services);
    const changed = names.filter((n) => isChanged(faultsOf(n))).length;
    const extra = names.filter((n) => !NO_COPIES.has(n) && state.services[n].copies > 1).length;
    parts.push(changed ? `${changed} service${changed === 1 ? '' : 's'} changed` : 'Nothing changed');
    if (extra) parts.push(`${extra} with extra copies`);
    const any = Object.values(state.services).find((v) => v.faults);
    const others = [];
    if (any) {
      const s = any.faults.style; const m = any.faults.metrics;
      if (s.format !== 'json' || s.volume > 0 || s.noise > 0 || s.sensitive) others.push('logs');
      if (m.basketValueScale !== 1 || m.discountRate > 0 || m.cardinalityExplosion) others.push('metrics');
    }
    if (OUTCOMES.some((o) => { const f = faultsOf(o.owner); return f && f.business[o.key] > 0; })) others.push('business outcomes');
    if (others.length) parts.push(`${others.join(' and ')} changed`);
  }
  parts.push(stressInfo ? `Stress on ${stressInfo.target}` : 'Stress off');
  $('#now').innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

let lookupSig = '';
function renderLookup() {
  if (!info || !state) return;
  $('#lookLogs').textContent = info.logDir;
  $('#lookData').textContent = info.dataDir;
  $('#lookEvents').textContent = `curl -H "x-bs-token: ${token}" http://localhost:${location.port}/api/events/recent`;
  const urls = Object.keys(info.services).filter((n) => faultsOf(n)).map((n) => {
    const i = state.services[n].instances.find((x) => x.status === 'up') || state.services[n].instances[0];
    return i ? [n, `http://localhost:${i.port}/metrics`] : null;
  }).filter(Boolean);
  const sig = urls.map((u) => u.join('=')).join();
  if (sig !== lookupSig) {
    lookupSig = sig;
    $('#lookMetrics').innerHTML = urls.map(([n, u]) => `<li><span>${n}</span><a href="${u}" target="_blank" rel="noopener">${u}</a></li>`).join('');
  }
  const shop = state.services.storefront && state.services.storefront.instances[0];
  if (shop) $$('#openShop, #guideShop').forEach((a) => { a.href = `http://localhost:${shop.port}`; });
}

/* ---------- wiring ---------- */
['#openShop', '#guideShop'].forEach((id) => $(id).addEventListener('click', () => markStep('shop')));
$('#guideLookup').addEventListener('click', () => markStep('lookup'));
$('#lookMetricsBox').addEventListener('toggle', () => markStep('lookup'));
$('#guideHide').addEventListener('click', () => { store.set('bs_guide_hidden', '1'); renderGuide(); });
$('#helpBtn').addEventListener('click', () => { const d = $('#help'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); });
$('#showGuide').addEventListener('click', () => { store.set('bs_guide_hidden', '0'); const d = $('#help'); if (d.close) d.close(); renderGuide(); $('#guide').scrollIntoView(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const text = $(`#${b.dataset.copy}`).textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; markStep('lookup'); setTimeout(() => { b.textContent = 'Copy'; }, 1600); });
});

if ('IntersectionObserver' in window) {
  const links = Object.fromEntries($$('.rail a').map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    $$('.rail a').forEach((a) => a.classList.remove('active'));
    if (links[e.target.id]) links[e.target.id].classList.add('active');
    if (e.target.id === 'lookup') markStep('lookup');
  }), { rootMargin: '-30% 0px -60% 0px' });
  Object.keys(links).forEach((id) => io.observe($(`#${id}`)));
}

refresh();
setInterval(refresh, 2000);
