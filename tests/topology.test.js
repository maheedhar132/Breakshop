const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const topo = JSON.parse(fs.readFileSync(path.join(root, 'topology.json'), 'utf8'));

test('ports are unique and copy blocks of 10 do not overlap', () => {
  const starts = Object.values(topo.processes).map((p) => p.port).sort((a, b) => a - b);
  assert.strictEqual(new Set(starts).size, starts.length);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 10, `block overlap at ${starts[i]}`);
  assert.ok(!starts.some((p) => p >= 5550 && p < 5560), 'a process port sits in the supervisor block');
});

test('every profile entry exists in processes', () => {
  for (const [name, list] of Object.entries(topo.profiles)) {
    for (const p of list) assert.ok(topo.processes[p], `${name}: ${p}`);
  }
});

const ENTRIES_READY = true;

test('every entry path is relative with forward slashes and every file exists', () => {
  for (const [name, p] of Object.entries(topo.processes)) {
    assert.ok(!path.isAbsolute(p.entry) && !p.entry.includes('\\'), name);
    if (ENTRIES_READY) assert.ok(fs.existsSync(path.join(root, p.entry)), `${name}: ${p.entry} missing`);
  }
});

test('LICENSE is MIT with the spec copyright line', () => {
  const text = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(text, /MIT License/);
  assert.ok(text.includes('Copyright (c) 2026 Maheedhar Talluri'));
});

test('journeys are listed per profile', () => {
  assert.deepStrictEqual(Object.keys(topo.journeys).sort(), Object.keys(topo.profiles).sort());
});
