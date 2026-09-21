// Compartilhado pelos 6 módulos de campo (mesário, motorista, conferente,
// instalador, acessibilidade, mídias) — registra o service worker e injeta
// um botão de "instalar" discreto, pra dar pra abrir a tela como app (sem
// barra de navegador) direto do ícone na tela inicial do celular.
//
// Deliberadamente FORA do fluxo do ".remote"/controle — é um ícone pequeno,
// fixo no canto da JANELA (não do controle), quase transparente até o
// operador reparar nele, pra nunca competir por atenção com os botões
// grandes de pânico/fila/confirmação que são o motivo da tela existir (regra
// 4 do CLAUDE.md: "botões grandes — uso às 5h30, em campo, com sono").
// Some sozinho se o app já estiver instalado (display-mode standalone).
// z-index acima de #login-overlay (500) de propósito — instalar é útil
// mesmo antes de logar (primeira abertura, ainda digitando token/PIN), e o
// ícone é pequeno o bastante pra não atrapalhar o teclado de PIN embaixo.
(function () {
  'use strict';

  function jaInstalado() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true; // Safari/iOS antigo
  }

  // Registra o Service Worker — melhor-esforço: sem isso o app continua
  // funcionando normalmente, só não fica instalável/offline pro esqueleto.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sime_sw.js').catch(function () {});
    });
  }

  if (jaInstalado()) return; // nada a instalar — sem ícone extra na tela

  function ehIosSafari() {
    var ua = navigator.userAgent || '';
    return /iP(hone|od|ad)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  }

  var STYLE = '' +
    '.sime-pwa-btn{position:fixed;top:10px;right:10px;z-index:550;' +
      'width:2.4rem;height:2.4rem;border-radius:50%;border:0;' +
      'background:rgba(20,20,28,.55);color:#fff;opacity:.28;' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:0;cursor:pointer;transition:opacity .15s;}' +
    '.sime-pwa-btn:hover,.sime-pwa-btn:focus{opacity:1;background:rgba(20,20,28,.85);}' +
    '.sime-pwa-btn svg{width:58%;height:58%;fill:currentColor;}' +
    '.sime-pwa-toast{position:fixed;top:58px;right:10px;z-index:551;max-width:min(78vw,320px);' +
      'background:#1e1e2e;color:#fff;padding:10px 14px;border-radius:10px;' +
      'font:600 .78rem/1.35 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5);' +
      'opacity:0;transform:translateY(-6px);pointer-events:none;transition:all .18s;' +
      'border:1px solid #33334a;}' +
    '.sime-pwa-toast.on{opacity:1;transform:translateY(0);}';

  var ICONE = '<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Z"/><path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/></svg>';

  var styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sime-pwa-btn';
  btn.setAttribute('aria-label', 'Instalar este painel como app');
  btn.title = 'Instalar este painel como app';
  btn.innerHTML = ICONE;
  btn.hidden = true;

  var toast = document.createElement('div');
  toast.className = 'sime-pwa-toast';

  function mostrarToast(msg, ms) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(function () { toast.classList.remove('on'); }, ms || 6000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(btn);
    document.body.appendChild(toast);
  });

  var eventoPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    eventoPrompt = e;
    btn.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    btn.hidden = true;
    eventoPrompt = null;
  });

  // iOS nunca dispara beforeinstallprompt — o único caminho lá é manual
  // (Compartilhar → Adicionar à Tela de Início). Mostra o ícone mesmo assim,
  // com um pequeno atraso pra não competir com o primeiro instante de leitura
  // da tela.
  if (ehIosSafari()) {
    setTimeout(function () { if (!jaInstalado()) btn.hidden = false; }, 2500);
  }

  btn.addEventListener('click', function () {
    if (eventoPrompt) {
      var ev = eventoPrompt;
      eventoPrompt = null;
      btn.hidden = true;
      ev.prompt();
      return;
    }
    mostrarToast('Toque em Compartilhar (⬆️) e depois em "Adicionar à Tela de Início"', 7000);
  });
})();
