// WCAG 2 contrast: pure helpers on the colour strings getComputedStyle returns (rgb(r, g, b), rgba(r, g, b, a), also the
// space-separated form). Used by emulator/tests/contrast.spec.js; unit test: tests/unit/contrast.test.js.

// {r, g, b, a} (0..255, a 0..1) or null when the string is not an rgb()/rgba() colour
export function parseColor(str) {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(str).trim());
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((v) => !Number.isFinite(v))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

// relative luminance 0..1 of an opaque colour (string or {r, g, b})
export function luminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  if (!c) throw new Error(`not a colour: ${color}`);
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

// contrast ratio 1..21 of two colours, in either order
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
