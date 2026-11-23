const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'control-center', 'public');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const FILES = ['index.html', 'app.js', 'map.js', 'guide.js', 'style.css'];

test('index.html contains the section ids business, traffic, services, copies, stress, logs, metrics', () => {
  const html = read('index.html');
  for (const id of ['business', 'traffic', 'services', 'copies', 'stress', 'logs', 'metrics']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('id="reset"') && html.includes('id="panic"') && html.includes('id="randomize"'));
});

test('index.html has the guidance pieces: guide, open-the-shop, where to look, map, inspector, help, blind mode', () => {
  const html = read('index.html');
  for (const id of ['guide', 'openShop', 'lookup', 'map', 'inspector', 'help', 'blind', 'now', 'journeyInfo']) assert.ok(html.includes(`id="${id}"`), id);
});

test('every script the page loads exists', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(dir, m[1].replace('/static/', ''))), m[1]);
});

test('no file references a URL with a host other than 127.0.0.1 or localhost', () => {
  for (const f of FILES) {
    for (const m of read(f).matchAll(/https?:\/\/([^/"'\s)]+)/g)) assert.ok(/^(127\.0\.0\.1|localhost)/.test(m[1]), `${f}: ${m[0]}`);
  }
});

test('the page contains no element or string for answer, history or explanation', () => {
  for (const f of FILES) assert.doesNotMatch(read(f), /answer|history|explain/i, f);
});
