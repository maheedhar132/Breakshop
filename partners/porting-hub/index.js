const crypto = require('node:crypto');
const bs = require('../../lib/bs-core');

// A pretend inter-operator porting hub.
function build() {
  const svc = bs.createService({ name: 'porting-hub' });
  svc.addRoutes({
    'POST /port': async () => {
      await bs.sleep(80 + Math.random() * 160);
      return { status: 200, body: { status: 'accepted', portRef: crypto.randomUUID() } };
    }
  });
  return svc;
}

module.exports = { build };
if (require.main === module) bs.main(build());
