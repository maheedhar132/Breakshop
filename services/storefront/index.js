const fs = require('node:fs');
const path = require('node:path');
const bs = require('../../lib/bs-core');

const root = path.join(__dirname, 'public');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const HTML = { 'content-type': 'text/html; charset=utf-8' };
const PAGES = {
  '/': ['home', 'Stay connected'],
  '/account/new': ['join', 'Join BreakTel'],
  '/sim': ['sim', 'Order a SIM'],
  '/broadband': ['broadband', 'Get broadband'],
  '/recharge': ['recharge', 'Top up'],
  '/transfer': ['transfer', 'Switch your number']
};

// The shop window: a shared layout, one fragment per page, and a little browser JavaScript.
async function setup({ client }) {
  const layout = read('layout.html');
  const assets = { 'app.js': ['application/javascript', read('app.js')], 'style.css': ['text/css', read('style.css')] };
  const routes = {
    'GET /static/:file': async ({ params }) => (assets[params.file] ? { status: 200, body: assets[params.file][1], headers: { 'content-type': assets[params.file][0] } } : { status: 404, body: 'not found' }),
    'ANY /api/*': async ({ req, params, body }) => {
      const search = new URL(req.url, 'http://local').search;
      const res = await client.call('gateway', { method: req.method, path: `/api/${params['*']}${search}`, body: req.method === 'GET' ? undefined : body, timeoutMs: 20000 });
      return { status: res.status, body: res.body };
    }
  };
  for (const [route, [file, title]] of Object.entries(PAGES)) {
    const html = layout.replace('{{title}}', title).replace('{{content}}', read(`pages/${file}.html`)).replace(`data-nav="${file}"`, `data-nav="${file}" aria-current="page"`);
    routes[`GET ${route}`] = async () => ({ status: 200, body: html, headers: HTML });
  }
  return routes;
}

module.exports = { setup };
if (require.main === module) bs.run('storefront', setup, { db: false });
