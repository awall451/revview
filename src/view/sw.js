/* global self, caches, Request */
// Service worker of the live page (QA 08). Chromium shows its own white error page when a document load
// fails, and a page cannot stop that. A service worker can: after the live page has been loaded once, a
// reload while the revview server is away is answered from this cache, so the page still starts, shows NO LINK
// and reconnects by itself. Network first: with the server up everything is fetched fresh.
// It does NOT help on the very first load of a browser profile, or after the profile's site data is cleared
// (see src/view/README.md, "Reload while the server is down").
const CACHE = 'revview-shell-1';
const SHELL = ['./', 'view.css', 'view.js', 'fit.js', 'type.js', 'panel.js'];
const here = new URL('./', self.location).href;
const inShell = (url) => url.origin === self.location.origin
  && (url.href === here || SHELL.some((f) => url.href === new URL(f, self.location).href));

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const nav = req.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.endsWith('/events');
  if (!nav && !inShell(url)) return; // /events, /state, /event and everything else go straight to the network
  ev.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && inShell(new URL(url.pathname, url.origin))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(new URL(url.pathname, url.origin).href, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      const hit = await caches.match(new URL(url.pathname, url.origin).href);
      if (hit) return hit;
      if (nav) {
        const root = await caches.match(here);
        if (root) return root;
      }
      throw e;
    }
  })());
});
