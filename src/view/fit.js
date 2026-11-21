// Pure text fitting helpers (no DOM). `fits(candidate)` is a predicate the caller supplies, usually
// "does this text fit the element's real layout".
const ELLIPSIS = '…';

// Largest k in [lo, hi] with ok(k) true, assuming ok is monotone (true, then false); lo - 1 if none.
function largest(lo, hi, ok) {
  let best = lo - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

// Keep n code points: about 1/3 from the front, 2/3 from the back, ellipsis between.
function cutMiddle(cps, n) {
  const front = Math.max(1, Math.floor(n / 3));
  const back = Math.max(1, n - front);
  return cps.slice(0, front).join('') + ELLIPSIS + cps.slice(cps.length - back).join('');
}

export function middleEllipsis(text, fits) {
  if (typeof text !== 'string' || text === '') return '';
  if (fits(text)) return text;
  const cut = text.lastIndexOf('/');
  let dir = cut > 0 ? Array.from(text.slice(0, cut)) : [];
  let base = cut > 0 ? text.slice(cut + 1) : text;
  if (base === '') { dir = []; base = text; }
  if (dir.length) {
    // prefix + …/ + basename; k = leading code points of the directory part that are kept
    const form = (k) => `${dir.slice(0, k).join('')}${ELLIPSIS}/${base}`;
    const k = largest(0, dir.length - 1, (m) => fits(form(m)));
    if (k >= 0) return form(k);
  }
  const cps = Array.from(base);
  if (cps.length < 5) return base;
  // n = code points of the basename kept (at least 4: one in front, three at the end)
  const n = largest(4, cps.length - 1, (m) => fits(cutMiddle(cps, m)));
  return cutMiddle(cps, Math.max(n, 4));
}

// Compact diff number: short enough for a slot that never shrinks. Rounds DOWN (never overstates),
// at most 4 digits: 9999, 12.3k, 999k, 1.2M, 999M, 3G.
export function formatCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '0';
  n = Math.floor(n);
  if (n < 1e4) return String(n);
  if (n < 1e5) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  if (n < 1e6) return `${Math.floor(n / 1e3)}k`;
  if (n < 1e7) return `${(Math.floor(n / 1e5) / 10).toFixed(1)}M`;
  if (n < 1e9) return `${Math.floor(n / 1e6)}M`;
  return `${Math.floor(n / 1e9)}G`;
}
