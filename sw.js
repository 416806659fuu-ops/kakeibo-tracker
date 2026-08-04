const CACHE = 'kakeibo-tracker-v2';
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
  // 静态文件改成网络优先：这个 app 改动很勤，「缓存优先 + 后台更新」意味着
  // 每次改完代码，用户手机上要连开两次才会真的用上新版本（第一次还在吃旧缓存，
  // 只是顺便在背景把新版本存起来）——这正是之前"明明说修好了、手机上还是不行"
  // 的根源。改成有网就直接用最新的，缓存只在离线时才当兜底。
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
