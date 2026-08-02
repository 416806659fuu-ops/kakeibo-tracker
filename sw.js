const CACHE = 'kakeibo-tracker-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './expense.js',
  './history.js',
  './summary.js',
  './settings.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 跨域请求（Google Apps Script 的数据接口）直接走网络，不进缓存逻辑——
  // Cache API 也不支持缓存 POST 请求。
  if (url.origin !== location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  // 静态文件缓存优先 + 后台更新：有缓存立刻响应，同时后台去拿新版本写进缓存，
  // 下一次打开生效。
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
