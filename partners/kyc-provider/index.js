const bs = require('../../lib/bs-core');

// A pretend identity checker: rejects at the business rate set in the Control Center.
function build() {
  const svc = bs.createService({ name: 'kyc-provider' });
  svc.addRoutes({
    'POST /check': async ({ faults }) => {
      await bs.sleep(60 + Math.random() * 140);
      return { status: 200, body: { verified: Math.random() >= faults.get().business.kycRejectedRate } };
    }
  });
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
