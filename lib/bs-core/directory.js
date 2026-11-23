const http = require('node:http');

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function createDirectory({ supervisorUrl, refreshMs = 2000 } = {}) {
  let services = {};
  let timer = null;
  async function refresh() {
    try { services = (await getJson(`${supervisorUrl}/directory`)).services || {}; } catch { /* keep the last known list */ }
  }
  return {
    resolve: (name) => (services[name] || []).filter((i) => i.status === 'up'),
    async start() {
      await refresh();
      timer = setInterval(refresh, refreshMs);
      timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    refresh,
    set(next) { services = next; }
  };
}

// Without a supervisor (containers) the directory is a fixed map in BS_STATIC_DIRECTORY: {"name":[{"host":"h","port":1}]}.
function createDirectoryFromEnv() {
  if (process.env.BS_STATIC_DIRECTORY) {
    const fixed = JSON.parse(process.env.BS_STATIC_DIRECTORY);
    const d = createDirectory({ supervisorUrl: 'http://127.0.0.1:1' });
    d.set(Object.fromEntries(Object.entries(fixed).map(([n, list]) => [n, list.map((i, k) => ({ id: `${n}-${k}`, status: 'up', ...i }))])));
    d.start = async () => {};
    d.refresh = async () => {};
    return d;
  }
  return createDirectory({ supervisorUrl: process.env.BS_SUPERVISOR_URL || 'http://127.0.0.1:5550' });
}

module.exports = { createDirectory, createDirectoryFromEnv, getJson };
