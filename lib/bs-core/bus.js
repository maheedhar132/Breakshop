const { currentContext, newTrace, parseTraceparent, formatTraceparent, runWithContext } = require('./trace');

function createBus({ client, pollMs = 300 }) {
  async function publish(topic, payload) {
    const ctx = currentContext() || newTrace();
    await client.call('bus', { method: 'POST', path: `/publish/${topic}`, body: { traceparent: formatTraceparent(ctx), payload } });
  }

  function subscribe(topic, group, handler) {
    let stopped = false;
    let timer = null;
    const loop = async () => {
      try {
        const r = await client.call('bus', { path: `/poll/${topic}?group=${group}&max=20` });
        for (const m of (r.body && r.body.messages) || []) {
          const ctx = parseTraceparent(m.traceparent) || newTrace();
          await runWithContext(ctx, () => handler(m.payload)).catch(() => {});
        }
      } catch { /* bus unavailable: try again next tick */ }
      if (!stopped) { timer = setTimeout(loop, pollMs); timer.unref(); }
    };
    loop();
    return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
  }

  return { publish, subscribe };
}

module.exports = { createBus };
