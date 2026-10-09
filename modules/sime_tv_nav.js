// Botão "trocar painel" nos 4 módulos de TV (22/09/2026, pedido direto: "trocar
// entre os 4 paineis (Preparação/Véspera/Distribuição/Dia) direto do proprio
// tv box"). Antes disso, mudar de painel exigia reconfigurar a URL/QR na mão
// — ou, no app Android, o atalho nativo de 5x Voltar (que abre `?config=1`,
// uma tela separada, pensada pra configuração inicial do aparelho).
//
// Self-contido (CSS injetado, próprio overlay) de propósito — os 4 painéis
// têm layouts/temas bem diferentes entre si (TV Preparação é branco/minimalista,
// sem topbar nenhuma; os outros três têm topbars com paletas e tamanhos de
// botão diferentes), então um componente com estilo fixo próprio é mais
// simples e mais consistente do que tentar encaixar num `.gear-btn`/`.cfg-btn`
// que muda de arquivo pra arquivo.
//
// Não depende de sessão nem de `sime_tv_auth.js` — só precisa saber em qual
// dos 4 arquivos está (pra destacar o painel atual) e montar os links dos
// outros 3. Preserva a query string atual (`location.search`, tipicamente
// `?tv_token=...`) ao trocar — cobre o caso raro de trocar de painel antes de
// `bootstrapTvSession` já ter persistido a sessão em localStorage (a troca de
// token só precisa acontecer uma vez, no 1º boot de cada aparelho — nos boots
// seguintes o token nem precisa estar na URL, mas preservá-lo nunca atrapalha).

(function () {
  const PAINEIS = [
    { arquivo: 'SIME_tv_preparacao.html', icon: '🕐', label: 'TV Preparação', sub: 'D-X — carga e lacre' },
    { arquivo: 'SIME_tv_vespera.html', icon: '🚚', label: 'TV Véspera', sub: 'D-1 — instalação' },
    { arquivo: 'SIME_tv_distribuicao.html', icon: '📦', label: 'TV Distribuição', sub: 'D-1 — embarque de urna' },
    { arquivo: 'SIME_tv_dia.html', icon: '🗳️', label: 'TV Dia da Eleição', sub: 'Dia D — abertura/encerramento' },
  ];

  const atual = location.pathname.split('/').pop();
  // Fora dos 4 painéis conhecidos (arquivo renomeado, ou script incluído em
  // outra tela por engano) — nunca monta nada, silenciosamente.
  if (!PAINEIS.some((p) => p.arquivo === atual)) return;

  function montar() {
    const css = document.createElement('style');
    css.textContent = `
#sime-tvnav-btn{position:fixed;left:10px;bottom:10px;z-index:900;width:34px;height:34px;
  border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(20,20,28,.6);
  color:#fff;font-size:1.05rem;line-height:1;display:flex;align-items:center;
  justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);}
#sime-tvnav-btn:hover{background:rgba(20,20,28,.85);}
#sime-tvnav-overlay{position:fixed;inset:0;background:rgba(8,8,14,.72);z-index:901;
  display:none;align-items:center;justify-content:center;padding:24px;}
#sime-tvnav-overlay.open{display:flex;}
#sime-tvnav-card{background:#1c1c26;border:1px solid rgba(255,255,255,.14);border-radius:14px;
  padding:20px;min-width:300px;max-width:380px;box-shadow:0 16px 48px rgba(0,0,0,.55);
  font-family:'Segoe UI',system-ui,sans-serif;}
#sime-tvnav-card h3{color:#fff;font-size:.95rem;margin:0 0 14px;font-weight:800;letter-spacing:.02em;}
.sime-tvnav-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;
  padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#fff;font-size:.85rem;font-weight:700;
  cursor:pointer;margin-bottom:8px;font-family:inherit;}
.sime-tvnav-item:hover{background:rgba(255,255,255,.1);}
.sime-tvnav-item.atual{border-color:#3ba55d;background:rgba(59,165,93,.16);cursor:default;}
.sime-tvnav-item .ic{font-size:1.2rem;flex-shrink:0;}
.sime-tvnav-item .lb{flex:1;}
.sime-tvnav-item .lb small{display:block;font-weight:600;opacity:.6;font-size:.68rem;margin-top:1px;}
.sime-tvnav-item .ck{font-size:.72rem;font-weight:800;color:#3ba55d;flex-shrink:0;}
#sime-tvnav-close{margin-top:2px;width:100%;padding:9px;border-radius:9px;border:none;
  background:rgba(255,255,255,.08);color:#fff;font-weight:700;font-size:.8rem;cursor:pointer;
  font-family:inherit;}
#sime-tvnav-close:hover{background:rgba(255,255,255,.15);}
`;
    document.head.appendChild(css);

    const btn = document.createElement('button');
    btn.id = 'sime-tvnav-btn';
    btn.type = 'button';
    btn.title = 'Trocar painel de TV';
    btn.textContent = '▦';

    const overlay = document.createElement('div');
    overlay.id = 'sime-tvnav-overlay';
    const card = document.createElement('div');
    card.id = 'sime-tvnav-card';
    card.innerHTML = '<h3>📺 Trocar painel de TV</h3>';
    PAINEIS.forEach((p) => {
      const ehAtual = p.arquivo === atual;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sime-tvnav-item' + (ehAtual ? ' atual' : '');
      item.innerHTML =
        '<span class="ic">' + p.icon + '</span>' +
        '<span class="lb">' + p.label + '<small>' + p.sub + '</small></span>' +
        (ehAtual ? '<span class="ck">✓ atual</span>' : '');
      if (!ehAtual) {
        item.onclick = () => { location.href = './' + p.arquivo + location.search; };
      }
      card.appendChild(item);
    });
    const closeBtn = document.createElement('button');
    closeBtn.id = 'sime-tvnav-close';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Fechar';
    closeBtn.onclick = () => overlay.classList.remove('open');
    card.appendChild(closeBtn);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    btn.onclick = () => overlay.classList.add('open');

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
