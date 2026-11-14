// Service worker: cache versionado SÓ do shell do app.
// Nunca intercepta googleapis.com, accounts.google.com, drive.google.com, fontes nem outra origem.
// Estratégia: rede primeiro (o app sempre pega a versão publicada quando há internet) e cache
// como reserva offline. Ao publicar mudanças, aumente a versão abaixo para avisar "Nova versão".

const CACHE = 'motor-shell-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/auth.js',
  './js/drive.js',
  './js/sheet.js',
  './js/model.js',
  './js/parse.js',
  './js/upload.js',
  './js/ui.js',
  './js/views/inicio.js',
  './js/views/videos.js',
  './js/views/enviar.js',
  './js/views/prontos.js',
  './js/views/embreve.js',
  './js/views/login.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

// URLs absolutas do shell (resolvidas a partir do escopo do SW, ex. /motor-conteudo/).
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));
const INDEX_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('motor-shell-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google, fontes etc.: nunca

  if (req.mode === 'navigate') {
    // Navegação: rede primeiro; offline → index.html do cache.
    event.respondWith(fetch(req).catch(() => caches.match(INDEX_URL)));
    return;
  }

  const semQuery = url.origin + url.pathname;
  if (!SHELL_URLS.has(semQuery)) return; // inclui vendor/xlsx.full.min.js: fora do cache

  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(semQuery, copia));
        }
        return resp;
      })
      .catch(() => caches.match(semQuery).then((r) => r || Response.error())),
  );
});
