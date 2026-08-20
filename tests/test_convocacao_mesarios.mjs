// Testa a página nova SIME_convocacao.html (20/08/2026) — tirou "Sincronizar
// mesários" e "Resumo por Seção" de dentro de SIME_atores.html e virou módulo
// próprio, com mais duas abas novas: "Contatar mesários" (fila de contato,
// reclassificar 'recusou' → 'contato_incorreto', meio de contato alternativo)
// e "Histórico" (últimas sincronizações, lendo sime_logs).
import pw from 'playwright';
import { writeFileSync, unlinkSync } from 'node:fs';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(_cols, opts){ if(opts && opts.count) this._count=true; return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  contains(c,v){ this.f['__contains_'+c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  insert(p){ window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p }); return Promise.resolve({ error:null }); }
  _casa(x){
    return Object.entries(this.f).every(([k,v]) => {
      if(k.startsWith('__in_')) return v.includes(x[k.slice(5)]);
      if(k.startsWith('__contains_')){
        const path=k.slice(11); const [col,key]=path.split('->');
        const arr=x[col]?.[key];
        return Array.isArray(arr) && arr.some(item => v.every(want => Object.entries(want).every(([kk,vv]) => item[kk]===vv)));
      }
      if(k.includes('->>')){ const [col,key]=k.split('->>'); return String(x[col]?.[key] ?? '')===String(v); }
      return x[k]===v;
    });
  }
  then(res){
    if(this._op==='update'){
      window.__mock.escritas.push({ op:'update', tabela:this.t, payload:this._payload, filtro:{...this.f} });
      const rows=(window.__mock[this.t]||[]);
      const atingidas=[];
      rows.forEach((x,idx)=>{ if(this._casa(x)){ rows[idx]={...x, ...this._payload}; atingidas.push(rows[idx]); } });
      return res({ data: atingidas, error:null });
    }
    const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x));
    return res({ data:r, error:null, count: r.length });
  }
}
export function createClient(){
  // localStorage, não uma variável de closure — mesmo padrão do Supabase JS
  // de verdade (sessão persistida), necessário pro teste de navegação real
  // entre SIME_convocacao.html e SIME_atores.html (cada página recarrega o
  // JS do zero; uma variável em memória se perderia na troca de página).
  const ler = () => { try { return JSON.parse(localStorage.getItem('_mock_session')||'null'); } catch(e){ return null; } };
  return {
    from(t){ return new QB(t); },
    rpc(name, params){
      window.__mock.rpcChamadas.push({ name, params });
      if(name==='sime_sync_atores_from_raw') return Promise.resolve({ data:[{ atualizados:0, inativados:0 }], error:null });
      return Promise.resolve({ data:null, error:null });
    },
    auth: {
      async getSession(){ return { data:{ session: ler() } }; },
      async getUser(){ const s=ler(); return { data:{ user: s?{ id:'auth-maria' }:null } }; },
      async signInWithPassword({ email }){ const session={ user:{ id:'auth-maria', email } }; localStorage.setItem('_mock_session', JSON.stringify(session)); return { data:{ session }, error:null }; },
    },
  };
}
`;

function mock() {
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_zonas: [{ id:'z7', numero:7, estado:'PI', nome:'Campo Maior' }],
    sime_logs: [
      { ts:'2026-08-20T09:00:00.000Z', acao:'mesarios_sync_csv', modulo:'convocacao', payload:{ zona:'7', uf:'PI', registros:290, atualizados:280, inativados:5 } },
      { ts:'2026-08-19T10:00:00.000Z', acao:'mesario_meio_contato', modulo:'convocacao', payload:{ ator_id:'a2', meio_contato:'carta_registrada' } },
      { ts:'2026-08-17T08:30:00.000Z', acao:'hermes_confirmou_mesario', modulo:'hermes_mesarios', payload:{ acao:'confirmar', telefone:'5586999990002', zona:'7', afetados:[{ id:'a2', nome:'BRUNO MESARIO', secao:'0030' }], ts:'2026-08-17T08:30:00.000Z' } },
    ],
    sime_secoes: [
      { id:'s1', numero:30, local_nome:'Grupo Escolar A', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:280 },
      { id:'s2', numero:31, local_nome:'Grupo Escolar A', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:260 },
      { id:'s3', numero:63, local_nome:'Escola B', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:300 },
    ],
    sime_atores: [
      { id:'a1', nome_completo:'ANA PRESIDENTE', telefone_whatsapp:'5586999990001', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s1', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, meio_contato:'whatsapp', status_contato_alternativo:null, data_confirmacao:'2026-08-15T10:00:00Z' },
      { id:'a2', nome_completo:'BRUNO MESARIO', telefone_whatsapp:'5586999990002', funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'s1', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', status_contato_alternativo:null, data_confirmacao:null, inscricao_eleitoral:'046919051589' },
      { id:'a3', nome_completo:'CARLA RECUSOU', telefone_whatsapp:'5586999990003', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s2', zona_id:'z7', confirmacao:'recusou', ativo:true, observacao:'Recado via Hermes: não sou essa pessoa, número errado', meio_contato:'whatsapp', status_contato_alternativo:null, data_confirmacao:null },
      { id:'a4', nome_completo:'DIEGO CARTA', telefone_whatsapp:'', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s2', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'carta_registrada', status_contato_alternativo:'enviado', data_confirmacao:null },
    ],
    sime_contatos_externos: [], sime_campanhas: [], sime_campanha_etapas: [],
    sime_campanhas_confirmacao: [
      { id:'camp1', ator_id:'a2', mensagem_enviada:'Olá Bruno, confirme sua presença como mesário na Seção 30, Grupo Escolar A, no dia 04/10.', status:'enviado', created_at:'2026-08-18T14:00:00.000Z' },
    ],
  };
}

async function abrir(ctx, m, path = 'SIME_convocacao.html') {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/' + path);
  await p.waitForTimeout(400);
  return { p, erros };
}
async function login(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── 1. Login + Dashboard (cards por local, com drilldown por seção) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());

  check('sem sessão: login-overlay visível', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none'));
  await login(p);
  check('login some após entrar', await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display === 'none'));
  check('cabeçalho mostra a zona', /7ª Zona/.test(await p.locator('#h-sub').textContent()));

  const dash = await p.locator('.content').textContent();
  check('stat card: 2 locais de votação', /Locais de votação\s*2/.test(dash.replace(/\s+/g, ' ')), dash.replace(/\s+/g, ' ').slice(0, 300));
  check('stat card: 3 seções', /Seções\s*3/.test(dash.replace(/\s+/g, ' ')), dash.replace(/\s+/g, ' ').slice(0, 300));
  check('stat card: 4 mesários', /Mesários\s*4/.test(dash.replace(/\s+/g, ' ')), dash.replace(/\s+/g, ' ').slice(0, 300));
  check('stat card: 0 apoio logístico', /Apoio logístico\s*0/.test(dash.replace(/\s+/g, ' ')), dash.replace(/\s+/g, ' ').slice(0, 300));
  check('resumo: 1 seção sem nenhum cargo designado (Escola B)', /1 seção\(ões\) sem nenhum cargo designado/.test(dash));

  const cardGrupoA = await p.locator('.import-card:has-text("Grupo Escolar A")').first().textContent();
  check('card do local: Grupo Escolar A mostra 2 seções', /Seções[\s\S]*?02/.test(cardGrupoA) || /\b2\b/.test(cardGrupoA), cardGrupoA.replace(/\s+/g, ' '));
  // % é sobre CONFIRMADOS (só Ana), não designados (Ana+Bruno+Carla+Diego) —
  // achado real: seção com mesário nunca contactado batia 100%/verde antes
  // dessa correção (20/08/2026). 1 confirmado de 8 cargos = 13%; os outros
  // 3 designados (mas não confirmados) aparecem numa nota à parte.
  check('card do local: Grupo Escolar A mostra 1/8 confirmados (13%), não 4/8 (50%)', /1\/8/.test(cardGrupoA) && /13%/.test(cardGrupoA) && !/50%/.test(cardGrupoA), cardGrupoA.replace(/\s+/g, ' '));
  check('card do local: nota separada mostra os 4/8 designados (nem todos confirmaram)', /4\/8 designados/.test(cardGrupoA), cardGrupoA.replace(/\s+/g, ' '));

  const cardEscolaB = await p.locator('.import-card:has-text("Escola B")').first().textContent();
  check('card do local: Escola B (nenhum mesário) mostra 0/4 e 0%', /0\/4/.test(cardEscolaB) && /0%/.test(cardEscolaB), cardEscolaB.replace(/\s+/g, ' '));

  // Busca filtra os cards
  await p.fill('input[placeholder*="Pesquisar"]', 'Escola B');
  await p.waitForTimeout(150);
  check('busca: só sobra Escola B', !/Grupo Escolar A/.test(await p.locator('.content').textContent()) && /Escola B/.test(await p.locator('.content').textContent()));
  await p.fill('input[placeholder*="Pesquisar"]', '');
  await p.waitForTimeout(150);

  // Alternar pra lista
  await p.click('button[aria-label="Ver em lista"]');
  await p.waitForTimeout(150);
  check('modo lista: continua mostrando os 2 locais', /Grupo Escolar A/.test(await p.locator('.content').textContent()) && /Escola B/.test(await p.locator('.content').textContent()));

  // Clica no local pra ver o drilldown por seção
  await p.click('.import-card:has-text("Grupo Escolar A")');
  await p.waitForTimeout(200);
  const drilldown = await p.locator('.content').textContent();
  check('drilldown: mostra botão de voltar', await p.locator('button:has-text("← Voltar")').count() === 1);
  check('drilldown: mostra a seção 30 com eleitores (280)', /280/.test(drilldown) && /30/.test(drilldown), drilldown.replace(/\s+/g, ' ').slice(0, 300));
  const cardSecao30 = await p.locator('.import-card:has-text("30")').first().textContent();
  check('drilldown: seção 30 mostra ✅ (Presidente confirmado)', cardSecao30.includes('✅'), cardSecao30);
  check('drilldown: seção 30 mostra o nome de quem está designado em cada cargo', /ANA/.test(cardSecao30) && /BRUNO/.test(cardSecao30), cardSecao30.replace(/\s+/g, ' '));

  // Clicar no nome do mesário no Dashboard abre o mesmo modal de "Contatar
  // mesários" (tentativas de contato) — mesmo sem essa aba ter sido visitada
  // ainda nesta sessão (cmDados começa null, precisa carregar na hora).
  check('modal fechado antes do clique', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));
  // Bruno (não Ana) — é quem tem a tentativa de campanha na fixture, o que
  // também confirma que o clique abriu a pessoa certa, não qualquer uma.
  await p.locator('.import-card:has-text("30") div[onclick*="cmAbrirModal"]').filter({ hasText: 'BRUNO' }).first().click();
  await p.waitForTimeout(300);
  check('clicar no nome do mesário no Dashboard abre o modal (cmDados carrega na hora)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('modal aberto a partir do Dashboard mostra a tentativa de contato', /confirme sua presença/.test(await p.locator('#modal-body').textContent()));
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(100);

  await p.click('button:has-text("← Voltar")');
  await p.waitForTimeout(150);
  check('voltar: volta pra grade de locais', /Grupo Escolar A/.test(await p.locator('.content').textContent()) && await p.locator('button:has-text("← Voltar")').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Contatar mesários: badges, meio de contato, marcar contato incorreto ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const bodyTxt = await p.locator('.content').textContent();
  check('lista os 4 mesários carregados', (bodyTxt.match(/ANA PRESIDENTE|BRUNO MESARIO|CARLA RECUSOU|DIEGO CARTA/g) || []).length === 4);

  const cardCarla = await p.locator('.import-card:has-text("CARLA RECUSOU")').first();
  check('mostra o recado (observação) de quem recusou', /não sou essa pessoa/.test(await cardCarla.textContent()));
  const btnIncorreto = cardCarla.locator('button:has-text("Marcar contato incorreto")');
  check('botão "marcar contato incorreto" aparece pra quem recusou', await btnIncorreto.count() === 1);

  const cardAna = p.locator('.import-card:has-text("ANA PRESIDENTE")').first();
  check('confirmado NÃO tem botão de marcar contato incorreto', await cardAna.locator('button:has-text("Marcar contato incorreto")').count() === 0);

  await btnIncorreto.click();
  await p.waitForTimeout(200);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.payload.confirmacao === 'contato_incorreto'));
  check('marcar contato incorreto grava confirmacao=contato_incorreto', !!upd, JSON.stringify(upd));
  check('badge da Carla vira "Contato incorreto" depois do clique', /Contato incorreto/.test(await p.locator('.import-card:has-text("CARLA RECUSOU")').first().textContent()));

  const cardDiego = p.locator('.import-card:has-text("DIEGO CARTA")').first();
  check('quem já está em Carta Registrada mostra o seletor de status de envio', await cardDiego.locator('select').count() === 2, String(await cardDiego.locator('select').count()));
  check('sem telefone cadastrado avisa em vez de link quebrado', /Sem telefone cadastrado/.test(await cardDiego.textContent()));

  // Filtro por status
  await p.selectOption('#cm-filtro', 'pendente');
  await p.waitForTimeout(200);
  const filtrado = await p.locator('.content').textContent();
  check('filtro "falta contactar" esconde quem já confirmou', !/ANA PRESIDENTE/.test(filtrado) && /BRUNO MESARIO/.test(filtrado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.7 Título de eleitor: aparece no card e dá pra buscar por ele ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const cardBruno = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  check('card mostra o título de eleitor de quem tem cadastrado', /046919051589/.test(await cardBruno.textContent()));

  await p.fill('input[placeholder*="título de eleitor"]', '046919051589');
  await p.waitForTimeout(200);
  const porTitulo = await p.locator('.content').textContent();
  check('buscar pelo número do título encontra só quem bate', /BRUNO MESARIO/.test(porTitulo) && !/ANA PRESIDENTE/.test(porTitulo), porTitulo.slice(0, 200));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.5 Criar campanha com estes: leva o filtro atual pra Disparo em massa (Atores) já pré-selecionado ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // Filtra por "falta contactar" (pendente) — bate com BRUNO (tem WhatsApp) e
  // DIEGO (só carta registrada, sem telefone — não pode entrar numa campanha de WhatsApp).
  await p.selectOption('#cm-filtro', 'pendente');
  await p.waitForTimeout(200);
  const btnCampanha = p.locator('button:has-text("Criar campanha com estes")');
  check('botão mostra só quem tem WhatsApp no filtro (1, não 2)', /\(1\)/.test(await btnCampanha.textContent()), await btnCampanha.textContent());

  await btnCampanha.click();
  await p.waitForTimeout(500); // navega pra SIME_atores.html

  check('navegou pra Atores com a aba de disparo já selecionada', /SIME_atores\.html\?tab=disparo/.test(p.url()), p.url());
  check('aba "Disparo em massa" fica marcada como ativa', await p.locator('#tab-disparo-btn.active').count() === 1);
  const selecionados = await p.evaluate(() => [...dispSelecionados]);
  check('só o Bruno (único com WhatsApp no filtro) veio pré-selecionado', selecionados.length === 1 && selecionados[0] === 'a2', JSON.stringify(selecionados));
  const toastTxt = await p.locator('.toast').textContent().catch(() => '');
  check('avisa quantos destinatários vieram de Convocação', /1 destinatário/.test(toastTxt), toastTxt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.6 Modal do mesário: clique no nome, editar telefone/rastreio, tentativas de contato e histórico ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  check('modal começa fechado', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));

  const cardBruno = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  await cardBruno.locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(80);
  check('clicar no nome abre o modal', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('modal mostra o nome no título', /BRUNO MESARIO/.test(await p.locator('#modal-body .m-title').textContent()));
  check('modal mostra o título de eleitor', /046919051589/.test(await p.locator('#modal-body').textContent()));
  check('sem código ainda, não mostra link de rastrear', await p.locator('#modal-body a:has-text("Rastrear no site dos Correios")').count() === 0);

  // Histórico carrega em paralelo (começa "Carregando…", depois preenche).
  await p.waitForTimeout(200);
  const modalTxt = await p.locator('#modal-body').textContent();
  check('mostra a campanha já enviada pro Bruno (tentativa de contato)', /Enviado/.test(modalTxt) && /confirme sua presença/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 400));
  check('mostra a atualização anterior (histórico)', /Meio de contato.*Carta Registrada/.test(modalTxt.replace(/\s+/g, ' ')), modalTxt.replace(/\s+/g, ' ').slice(0, 400));
  check('mostra também a confirmação feita pelo próprio mesário via Hermes/WhatsApp (casada por afetados, não por ator_id)', /Confirmou por WhatsApp/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 400));

  await p.fill('#mm-rastreio', 'aa123456789br');
  await p.fill('#mm-tel', '(86) 98888-7777');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2'));
  check('salvar grava telefone e rastreio juntos, num update só', upd?.payload?.telefone_whatsapp === '86988887777' && upd?.payload?.codigo_rastreio === 'AA123456789BR', JSON.stringify(upd));
  check('salvar fecha o modal', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));

  // Reabre: reflete o telefone/rastreio novos e agora mostra o link de rastrear.
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(80);
  const linkRastreio = p.locator('#modal-body a:has-text("Rastrear no site dos Correios")');
  check('link de rastrear aparece depois de salvar, apontando pro site oficial', /rastreamento\.correios\.com\.br.*AA123456789BR/.test(await linkRastreio.getAttribute('href') || ''), await linkRastreio.getAttribute('href'));

  // Fechar clicando no fundo do overlay (fora do modal).
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(80);
  check('clicar fora do modal fecha', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.8 "Precisa ser substituído": flag manual do cartório, separada de confirmacao=substituido ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const cardAna = p.locator('.import-card:has-text("ANA PRESIDENTE")').first();
  check('sem flag ainda, não mostra badge "Precisa substituto"', !/Precisa substituto/.test(await cardAna.textContent()));

  await cardAna.locator('button:has-text("Marcar para substituir")').click();
  await p.waitForTimeout(200);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.payload.precisa_substituir === true));
  check('marcar grava precisa_substituir=true (mesmo alguém já confirmado)', !!upd && upd.filtro.id === 'a1', JSON.stringify(upd));
  check('badge "Precisa substituto" aparece no card', /Precisa substituto/.test(await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().textContent()));
  check('botão vira "Desmarcar substituição"', await p.locator('.import-card:has-text("ANA PRESIDENTE") button:has-text("Desmarcar substituição")').count() === 1);

  // Filtro dedicado — é uma flag independente de confirmacao, não reaproveita o bucket "substituído".
  await p.selectOption('#cm-filtro', 'precisa_substituir');
  await p.waitForTimeout(150);
  const filtrado = await p.locator('.content').textContent();
  check('filtro "precisa ser substituído" mostra só quem está marcado', /ANA PRESIDENTE/.test(filtrado) && !/BRUNO MESARIO/.test(filtrado), filtrado.replace(/\s+/g, ' ').slice(0, 200));
  await p.selectOption('#cm-filtro', '');
  await p.waitForTimeout(150);

  // O Dashboard reflete a flag com um ícone próprio (🔁), mesmo pra quem já tinha confirmado.
  await p.click('#tab-dashboard-btn');
  await p.waitForTimeout(300);
  await p.click('.import-card:has-text("Grupo Escolar A")');
  await p.waitForTimeout(200);
  const cardSecao30 = await p.locator('.import-card:has-text("30")').first().textContent();
  check('Dashboard: seção 30 mostra 🔁 pro Presidente marcado, não mais ✅', cardSecao30.includes('🔁') && !cardSecao30.includes('✅'), cardSecao30.replace(/\s+/g, ' '));

  // Desmarcar pelo modal (mesmo botão existe lá dentro).
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);
  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  await p.click('#modal-body button:has-text("Desmarcar substituição")');
  await p.waitForTimeout(150);
  check('desmarcar pelo modal atualiza o modal na hora (sem precisar fechar/reabrir)', /Marcar para substituir/.test(await p.locator('#modal-body').textContent()));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Sincronizar (reaproveitado de SIME_atores.html, agora na página própria) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-sync-btn');
  await p.waitForTimeout(200);
  check('aba sincronizar renderiza a zona de upload', await p.locator('#ms-csv-input').count() === 1);

  // ── Atualizar contatos (formato de 16 colunas, com Ciente) ──
  const mcHeaders = ['Zona','Seção','Nome','Inscrição','Situação','Localidade','Nº Local','Nome Local','Cód. Objeto Local','Nº Função Eleitoral','Função Eleitoral','Data Atualização','Ciente','whatsapp','celular','telefone2'];
  const mcRow = (over) => mcHeaders.map(h => over[h] ?? '').join(',');
  const mcCsv = [
    mcHeaders.join(','),
    // casa com BRUNO (inscricao_eleitoral='046919051589') — Ciente=1, telefone novo
    mcRow({ 'Inscrição':'046919051589', 'Ciente':'1', 'whatsapp':'86988887777' }),
    // não casa com ninguém do mock
    mcRow({ 'Inscrição':'999999999999', 'Ciente':'2', 'whatsapp':'86977776666' }),
  ].join('\n');
  const mcPath = '/tmp/_sime_test_contatos.csv';
  writeFileSync(mcPath, mcCsv, 'utf8');
  await p.setInputFiles('#mc-csv-input', mcPath);
  await p.waitForTimeout(300);
  unlinkSync(mcPath);

  check('carrega o arquivo de contatos (2 linhas)', /2 linha\(s\)/.test(await p.locator('.content').textContent()));
  await p.click('button:has-text("✓ Atualizar contatos")');
  await p.waitForTimeout(300);

  const updBruno = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.inscricao_eleitoral === '046919051589'));
  check('atualiza confirmacao=confirmado pra Ciente=1', updBruno?.payload?.confirmacao === 'confirmado', JSON.stringify(updBruno));
  check('atualiza telefone junto', updBruno?.payload?.telefone_whatsapp === '86988887777', JSON.stringify(updBruno));
  check('Bruno realmente mudou no mock (não só o log de escrita)', await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2').confirmacao) === 'confirmado');

  const resumo = await p.locator('.content').textContent();
  check('mostra 1 atualizado e 1 sem cadastro correspondente', /1.*atualizado/.test(resumo) && /1.*sem cadastro correspondente/.test(resumo), resumo.replace(/\s+/g, ' ').slice(0, 400));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3.5 Colar lista de telefones (texto livre, sem CSV) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-sync-btn');
  await p.waitForTimeout(200);
  check('aba sincronizar mostra o textarea de colar lista', await p.locator('#cp-textarea').count() === 1);

  const texto = [
    // Bruno (título 046919051589) — telefone limpo, 11 dígitos com DDD: atualiza.
    'BRUNO MESARIO\t0469 1905 1589\t(86) 98666-5544',
    // Título válido mas ninguém no mock com essa inscrição: sem cadastro correspondente.
    'FULANO SEM CADASTRO\t9999 9999 9999\t86988887777',
    // Sem nenhum bloco de 12 dígitos reconhecível como título: ignorada.
    'CICLANO SEM TITULO\ttelefone (86) 99999-0000',
    // Título ok, telefone fora de qualquer formato válido (14 dígitos, o
    // mesmo problema real encontrado numa lista de verdade): ignorada.
    'BELTRANO TELEFONE RUIM\t0410 7737 1570\t5508699485-70951',
  ].join('\n');
  await p.fill('#cp-textarea', texto);
  await p.click('button:has-text("Processar e atualizar")');
  await p.waitForTimeout(300);

  const updBruno2 = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.inscricao_eleitoral === '046919051589' && e.payload.telefone_whatsapp === '86986665544'));
  check('linha limpa (título+telefone válidos) grava só telefone_whatsapp, sem mexer em confirmacao', !!updBruno2 && !('confirmacao' in updBruno2.payload), JSON.stringify(updBruno2));

  const resumoTxt = await p.locator('.content').textContent();
  check('resumo: 1 atualizado, 1 sem cadastro correspondente, de 4 linhas coladas', /1 telefone\(s\) atualizado/.test(resumoTxt) && /1 sem cadastro correspondente/.test(resumoTxt) && /4 linha\(s\) coladas/.test(resumoTxt), resumoTxt.replace(/\s+/g, ' ').slice(0, 400));
  check('lista as 2 linhas ignoradas pra conferência manual (título e telefone não reconhecidos)', /2 linha\(s\) ignorada/.test(resumoTxt) && /título de eleitor não reconhecido/.test(resumoTxt) && /telefone não reconhecido/.test(resumoTxt), resumoTxt.replace(/\s+/g, ' ').slice(0, 600));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Histórico ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-historico-btn');
  await p.waitForTimeout(300);
  const hist = await p.locator('.content').textContent();
  check('histórico mostra a sincronização registrada', /290/.test(hist) && /280/.test(hist) && /\b5\b/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 300));
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. SIME_atores.html não tem mais as duas abas (migraram pra cá) ──
{
  const ctx = await b.newContext();
  const mAtores = {
    escritas: [], sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_secoes: [], sime_contatos_externos: [], sime_atores: [], sime_campanhas: [], sime_campanha_etapas: [],
  };
  const { p, erros } = await abrir(ctx, mAtores, 'SIME_atores.html');
  await p.waitForTimeout(300);
  check('Atores: aba "Sincronizar mesários" não existe mais', await p.locator('#tab-sync-mesarios-btn').count() === 0);
  check('Atores: aba "Resumo por Seção" não existe mais', await p.locator('#tab-resumo-secoes-btn').count() === 0);
  check('Atores: tem link pra Convocação de Mesários', await p.locator('a[href="./SIME_convocacao.html"]').count() === 1);
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
