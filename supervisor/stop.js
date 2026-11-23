const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const stateFile = process.env.BS_STATE_FILE || path.join(os.homedir(), '.breakshop', 'supervisor.json');
let state;
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { console.log('BreakShop is not running.'); process.exit(0); }

const req = http.request({ host: '127.0.0.1', port: state.port, path: '/shutdown', method: 'POST', headers: { 'x-bs-token': state.token } }, (res) => {
  res.resume();
  console.log('BreakShop is stopping.');
});
req.on('error', () => { try { fs.unlinkSync(stateFile); } catch { /* stale */ } console.log('BreakShop was not running (stale state removed).'); });
req.end();
