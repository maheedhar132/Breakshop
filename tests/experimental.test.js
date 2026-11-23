const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createDirectoryFromEnv } = require('../lib/bs-core/directory');

const root = path.join(__dirname, '..');
const topo = JSON.parse(fs.readFileSync(path.join(root, 'topology.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('experimental README first line says experimental and untested', () => {
  assert.match(read('experimental/README.md').split('\n')[0], /EXPERIMENTAL AND UNTESTED/);
});

test('compose.yml and the Kubernetes file mention every process name in topology.json', () => {
  const compose = read('experimental/docker/compose.yml');
  const k8s = read('experimental/k8s/breakshop.yaml');
  for (const n of topo.profiles.full) {
    assert.ok(compose.includes(`  ${n}:`), `compose: ${n}`);
    assert.ok(k8s.includes(`name: ${n}`), `k8s: ${n}`);
  }
  assert.match(compose.split('\n')[0], /EXPERIMENTAL AND UNTESTED/);
});

test('a fixed directory from BS_STATIC_DIRECTORY resolves without a supervisor', () => {
  process.env.BS_STATIC_DIRECTORY = JSON.stringify({ payment: [{ host: 'payment', port: 5720 }, { host: 'payment-2', port: 5720 }] });
  try {
    const d = createDirectoryFromEnv();
    assert.deepStrictEqual(d.resolve('payment').map((i) => i.host), ['payment', 'payment-2']);
    assert.deepStrictEqual(d.resolve('nothing'), []);
  } finally { delete process.env.BS_STATIC_DIRECTORY; }
});
