const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startCluster } = require('./helpers/cluster');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CRLF = String.fromCharCode(13, 10);
const CR = String.fromCharCode(13);

test('start and stop scripts exist for every system', () => {
  for (const f of ['start.sh', 'stop.sh', 'run.bat', 'stop.bat', 'scripts/install-node.sh', 'scripts/install-node.ps1']) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test('shell scripts quote paths and pass a syntax check', () => {
  for (const f of ['start.sh', 'stop.sh', 'scripts/install-node.sh']) {
    const sh = read(f);
    assert.match(sh, /^#!\/usr\/bin\/env bash/);
    assert.doesNotMatch(sh, /\bcd \$/);
    assert.ok(!sh.includes(CR), `${f} must use Unix line endings`);
    const bash = spawnSync('bash', ['-n', path.join(root, f)]);
    if (!bash.error) assert.strictEqual(bash.status, 0, `${f}: ${bash.stderr}`);
  }
  assert.match(read('start.sh'), /cd "\$\(dirname "\$0"\)"/);
});

test('batch scripts use Windows line endings, setlocal, and quote %~dp0', () => {
  for (const f of ['run.bat', 'stop.bat']) {
    const bat = read(f);
    assert.ok(bat.includes(CRLF), `${f} must use Windows line endings`);
    assert.ok(!bat.split(CRLF).join('').includes('\n'), `${f} has a line ending without a carriage return, which breaks labels in cmd.exe`);
    assert.match(bat, /setlocal/);
    assert.match(bat, /cd \/d "%~dp0"/);
    assert.doesNotMatch(bat, /[^"]%~dp0/);
  }
});

const run = (env) => (process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/c', '.\\run.bat'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })
  : spawnSync('bash', ['start.sh'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' }));

test('the start script uses the Node.js that is already installed and does not download', () => {
  const r = run({ BS_DRY_RUN: '1', BS_AUTO_INSTALL_NODE: '0' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`Using Node.js ${process.versions.node}`), r.stdout);
  assert.doesNotMatch(r.stdout, /download/i);
});

test('when Node.js is too old the start script says which version it found and does not download on its own', () => {
  const r = run({ BS_DRY_RUN: '1', BS_MIN_NODE: '99', BS_AUTO_INSTALL_NODE: '0' });
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stdout.includes(`Node.js ${process.versions.node}`), r.stdout);
  assert.match(r.stdout, /99 or newer/);
  assert.doesNotMatch(r.stdout, /Downloading/);
});

test('README quick start fits in 40 lines and gives no debugging advice', () => {
  const md = read('README.md');
  const quick = md.split(/^## /m).find((s) => s.startsWith('Quick start'));
  assert.ok(quick.split('\n').length <= 40);
  assert.doesNotMatch(md, /dynatrace|datadog|new relic/i);
});

test('ci.yml lists ubuntu, windows and macos on Node 22', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const s of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'node-version: 22']) assert.ok(ci.includes(s), s);
});

test('the supervisor starts from a copy of the repo placed under a path with spaces', { timeout: 90000 }, async () => {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'My Docs ')), 'bread shop copy');
  fs.mkdirSync(copy);
  for (const d of ['lib', 'services', 'partners', 'bus', 'scheduler', 'loadgen', 'control-center', 'supervisor']) fs.cpSync(path.join(root, d), path.join(copy, d), { recursive: true });
  for (const f of ['package.json', 'topology.json']) fs.copyFileSync(path.join(root, f), path.join(copy, f));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'junction');
  const c = await startCluster({ profile: 'lite', rootDir: copy });
  try {
    await c.waitUp(['gateway', 'account', 'check-user-id'], 40000);
    assert.strictEqual((await c.status()).profile, 'lite');
  } finally { await c.stop(); }
});
