const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const BURN_SQL = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 150000) SELECT count(*) AS n FROM c';

function defaultDataDir() {
  return process.env.BS_DATA_DIR || path.join(os.homedir(), '.breakshop', 'data');
}

function openDb(service, opts = {}) {
  const dir = opts.dir || defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(path.join(dir, `${service}.db`), (err) => {
      if (err) return reject(err);
      raw.configure('busyTimeout', 5000);
      const call = (method, sql, params) => new Promise((res, rej) => {
        raw[method](sql, params, function cb(e, out) {
          if (e) return rej(e);
          res(method === 'run' ? { lastID: this.lastID, changes: this.changes } : out);
        });
      });
      // A slow query is real work inside SQLite, so any database driver sees it as a long call.
      async function maybeSlow() {
        const f = opts.faults && opts.faults.get();
        if (!f || !f.slowQuery || !f.slowQueryMs) return;
        const until = Date.now() + f.slowQueryMs;
        while (Date.now() < until) await call('get', BURN_SQL, []);
      }
      const db = {
        run: (sql, ...params) => call('run', sql, params),
        get: async (sql, ...params) => { await maybeSlow(); return call('get', sql, params); },
        all: async (sql, ...params) => { await maybeSlow(); return call('all', sql, params); },
        exec: (sql) => new Promise((res, rej) => raw.exec(sql, (e) => (e ? rej(e) : res()))),
        close: () => new Promise((res) => raw.close(() => res()))
      };
      db.exec('PRAGMA journal_mode=WAL').then(() => resolve(db), reject);
    });
  });
}

module.exports = { openDb, defaultDataDir };
