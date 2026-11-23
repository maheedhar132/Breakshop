const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').length;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('every service is at most 250 lines (warns above 150)', () => {
  const dir = path.join(root, 'services');
  for (const name of fs.readdirSync(dir)) {
    const n = lines(path.join(dir, name, 'index.js'));
    if (n > 150) console.warn(`budget: services/${name} is ${n} lines (target 150)`);
    assert.ok(n <= 250, `services/${name} is ${n} lines`);
  }
});

test('lib/bs-core totals at most 900 lines (warns above 600)', () => {
  const dir = path.join(root, 'lib', 'bs-core');
  const total = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).reduce((s, f) => s + lines(path.join(dir, f)), 0);
  if (total > 600) console.warn(`budget: lib/bs-core is ${total} lines (target 600)`);
  assert.ok(total <= 900, `lib/bs-core is ${total} lines`);
});

test('no source file names a vendor, product or course', () => {
  const dirs = ['lib', 'services', 'partners', 'bus', 'scheduler', 'loadgen', 'control-center', 'supervisor'];
  for (const d of dirs) {
    for (const f of walk(path.join(root, d))) {
      if (!/\.(js|html|css)$/.test(f)) continue;
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /dynatrace|datadog|new relic|oneagent|isha|opentelemetry/i, path.relative(root, f));
    }
  }
});

test('the only third-party dependency is sqlite3', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies), ['sqlite3']);
  assert.ok(!pkg.devDependencies);
});
