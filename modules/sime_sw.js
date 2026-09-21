// Service worker compartilhado pelos módulos de campo (mesário, motorista,
// conferente, instalador, acessibilidade, mídias) — existe só pra tornar
// essas telas instaláveis como PWA (ícone na tela inicial, sem barra de
// navegador) e deixar o "esqueleto" (CSS/ícones) disponível offline.
//
// NUNCA intercepta chamadas ao Supabase (REST/Realtime) — o app já resolve
// isso sozinho com a fila offline em IndexedDB (ver "PADRÃO DE CÓDIGO —
// OFFLINE-FIRST" no CLAUDE.md). Um Service Worker cacheando resposta de API
// por cima disso seria uma segunda camada de "offline" competindo com a
// primeira, arriscando servir dado velho sem o app saber. Por isso o fetch
// handler só entra em ação pra dois tipos de pedido, e ignora todo o resto
// (deixa cair no comportamento padrão do navegador, como se este arquivo
// não existisse):
//   1. Navegação pra uma das próprias páginas HTML — network-first: tenta a
//      rede primeiro (pra nunca rodar uma versão velha da lógica de votação
//      enquanto há sinal), só cai no cache se a rede falhar de verdade.
//   2. Arquivos estáticos deste diretório (CSS/JS/ícones/manifesto) —
//      cache-first com atualização em segundo plano, já que mudam pouco e
//      carregar rápido importa mais aqui.

const CACHE = 'sime-campo-shell-v1';

const SHELL = [
  './sime_theme_dark.css',
  './sime_components.css',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Lista EXPLÍCITA, não regex por extensão — um regex tipo /\.js$/ acabaria
// interceptando script de LÓGICA de negócio (vendor/supabase-js.esm.js,
// sime_dados.js, sime_realtime.js, sime_campo_auth.js etc.), exatamente o
// risco que o comentário do topo deste arquivo promete evitar. Só os
// arquivos de esqueleto de verdade (CSS + ícones do próprio SHELL) entram
// aqui — resolvidos pelo caminho ABSOLUTO (pathname termina com um dos
// caminhos do SHELL, sem o "./" relativo).
const SHELL_PATHS = SHELL.map((s) => s.replace(/^\.\//, '/'));
function ehArquivoDoShell(pathname) {
  return SHELL_PATHS.some((p) => pathname.endsWith(p));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca intercepta POST/PUT (é aqui que passa tudo que grava dado)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nunca intercepta Supabase/CDN/terceiros

  // 1. Navegação (abrir/recarregar a própria tela) — sempre tenta a rede primeiro.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((r) => r || caches.match('./' + url.pathname.split('/').pop()))
      )
    );
    return;
  }

  // 2. Estático do SHELL (CSS/ícones) — cache-first, atualiza em segundo plano.
  //    Nunca intercepta .js — nenhum script de lógica de negócio, nem vendor
  //    de terceiro, passa por aqui.
  if (ehArquivoDoShell(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fresh = fetch(req).then((resp) => {
          if (resp && resp.ok) caches.open(CACHE).then((c) => c.put(req, resp.clone()));
          return resp;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
  // Qualquer outra coisa (API, WebSocket upgrade, etc.) — não intercepta.
});
