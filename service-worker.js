// 앳홈 집앞 분리배출 | 오프라인 캐시 + 푸시 알림
// CSS·JS를 고치면 index.html 의 ?v= 와 아래 CACHE 번호, ASSETS 의 ?v= 를 같이 올립니다.
const CACHE = 'athome-pickup-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest?v=20261124a',
  './core.css?v=20261124a', './prices.js?v=20261124a', './supabase-integration.js?v=20261124a', './app.js?v=20261124a',
  './icons/icon.svg?v=20261124a', './icons/icon-192.png?v=20261124a', './icons/icon-512.png?v=20261124a'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 같은 주소의 파일만: 먼저 인터넷에서 받고, 안 되면 저장해 둔 것을 씁니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(event.request)) ||
        (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || '앳홈 집앞 분리배출', {
    body: data.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: data.url || './' }, tag: data.tag || undefined
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || './', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    return clients.openWindow(target);
  }));
});
