// Service worker do app novo (registrado de dentro de novo/, escopo './' = /novo/).
// Cache versionado SÓ dos arquivos do app. Nunca intercepta outra origem (googleapis.com,
// accounts.google.com, drive.google.com, fontes) nem respostas do Drive/Sheets, e só atende URLs
// dentro de /novo/ (o app antigo da raiz tem o seu próprio SW, com caches "motor-shell-").
// Estratégia: rede primeiro (o app sempre pega a versão publicada quando há internet) e cache
// como reserva offline. Ao publicar mudanças, aumente a versão abaixo para avisar "Nova versão".

const PREFIXO = 'motor-novo-';
const CACHE = `${PREFIXO}v2`;

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/config.js',
  './js/integra.js',
  './js/auth.js',
  './js/drive.js',
  './js/sheet.js',
  './js/parse.js',
  './js/model.js',
  './js/roteiro.js',
  './js/etapas.js',
  './js/dados.js',
  './js/estado.js',
  './js/util.js',
  './js/acoes.js',
  './js/roteador.js',
  './js/visual.js',
  './js/telas/pecas.js',
  './js/telas/inicio.js',
  './js/telas/pautas.js',
  './js/telas/roteiros.js',
  './js/telas/videos.js',
  './js/telas/enviar.js',
  './js/telas/prontos.js',
  './js/telas/resultados.js',
  './js/componentes/janelas.js',
  './js/componentes/paleta.js',
  './js/componentes/tele.js',
  './js/componentes/players.js',
  './js/componentes/downloads.js',
  './js/componentes/grafico.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];
// vendor/xlsx.full.min.js (SheetJS, ~900 KB) fica fora: só carrega ao ler a planilha .xlsx.

const ESCOPO = self.registration.scope; // ex.: https://motor.rocambrea.com/novo/
const URLS = new Set(ARQUIVOS.map((p) => new URL(p, ESCOPO).href));
const INDEX = new URL('./index.html', ESCOPO).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Só os caches deste app (nunca os "motor-shell-" do app da raiz).
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith(PREFIXO) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google, fontes etc.: nunca
  if (!req.url.startsWith(ESCOPO)) return; // fora de /novo/ (ex.: ../vendor, o app da raiz): nunca

  if (req.mode === 'navigate') {
    // Navegação: rede primeiro; offline → index.html do cache.
    event.respondWith(fetch(req).catch(() => caches.match(INDEX).then((r) => r || Response.error())));
    return;
  }

  const semQuery = url.origin + url.pathname;
  if (!URLS.has(semQuery)) return; // só os arquivos do app

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
