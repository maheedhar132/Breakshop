const bs = require('../../lib/bs-core');

// Is fibre available at a postcode? Decided by a stable hash, so the same postcode always gives the same answer.
async function setup() {
  return {
    'GET /coverage': async ({ query }) => {
      const postcode = String(query.postcode || '').toUpperCase().replace(/\s+/g, '');
      if (!postcode) return { status: 400, body: { error: 'postcode is required' } };
      let h = 0;
      for (const ch of postcode) h = (h * 31 + ch.charCodeAt(0)) % 1000;
      await bs.sleep(10 + (h % 30));
      const available = h % 100 < 85;
      return { status: 200, body: { available, maxMbps: available ? [100, 500, 1000][h % 3] : 0 } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('coverage', setup, { db: false });
