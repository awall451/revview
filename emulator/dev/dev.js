import { PANEL } from '/emulator/panel.js';
import { STATES } from '/src/state/states.js';

const KEY = 'revview.screenCssPxPerMm';
const CARD_MM = 85.6;
const CARD_H_MM = 53.98;
const NOMINAL = 96 / 25.4;
const $ = (id) => document.getElementById(id);

let pxPerMm = NOMINAL;
let calibrated = false;

function load() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (Number.isFinite(v) && v > 0) { pxPerMm = v; calibrated = true; }
  } catch { /* storage unavailable: stay uncalibrated */ }
}

function setScale(v, save = true) {
  if (!Number.isFinite(v) || v <= 0) return;
  pxPerMm = v;
  calibrated = save;
  try {
    if (save) localStorage.setItem(KEY, String(v)); else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
  render();
}

function render() {
  // The panel's real width in mm, shown at pxPerMm screen px per mm.
  const stripMm = PANEL.widthPx / PANEL.pxPerMm;
  const heightMm = PANEL.heightPx / PANEL.pxPerMm;
  const target = stripMm * pxPerMm;
  const s = target / PANEL.widthPx;
  const strip = $('strip');
  strip.style.width = `${target}px`;
  strip.style.height = `${PANEL.heightPx * s}px`;
  $('view').style.transform = `scale(${s})`;
  $('px-per-mm').textContent = pxPerMm.toFixed(4);
  $('calibrated').textContent = calibrated ? '(calibrated)' : '(uncalibrated: CSS nominal 96 dpi)';
  $('strip-mm').textContent = `${stripMm.toFixed(1)} x ${heightMm.toFixed(1)} mm`;
  $('caption').textContent = `${PANEL.widthPx}x${PANEL.heightPx} px, scaled uniformly by `
    + `${PANEL.pxPerMm.toFixed(3)} px/mm to ${stripMm.toFixed(1)} x ${heightMm.toFixed(1)} mm `
    + `(active area ${PANEL.activeWidthMm} x ${PANEL.activeHeightMm} mm).`;
  const cardPx = pxPerMm * CARD_MM;
  const cardInput = $('card-width');
  if (document.activeElement !== cardInput) cardInput.value = String(Number(cardPx.toFixed(2)));
  $('card-slider').value = String(cardPx);
  const card = $('card');
  card.style.width = `${cardPx}px`;
  card.style.height = `${pxPerMm * CARD_H_MM}px`;
  drawRuler();
}

function drawRuler() {
  const ruler = $('ruler');
  ruler.style.width = `${pxPerMm * 100}px`;
  ruler.replaceChildren();
  for (let mm = 0; mm <= 100; mm++) {
    const t = document.createElement('i');
    t.style.left = `${mm * pxPerMm}px`;
    if (mm % 10 === 0) t.className = 'ten'; else if (mm % 5 === 0) t.className = 'five';
    ruler.append(t);
  }
}

function fromMonitor() {
  const d = Number($('diagonal').value);
  const w = Number($('res-w').value);
  const h = Number($('res-h').value);
  if (d > 0 && w > 0 && h > 0) setScale(Math.hypot(w, h) / (d * 25.4));
}

function fromCard(e) {
  const w = Number(e.target.value);
  if (w > 0) setScale(w / CARD_MM);
}

// State picker
const select = $('state');
for (const id of STATES) {
  const o = document.createElement('option');
  o.value = o.textContent = id;
  select.append(o);
}
function setState(id) {
  if (!STATES.includes(id)) id = STATES[0];
  select.value = id;
  $('view').src = `../../src/view/?fixture=${encodeURIComponent(id)}`;
  const u = new URL(location.href);
  u.searchParams.set('state', id);
  history.replaceState(null, '', u);
}
function step(d) {
  setState(STATES[(STATES.indexOf(select.value) + d + STATES.length) % STATES.length]);
}
select.addEventListener('change', () => setState(select.value));
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

function fillMonitorDefaults() {
  $('res-w').value = String(screen.width);
  $('res-h').value = String(screen.height);
  $('diagonal').value = '';
}

for (const id of ['diagonal', 'res-w', 'res-h']) $(id).addEventListener('input', fromMonitor);
$('card-width').addEventListener('input', fromCard);
$('card-slider').addEventListener('input', fromCard);
$('reset').addEventListener('click', () => { fillMonitorDefaults(); setScale(NOMINAL, false); });

$('dpr').textContent = String(devicePixelRatio);
fillMonitorDefaults();
load();
render();
setState(new URLSearchParams(location.search).get('state') ?? STATES[0]);
