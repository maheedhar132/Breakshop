# BreakShop

**A telecom shop built to be broken.**

BreakShop is a small, realistic microservice application for practising observability. A fictional operator, BreakTel, sells broadband and SIM cards online. You run it on your own computer, make it slow, flaky and noisy from a control page, and then use whatever observability tool you like to work out what happened.

It is not tied to any vendor or course. It writes logs, exposes metrics, and carries one trace id through every request, so you can point Dynatrace, Datadog, New Relic, Grafana, Elastic, OpenTelemetry or plain `grep` at it.

There is deliberately no answer key. The Control Center shows what you have set right now, never a history of what was broken or why. Finding the cause is the exercise.

## Contents

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [The shop](#the-shop)
- [The Control Center](#the-control-center)
- [Things to try](#things-to-try)
- [Where the data lives](#where-the-data-lives)
- [Tracing and business events](#tracing-and-business-events)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Control Center API](#control-center-api)
- [Containers (experimental)](#containers-experimental)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Licence](#licence)

## Quick start

You need **Node.js 22 or newer** and about **1.5 GB of free memory** for the full set.

1. Clone this repository.
2. Run the start script for your system:

```
./start.sh            # macOS and Linux
.\run.bat             # Windows (cmd or PowerShell)
```

The script uses the Node.js you already have. If it is missing or too old, the script asks before downloading a private copy that leaves your own Node.js alone. It then installs one dependency (`sqlite3`) and starts everything.

3. Open the Control Center at **http://localhost:2605**. The shop is at **http://localhost:5620**.
4. Stop everything with `./stop.sh` or `.\stop.bat`.

Short on memory? Start the lighter set: `./start.sh lite` or `.\run.bat lite`.

Run it every day, start and stop it as often as you like. Nothing is installed system-wide.

## What you get

| Piece | Count | What it is |
|---|---|---|
| Shop services | 17 | Storefront, gateway, auth, account, check-user-id, kyc, plans, coverage, number-inventory, pricing, orders, payment, billing, provisioning, porting, fulfilment, notifications. Each is its own process with its own SQLite file. |
| Partners | 4 | Pretend outside companies: payment-gateway, kyc-provider, courier, porting-hub. |
| Message bus | 1 | A queue the order flow leaves messages on, so some work happens a moment later. |
| Scheduler | 1 | Background jobs. |
| Load generators | 2 | `loadgen-users` (customer traffic) and `loadgen-resources` (safe CPU and memory stress). |
| Control Center | 1 | The page where you change how everything behaves. |
| Supervisor | 1 | Starts, restarts and stops all of the above and keeps the service directory. |

The full set is 26 processes. The only dependency is `sqlite3`. All databases are in-house SQLite files, so there is nothing to install or log in to.

## The shop

BreakTel's website is a real, clickable store. Customers can:

- **Create an account.** If the person is already registered, the account service is told by `check-user-id` and the journey stops early.
- **Buy a SIM.** Pick a plan and a number, verify identity, pay, then the SIM is shipped and switched on.
- **Buy broadband.** Check the postcode, pay, then an install is booked and the line is switched on.
- **Top up.** Pay a small amount and have it added as credit.
- **Transfer a number in or out** of another operator.

Every purchase has a money value, so a slow or failing service has a visible business cost: orders per minute, revenue per minute, and the value of orders customers gave up on.

## The Control Center

Open http://localhost:2605. A four-step **Start here** guide walks a first-time user through sending customers, visiting the shop, finding the data, and breaking something. **Help** opens a plain-English glossary.

- **Business.** Orders, revenue, and the value of abandoned or failed orders, per minute, with a 60-second trend. Below that, *business outcomes*: make the business say no while nothing is technically broken (payment declined, identity rejected, number unavailable, out of stock).
- **Traffic.** Start or stop pretend customers. Choose customers per second, the load shape (steady, ramp, spike, wave, random), how patient customers are, the share who are already registered, and the mix of journeys. Click a journey name to see which services it touches.
- **Services.** A live map of the shop, with a list view as an alternative. Select a service to read what it does and which services it calls and is called by. Then change it:
  - Latency, errors, timeouts
  - CPU burn, memory leak
  - Slow database query
  - Failing dependencies
  - **Copies:** run several copies of a service (a pretend disaster-recovery setup) and stop or start individual copies. Business numbers stay steady while infrastructure numbers change.
- **Stress.** Raise CPU or memory on a chosen target. Limits are capped to stay safe for a laptop, and **Stop stress** appears only while stress is running.
- **Logs.** Change the log format (JSON, plain, mixed), volume, noise, and whether sensitive values appear.
- **Metrics.** Scale basket values, add discounts, or cause a metrics cardinality explosion.
- **Where to look.** Log and data folders, every service's `/metrics` address, and a command for recent business events.
- **Randomize** breaks something without saying what. **Blind mode** additionally hides which services are changed. **Reset to normal** clears every fault, puts copies back to one, and stops traffic and stress.
- A **Now** strip at the top summarises traffic, changes and stress at a glance.

## Things to try

These are practice scenarios. Nothing in the app tells you the answer.

- Payment gets slow. Which service is the cause, and how much money was lost?
- Orders start failing with no code change. Is it one service, or a dependency?
- Switch on **Randomize** with **Blind mode**, start traffic, and find what changed using only your observability tool.
- Run three copies of `payment`, stop one, and compare business and infrastructure views.
- Turn on a metrics cardinality explosion and see what it does to your tool.
- Turn on sensitive values in logs and find them.
- Follow one customer's trace id from the browser through every service, queue message and log line.

## Where the data lives

- **Logs:** `~/.breakshop/logs`, one file per process.
- **Databases:** SQLite files in the data folder shown on the Control Center's *Where to look* section.
- **Metrics:** every service serves Prometheus text format at `/metrics` on its own port. The Control Center lists each address.
- **Business events:** the last events are available from the Control Center API (see below) and the *Where to look* section shows the exact command.

Point your own agent, collector or log shipper at these. BreakShop does not send data anywhere.

## Tracing and business events

Every journey starts with a standard W3C `traceparent` header, created in the browser or by the load generator. Every service forwards it, every queue message carries it, and every log line includes it. That one id is also the **business flow id**.

Services also report business events: a flow name, a step, and an outcome (`ok`, `business_exception` or `abandoned`), with a money value where relevant. This is what makes revenue and lost-order numbers possible, and it is the raw material for business-flow analysis in any tool.

## Architecture

```
browser / loadgen-users
        |
   storefront (5620)
        |
    gateway (5610)
        |
  account  auth  plans  coverage  orders  porting
     |                      |        |
 check-user-id, kyc     pricing, number-inventory, payment, billing, notifications
                              |
                             bus ---> provisioning, fulfilment
 kyc ---> kyc-provider   payment ---> payment-gateway   fulfilment ---> courier   porting ---> porting-hub
```

- **Supervisor** (`supervisor/`) starts each process, restarts it if it dies, runs copies, and exposes a directory API so services can find each other. Admin calls need a token that the supervisor creates.
- **Shared helpers** (`lib/bs-core`) give every service the same logging, tracing, fault injection, metrics, database access and business events.
- **Faults** are applied per service through a protected admin endpoint, so a change takes effect without a restart.
- **Control Center** (`control-center/`) is a plain Node server plus a static page in plain HTML, CSS and JavaScript. It has no build step and no external requests, so it works offline.
- **Topology** (`topology.json`) lists every process, its port and its profile (`full` or `lite`).

### Ports

Control Center 2605 · Supervisor 5550 · Bus 5600 · Gateway 5610 · Storefront 5620 · other services from 5630 upward in steps of 10 (see `topology.json`). A service with several copies uses the next ports in its block.

## Configuration

Everything has a sensible default. These environment variables change it:

| Variable | Meaning |
|---|---|
| `BS_CONTROL_CENTER_PORT` | Move the Control Center off port 2605. |
| `BS_LOG_DIR` | Where logs are written (default `~/.breakshop/logs`). |
| `BS_MIN_NODE` | Minimum Node.js major version the start script accepts. |
| `BS_AUTO_INSTALL_NODE` | Set to `1` to download a private Node.js without asking. |
| `BS_DRY_RUN` | Make the start script print what it would do. |

Start script options: `lite` starts the smaller profile. Equivalent npm scripts are `npm start` and `npm stop`.

## Control Center API

The page uses a small JSON API on the same port. Requests need the `x-bs-token` header (the page gets it automatically). It lets you script scenarios.

| Method and path | Purpose |
|---|---|
| `GET /api/state` | Current settings, instances and load state. |
| `GET /api/info` | Service catalogue, journeys, log and data folders. |
| `GET /api/business` | Orders, revenue and lost value. |
| `PUT /api/services/:name/faults` | Latency, errors, timeouts, CPU burn, memory leak, slow query, failing dependencies. |
| `PUT /api/services/:name/copies` | Set the number of copies. |
| `POST /api/services/:name/instances/:id/:action` | Stop or start one copy. |
| `PUT /api/load`, `POST /api/load/stop` | Start or stop customer traffic. |
| `POST /api/stress`, `POST /api/panic` | Start CPU or memory stress, or stop it at once. |
| `PUT /api/logs`, `PUT /api/metrics`, `PUT /api/business-outcomes` | Logging, metrics and business-outcome settings. |
| `POST /api/randomize`, `POST /api/reset` | Break something silently, or put everything back. |
| `GET /api/events/recent` | Recent business events. |

## Containers (experimental)

Docker Compose and Kubernetes files are in `experimental/`. They are **untested starting points**. The shop is the same code in every mode and takes all settings from environment variables. In containers the supervisor is not used, so the Control Center's copy and stop/start controls only work in native mode. See `experimental/README.md`.

## Tests

```
npm test
```

Runs about 120 tests with Node's built-in test runner: shared helpers, each service, the supervisor, the Control Center, the load generators, the Windows start script, and an end-to-end smoke check. CI runs them on Linux, Windows and macOS.

## Troubleshooting

- **Port already in use.** Another program holds 2605, 5550 or a service port. Stop it, or set `BS_CONTROL_CENTER_PORT`. The start script reports which port is busy.
- **Not enough memory.** Use the `lite` profile.
- **Windows: `start` does something odd.** Use `.\run.bat`, not `start.bat`.
- **Something is left running.** Run `./stop.sh` or `.\stop.bat`.
- **The page shows old settings.** Use *Reset to normal*, then reload.

## Licence

MIT. See `LICENSE`.

BreakShop is a practice application with pretend partners and pretend money. It is not affiliated with any observability vendor or telecom operator.
