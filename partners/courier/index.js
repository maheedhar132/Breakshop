const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// A pretend courier: books a shipment and returns a tracking id.
function build() {
  const svc = bs.createService({ name: 'courier' });
  svc.addRoutes({
    'POST /shipments': async () => {
      await bs.sleep(50 + Math.random() * 100);
      return { status: 201, body: { trackingId: 'TRK-' + crypto.randomBytes(5).toString('hex').toUpperCase() } };
    }
  });
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
