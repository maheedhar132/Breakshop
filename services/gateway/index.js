const bs = require('../../lib/bs-core');

const ROUTES = {
  accounts: 'account', orders: 'orders', plans: 'plans', coverage: 'coverage',
  'port-in': 'porting', 'port-out': 'porting', login: 'auth', session: 'auth'
};

// The single entry point: routes /api/<area>/... to the service that owns it.
async function setup({ client }) {
  return {
    'ANY /api/*': async ({ req, params, body }) => {
      const rest = params['*'];
      const service = ROUTES[rest.split('/')[0]];
      if (!service) return { status: 404, body: { error: 'unknown_route', path: '/api/' + rest } };
      const token = req.headers['x-session'];
      if (token) {
        const s = await client.call('auth', { path: `/session?token=${encodeURIComponent(token)}` }).catch(() => null);
        if (s && s.status === 401) return { status: 401, body: { error: 'invalid_session' } };
      }
      const search = new URL(req.url, 'http://local').search;
      const res = await client.call(service, { method: req.method, path: `/${rest}${search}`, body: req.method === 'GET' ? undefined : body, timeoutMs: 15000 });
      return { status: res.status, body: res.body };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('gateway', setup, { db: false });
