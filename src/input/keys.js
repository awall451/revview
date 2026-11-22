// Linux key codes (linux/input-event-codes.h) for the keys the wheel buttons use.
// Browser-safe: no imports.
const codes = {
  LEFTCTRL: 29, LEFTSHIFT: 42, LEFTALT: 56, LEFTMETA: 125,
  RIGHTCTRL: 97, RIGHTSHIFT: 54, RIGHTALT: 100, RIGHTMETA: 126,
};
const F_LOW = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88]; // F1..F12
F_LOW.forEach((c, i) => { codes[`F${i + 1}`] = c; });
for (let n = 13; n <= 24; n++) codes[`F${n}`] = 183 + n - 13;

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
export const BROWSER_CODES = Object.freeze(browser);

const NAMES = Object.freeze(Object.fromEntries(Object.entries(codes).map(([k, v]) => [v, k])));

export function keyName(code) {
  return NAMES[code] ?? `code:${code}`;
}
