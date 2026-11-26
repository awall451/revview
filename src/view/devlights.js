// Dev only (the laptop emulator's --lights): draws the lights module's frames as a strip of round LEDs below the panel.
// view.js loads this ONLY in live mode and ONLY with ?lights=1. It polls GET /dev/lights ({ lights, frame }) every 100 ms.
// The real frames are capped (brightness.day, 48 of 255 by default, so they look dim): each LED is drawn as colour * 255 / dayCap
// (dayCap comes with each answer) so a laptop screen shows the hue and the night look stays dimmer; data-rgb keeps the raw frame value "r,g,b". Nothing here touches the 1280x400 panel.
const POLL_MS = 100;
const LEDS = 8;

export function startDevLights() {
  const strip = document.createElement('div');
  strip.id = 'dev-lights';
  strip.style.cssText = 'position:fixed;left:0;top:400px;width:1280px;height:40px;display:flex;align-items:center;justify-content:center;gap:24px;background:#111;margin:0;padding:0;z-index:2147483647';
  const leds = [];
  for (let i = 0; i < LEDS; i++) {
    const d = document.createElement('div');
    d.id = `led-${i}`;
    d.dataset.rgb = '0,0,0';
    d.style.cssText = 'width:24px;height:24px;border-radius:50%;box-sizing:border-box;border:2px solid #444;background:#222';
    strip.appendChild(d);
    leds.push(d);
  }
  document.body.appendChild(strip);
  const paint = (frame, cap) => {
    for (let i = 0; i < LEDS; i++) {
      const p = Array.isArray(frame) && Array.isArray(frame[i]) ? frame[i] : [0, 0, 0];
      leds[i].dataset.rgb = p.join(',');
      const lit = p.some((c) => c > 0);
      leds[i].style.background = lit ? `rgb(${p.map((c) => Math.min(255, Math.round(c * 255 / cap))).join(',')})` : '#222';
      leds[i].style.borderColor = lit ? 'transparent' : '#444';
    }
  };
  const tick = () => fetch('/dev/lights', { cache: 'no-store' }).then((r) => r.json()).then((j) => paint(j.frame, Number.isInteger(j.dayCap) && j.dayCap > 0 ? j.dayCap : 255)).catch(() => {});
  setInterval(tick, POLL_MS);
  tick();
}
