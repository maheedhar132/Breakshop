const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// A pretend card network: answers after a short think, declines at the business rate set in the Control Center.
function build() {
  const svc = bs.createService({ name: 'payment-gateway' });
  svc.addRoutes({
    'POST /authorise': async ({ body, faults }) => {
      await bs.sleep(50 + Math.random() * 150);
      const declined = Math.random() < faults.get().business.paymentDeclinedRate;
      return { status: 200, body: { status: declined ? 'declined' : 'approved', ref: crypto.randomUUID(), amount: body && body.amount } };
    }
  });
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
