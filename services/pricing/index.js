const bs = require('../../lib/bs-core');

const round = (n) => Math.round(n * 100) / 100;

// Works out what a basket costs, including promotions. The Control Center can scale baskets and discounts.
async function setup({ client, faults }) {
  const currency = process.env.BS_CURRENCY || 'GBP';
  return {
    'POST /price': async ({ body }) => {
      const b = body || {};
      const m = faults.get().metrics;
      let gross;
      if (b.recharge !== undefined) gross = Number(b.recharge);
      else {
        const res = await client.call('plans', { path: `/plans/${encodeURIComponent(b.planId || '')}` });
        if (res.status === 404) return { status: 404, body: { error: 'unknown plan' } };
        bs.must(res);
        gross = res.body.monthly + res.body.oneOff;
      }
      if (!(gross > 0)) return { status: 400, body: { error: 'amount must be positive' } };
      gross *= m.basketValueScale;
      const rate = Math.min(1, (b.promoCode ? 0.1 : 0) + m.discountRate);
      const discount = round(gross * rate);
      return { status: 200, body: { amount: round(gross - discount), currency, discount } };
    }
  };
}

module.exports = { setup };
if (require.main === module) bs.run('pricing', setup, { db: false });
