// Linux key codes (linux/input-event-codes.h) for the keys the wheel buttons use.
// Browser-safe: no imports.
const codes = {
  LEFTCTRL: 29, LEFTSHIFT: 42, LEFTALT: 56, LEFTMETA: 125,
  RIGHTCTRL: 97, RIGHTSHIFT: 54, RIGHTALT: 100, RIGHTMETA: 126,
};
const F_LOW = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88]; // F1..F12
F_LOW.forEach((c, i) => { codes[`F${i + 1}`] = c; });
for (let n = 13; n <= 24; n++) codes[`F${n}`] = 183 + n - 13;

// Laptop keys (for the dev bridge's own key map): config name -> Linux code, and the browser code name.
const LAPTOP = [
  ['Up', 103, 'ArrowUp'], ['Down', 108, 'ArrowDown'], ['Left', 105, 'ArrowLeft'], ['Right', 106, 'ArrowRight'],
  ['Enter', 28, 'Enter'], ['Backspace', 14, 'Backspace'], ['Space', 57, 'Space'], ['Esc', 1, 'Escape'],
];
const LETTERS = {
  Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25, A: 30, S: 31, D: 32, F: 33, G: 34,
  H: 35, J: 36, K: 37, L: 38, Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50,
};
for (const [name, code] of LAPTOP) codes[name] = code;
for (const [name, code] of Object.entries(LETTERS)) codes[name] = code;

export const KEY_CODES = Object.freeze(codes);

export const MODIFIER_KIND = Object.freeze({
  [codes.LEFTCTRL]: 'Ctrl', [codes.RIGHTCTRL]: 'Ctrl',
  [codes.LEFTSHIFT]: 'Shift', [codes.RIGHTSHIFT]: 'Shift',
  [codes.LEFTALT]: 'Alt', [codes.RIGHTALT]: 'Alt',
  [codes.LEFTMETA]: 'Meta', [codes.RIGHTMETA]: 'Meta',
});

const browser = {
  ShiftLeft: codes.LEFTSHIFT, ShiftRight: codes.RIGHTSHIFT,
  ControlLeft: codes.LEFTCTRL, ControlRight: codes.RIGHTCTRL,
  AltLeft: codes.LEFTALT, AltRight: codes.RIGHTALT,
  MetaLeft: codes.LEFTMETA, MetaRight: codes.RIGHTMETA,
};
for (let n = 1; n <= 24; n++) browser[`F${n}`] = codes[`F${n}`];
for (const [name, , web] of LAPTOP) browser[web] = codes[name];
for (const name of Object.keys(LETTERS)) browser[`Key${name}`] = codes[name];
export const BROWSER_CODES = Object.freeze(browser);

const NAMES = Object.freeze(Object.fromEntries(Object.entries(codes).map(([k, v]) => [v, k])));

export function keyName(code) {
  return NAMES[code] ?? `code:${code}`;
}
