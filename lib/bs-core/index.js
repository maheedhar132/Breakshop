const trace = require('./trace');
const { createLogger } = require('./log');
const { createFaults } = require('./faults');
const { createMetrics } = require('./metrics');
const { createService, main, sleep } = require('./server');
const { openDb, defaultDataDir } = require('./db');
const { createDirectory, createDirectoryFromEnv, getJson } = require('./directory');
const { createClient, ServiceUnavailableError, DependencyError } = require('./client');
const { FLOWS, stepIndex } = require('./flows');
const { createEvents } = require('./events');
const { createBus } = require('./bus');

// Starts one service process: `setup(ctx)` returns the routes. Each service file is just its business code.
async function run(name, setup, opts = {}) {
  const svc = createService({ name });
  const directory = createDirectoryFromEnv();
  const client = createClient({ directory, faults: svc.faults });
  const events = createEvents({ service: name, log: svc.log });
  const bus = createBus({ client });
  const db = opts.db === false ? null : await openDb(name, { faults: svc.faults });
  const ctx = { name, db, client, events, bus, log: svc.log, faults: svc.faults, metrics: svc.metrics, svc };
  svc.addRoutes(await setup(ctx));
  await directory.start();
  await main(svc, async () => { directory.stop(); if (db) await db.close(); });
}

module.exports = {
  ...trace, createLogger, createFaults, createMetrics, createService, main, sleep, openDb, defaultDataDir,
  createDirectory, createDirectoryFromEnv, getJson, createClient, ServiceUnavailableError, DependencyError,
  FLOWS, stepIndex, createEvents, createBus, run, must: require('./client').must
};
