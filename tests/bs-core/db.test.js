const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, defaultDataDir } = require('../../lib/bs-core/db');
const { createFaults } = require('../../lib/bs-core/faults');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bs db '));

test('defaultDataDir is under the user home and not under the repo root', () => {
  delete process.env.BS_DATA_DIR;
  const d = defaultDataDir();
  assert.ok(d.startsWith(os.homedir()));
  assert.ok(!d.startsWith(path.join(__dirname, '..', '..')));
});

test('two handles on one service name share rows (dir with spaces)', async () => {
  const dir = tmp();
  const a = await openDb('shared', { dir });
  const b = await openDb('shared', { dir });
  await a.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
  const r = await a.run('INSERT INTO t (v) VALUES (?)', 'hello');
  assert.ok(r.lastID > 0);
  assert.strictEqual((await b.get('SELECT v FROM t WHERE id = ?', r.lastID)).v, 'hello');
  assert.deepStrictEqual((await a.all('SELECT v FROM t')).map((x) => x.v), ['hello']);
  await a.close(); await b.close();
});

test('journal_mode is wal', async () => {
  const db = await openDb('walcheck', { dir: tmp() });
  assert.strictEqual((await db.get('PRAGMA journal_mode')).journal_mode, 'wal');
  await db.close();
});

test('slowQuery true delays get by slowQueryMs', async () => {
  const faults = createFaults();
  const db = await openDb('slow', { dir: tmp(), faults });
  await db.exec('CREATE TABLE t (v INTEGER)');
  let t = Date.now();
  await db.get('SELECT 1 AS one');
  assert.ok(Date.now() - t < 100);
  faults.patch({ slowQuery: true, slowQueryMs: 200 });
  t = Date.now();
  await db.get('SELECT 1 AS one');
  assert.ok(Date.now() - t >= 195, `took ${Date.now() - t}`);
  await db.close();
});
