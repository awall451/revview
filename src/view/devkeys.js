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
  window.addEventListener('keydown', (e) => {
    if (isF(e.code)) e.preventDefault();
    send({ code: e.code, type: 'down', repeat: e.repeat });
  });
  window.addEventListener('keyup', (e) => {
    if (isF(e.code)) e.preventDefault();
    send({ code: e.code, type: 'up' });
  });
  window.addEventListener('blur', () => send({ type: 'lost' }));
}
