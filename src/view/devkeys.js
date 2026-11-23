// Dev only: forwards key presses on the page to the server's dev bridge (POST /dev/key), which feeds the same
// gesture detector as the wheel-button device. view.js loads this ONLY in live mode and ONLY with ?devkeys=1.
// The page itself never depends on key events: on the Pi the device grab keeps keys away from Chromium.
let chain = Promise.resolve();
const send = (body) => {
  // chained so the server sees the events in the order they happened
  chain = chain
    .then(() => fetch('/dev/key', { method: 'POST', body: JSON.stringify(body), keepalive: true }))
    .catch(() => {});
};

export function startDevKeys() {
  const isF = (code) => /^F(1[3-9]|2[0-4])$/.test(code);
  let bound = new Set();
  // the bridge's bound keys (laptop keys): no default action (no scrolling on Space), but browser shortcuts keep working
  fetch('/dev/keys').then((r) => r.json()).then((j) => { bound = new Set(j.codes); }).catch(() => {});
  const swallow = (e) => {
    if (isF(e.code) || (bound.has(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey)) e.preventDefault();
  };
  window.addEventListener('keydown', (e) => {
    swallow(e);
    send({ code: e.code, type: 'down', repeat: e.repeat });
  });
  window.addEventListener('keyup', (e) => {
    swallow(e);
    send({ code: e.code, type: 'up' });
  });
  window.addEventListener('blur', () => send({ type: 'lost' }));
}
