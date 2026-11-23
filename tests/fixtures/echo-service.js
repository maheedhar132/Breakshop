const { createService, main } = require('../../lib/bs-core/server');

const svc = createService({
  name: process.env.BS_INSTANCE ? process.env.BS_INSTANCE.replace(/-\d+$/, '') : 'echo',
  routes: { 'GET /whoami': async () => ({ status: 200, body: { instance: process.env.BS_INSTANCE, pid: process.pid } }) }
});
svc.log.info = () => {};
main(svc);
