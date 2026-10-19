// Service worker: lưu sẵn giao diện để mở app tức thì / khi mất mạng.
// Dữ liệu gia phả do Firestore tự lưu đệm (IndexedDB), không đi qua đây.
const V = 'gp-1792400633048';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/ui.js', 'js/data.js', 'js/tree.js', 'js/kin.js', 'js/lunar.js', 'js/firebase-config.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // file của app: lấy mạng trước (luôn bản mới), mất mạng thì dùng bản lưu
  if (u.origin === location.origin) {
    // no-cache: luôn hỏi lại server (GitHub Pages cho trình duyệt giữ file 10 phút) → điện thoại thấy bản mới ngay
    const req = e.request.mode === 'navigate' ? e.request.url : e.request;
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  // thư viện CDN (Firebase SDK, Font Awesome, font): dùng bản lưu nếu có
  if (/gstatic\.com\/firebasejs|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.href)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const c = res.clone(); caches.open(V).then((x) => x.put(e.request, c)); return res; })));
  }
});

// ---------- Thông báo đẩy: giỗ, sinh nhật (gửi từ repo gia-pha-cron lúc 7h sáng) ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Gia phả', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Gia phả', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || 'gia-pha-nhac', renotify: true,
    data: { url: d.url || './?tab=gio' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './?tab=gio', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
