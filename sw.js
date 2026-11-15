// Service worker do Motor de Conteúdo (registrado por js/main.js com escopo './', a raiz do site).
// Cache versionado SÓ dos arquivos do app. Nunca intercepta outra origem (googleapis.com,
// accounts.google.com, drive.google.com, fontes) nem respostas do Drive/Sheets.
// Estratégia: rede primeiro (o app sempre pega a versão publicada quando há internet) e cache
// como reserva offline. Ao publicar mudanças, aumente a versão abaixo: o sw.js muda de conteúdo,
// o navegador instala este SW no lugar do anterior e a página recarrega sozinha uma vez (ou, com
// trabalho em andamento, mostra "Nova versão"; js/versao.js). O próprio sw.js é buscado sem o
// cache HTTP (register com updateViaCache: 'none', em js/main.js).
//
// Troca do app antigo: o SW antigo da raiz (caches "motor-shell-") é substituído por este assim que
// o navegador vê que o sw.js mudou; o activate apaga os caches dele e os da prévia do app novo,
// que ficava numa subpasta ("motor-novo-").

const PREFIXO = 'motor-app-';
const VERSAO = `${PREFIXO}v28`;
const CACHES_ANTIGOS = ['motor-shell-', 'motor-novo-', PREFIXO];

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/config.js',
  './js/integra.js',
  './js/central.js',
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
  './js/controle.js',
  './js/selecao.js',
  './js/candidatos.js',
  './js/envios.js',
  './js/decisoes-roteiro.js',
  './js/andamento.js',
  './js/saude.js',
  './js/upload.js',
  './js/envio-video.js',
  './js/revisao.js',
  './js/pedidos-motor.js',
  './js/versao.js',
  './js/saida.js',
  './js/telas/pecas.js',
  './js/telas/ficha.js',
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
  './js/componentes/telacheia.js',
  './js/componentes/downloads.js',
  './js/componentes/grafico.js',
  './js/componentes/execucao.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];
// Fora do cache: vendor/xlsx.full.min.js (SheetJS, ~900 KB, só carrega ao ler a planilha .xlsx).

const ESCOPO = self.registration.scope; // ex.: https://motor.rocambrea.com/
const URLS = new Set(ARQUIVOS.map((p) => new URL(p, ESCOPO).href));
const INDEX = new URL('./index.html', ESCOPO).href;

// 'no-cache' = sempre confere com o servidor (304 barato quando nada mudou). Sem isso, o cache HTTP
// do GitHub Pages (10 min) pode devolver um arquivo do app antigo junto com os do novo.
const DA_REDE = { cache: 'no-cache' };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSAO)
      .then((c) => c.addAll(ARQUIVOS.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes
        .filter((n) => n !== VERSAO && CACHES_ANTIGOS.some((p) => n.startsWith(p)))
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// A página pergunta a versão do SW que a controla (js/main.js), para saber se precisa recarregar.
self.addEventListener('message', (event) => {
  if (event.data === 'versao') event.source?.postMessage({ versao: VERSAO });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google, fontes etc.: nunca
  if (!req.url.startsWith(ESCOPO)) return;

  if (req.mode === 'navigate') {
    // Navegação: rede primeiro (sem o cache HTTP); offline → index.html do cache.
    event.respondWith(
      fetch(req.url, { ...DA_REDE, credentials: 'same-origin' })
        .then((r) => (r.redirected ? fetch(req) : r)) // redirecionamento: deixa o navegador seguir
        .catch(() => caches.match(INDEX).then((r) => r || Response.error())),
    );
    return;
  }

  const semQuery = url.origin + url.pathname;
  if (!URLS.has(semQuery)) return; // só os arquivos do app

  event.respondWith(
    fetch(req, DA_REDE)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(semQuery, copia));
        }
        return resp;
      })
      .catch(() => caches.match(semQuery).then((r) => r || Response.error())),
  );
});
