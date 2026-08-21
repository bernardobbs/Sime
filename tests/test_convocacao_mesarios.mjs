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
  insert(p){
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    // Empurra pra tabela mockada também (não só pro log de escritas) — sem
    // isso, um insert seguido de um select (ex.: registrar tentativa de
    // contato e a timeline recarregar na hora) nunca via a linha nova.
    if(!window.__mock[this.t]) window.__mock[this.t]=[];
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ...row }));
    window.__mock[this.t].push(...linhas);
    return Promise.resolve({ error:null, data:linhas });
  }
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
  then(res, rej){
    // Simula uma falha de REDE de verdade (não um erro de banco) — o await
    // rejeita de propósito, pra testar que cmSalvarModal() não fica em
    // silêncio quando isso acontece (bug real reportado em 21/08/2026).
    if(window.__mock.forcarErroRedeTabela === this.t && this._op === 'update'){
      return (rej || (()=>{}))(new Error('Falha de rede simulada'));
    }
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
      if(name==='sime_now') return Promise.resolve({ data:'2026-08-20T15:30:00.000Z', error:null });
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
    // Necessário pra getEleicaoAtiva() (sime_dados.js), que log() agora chama
    // pra preencher eleicao_id no insert — ver bug real de 21/08/2026 (RLS de
    // SELECT em sime_logs exige eleicao_id IN (...), NULL nunca casava).
    sime_eleicoes: [{ id:'el7', zona_id:'z7', turno:1, ativa:true, nome:'Eleições 2026' }],
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
      { id:'a5', nome_completo:'ELIS APOIO', telefone_whatsapp:'5586999990005', funcao:'auxiliar_eleicao', secao_id:'s1', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null },
      { id:'a6', nome_completo:'FABIO APOIO', telefone_whatsapp:'5586999990006', funcao:'coord_acessibilidade', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null },
      // Coordenador de Acessibilidade COM secao_id (diferente de FABIO,
      // deliberadamente sem) — só pra ter alguém "designado mas não
      // confirmado" nesse grupo e exercitar as 3 fatias da pizza nova do
      // Dashboard (21/08/2026). Sem telefone de propósito, pra não mudar a
      // contagem "(2)" do teste de campanha em massa (2.5) que já soma só
      // BRUNO+FABIO como "pendente com WhatsApp".
      { id:'a7', nome_completo:'GEORGE COORD', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:'s2', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null },
    ],
    sime_contatos_externos: [], sime_campanhas: [], sime_campanha_etapas: [],
    sime_campanhas_confirmacao: [
      { id:'camp1', ator_id:'a2', zona_id:'z7', mensagem_enviada:'Olá Bruno, confirme sua presença como mesário na Seção 30, Grupo Escolar A, no dia 04/10.', status:'enviado', created_at:'2026-08-18T14:00:00.000Z' },
    ],
    // Telefones alternativos do TRE (21/08/2026) — o cadastro real do ELO
    // tem até 5 campos de telefone por pessoa, mas só um vira
    // telefone_whatsapp; os outros continuam aqui no staging. Bruno tem um
    // telefone_1_eleitor DIFERENTE do que está salvo, pra testar que o modal
    // mostra isso como referência. Casa por `inscricao` (não ator_id — esse
    // nunca foi preenchido em produção, ver achado real de 21/08/2026).
    sime_mesarios_raw: [
      { id:'raw1', inscricao:'046919051589', telefone_pessoal_mesario:'', telefone_1_eleitor:'5586977778888', telefone_2_eleitor:'', telefone_contato_eleitor:'', telefone_comercial_mesario:'', importado_em:'2026-08-20T09:00:00.000Z' },
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
  check('stat card MRV: 1 confirmado de 4, 3 faltam', /Mesários \(MRV\)\s*1\/4/.test(dash.replace(/\s+/g, ' ')) && /3 faltam confirmar/.test(dash), dash.replace(/\s+/g, ' ').slice(0, 400));
  // Apoio (headcount combinado, stat card) agora são 3: ELIS (auxiliar,
  // confirmado), FABIO e GEORGE (coord_acessibilidade, ambos pendentes) —
  // GEORGE existe só pra dar às pizzas novas do Dashboard um caso "designado
  // mas não confirmado" no grupo Coord. de Acessibilidade (ver fixture a7).
  check('stat card AL: 1 confirmado de 3, 2 faltam', /Apoio logístico \(AL\)\s*1\/3/.test(dash.replace(/\s+/g, ' ')) && /2 faltam confirmar/.test(dash), dash.replace(/\s+/g, ' ').slice(0, 400));

  // Redesenho de 21/08/2026: barra-funil da zona inteira (Total/Convocados/
  // Confirmados somando MRV+Coord+Auxiliar) + 3 pizzas de 3 fatias
  // (Confirmado/Convocado/Vazio), uma por grupo — substitui o desenho
  // anterior de 4 pizzas de 2 fatias.
  const dashFlat = dash.replace(/\s+/g, ' ');
  // Funil: MRV totalCargos=12 (3 seções×4) + 2 locais×2 funções(coord+aux)=4 → 16 total.
  // Convocados = mrvDesignados(4) + locaisComCoord(1, Grupo Escolar A via GEORGE) + locaisComAuxiliar(1, via ELIS) = 6.
  // Confirmados = mrvConfirmadoCargos(1, só ANA) + locaisComCoordConfirmado(0) + locaisComAuxiliarConfirmado(1) = 2.
  check('barra-funil da zona: Total 16, Convocados 6, Confirmados 2', /Total de vagas:\s*16/.test(dashFlat) && /Convocados:\s*6/.test(dashFlat) && /Confirmados:\s*2/.test(dashFlat), dashFlat.slice(0, 500));

  const cardPizzaMRV = await p.locator('.import-card:has-text("MRV (Mesários)")').first().textContent();
  check('pizza MRV (3 fatias): confirmado 1, convocado 3, vazio 8, total 12', /Confirmado:\s*1/.test(cardPizzaMRV) && /Convocado:\s*3/.test(cardPizzaMRV) && /Vazio:\s*8/.test(cardPizzaMRV) && /Total:\s*12/.test(cardPizzaMRV), cardPizzaMRV.replace(/\s+/g, ' '));

  // .last() (não .first()) — a barra-funil acima também menciona os nomes
  // dos 3 grupos no título ("MRV + Coordenadores de Acessibilidade +
  // Auxiliares de Eleição"), então :has-text() bate nela primeiro; a pizza
  // de verdade vem depois no DOM.
  const cardPizzaCoord = await p.locator('.import-card:has-text("Coordenadores de Acessibilidade")').last().textContent();
  check('pizza Coord. de Acessibilidade (3 fatias): confirmado 0, convocado 1 (GEORGE), vazio 1 (Escola B)', /Confirmado:\s*0/.test(cardPizzaCoord) && /Convocado:\s*1/.test(cardPizzaCoord) && /Vazio:\s*1/.test(cardPizzaCoord) && /Total:\s*2/.test(cardPizzaCoord), cardPizzaCoord.replace(/\s+/g, ' '));

  const cardPizzaAux = await p.locator('.import-card:has-text("Auxiliares de Eleição")').last().textContent();
  check('pizza Auxiliar de Eleição (3 fatias): confirmado 1 (ELIS), convocado 0, vazio 1 (Escola B)', /Confirmado:\s*1/.test(cardPizzaAux) && /Convocado:\s*0/.test(cardPizzaAux) && /Vazio:\s*1/.test(cardPizzaAux) && /Total:\s*2/.test(cardPizzaAux), cardPizzaAux.replace(/\s+/g, ' '));

  check('pizzas usam gráfico SVG (donut), não só texto', await p.locator('.content svg').count() >= 3);
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

  const cardBruno0 = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  check('pendente com campanha já enviada mostra "já contactado", não só "falta contactar"', /Já contactado \(1x\) — aguardando resposta/.test(await cardBruno0.textContent()), await cardBruno0.textContent());
  const cardAna0 = p.locator('.import-card:has-text("ANA PRESIDENTE")').first();
  check('quem já confirmou não mostra a anotação de tentativa (já resolvido)', !/Já contactado/.test(await cardAna0.textContent()));

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

  // Filtra por "falta contactar" (pendente) — bate com BRUNO e FABIO (apoio
  // logístico, tem WhatsApp) e DIEGO (só carta registrada, sem telefone —
  // não pode entrar numa campanha de WhatsApp).
  await p.selectOption('#cm-filtro', 'pendente');
  await p.waitForTimeout(200);
  const btnCampanha = p.locator('button:has-text("Criar campanha com estes")');
  check('botão mostra só quem tem WhatsApp no filtro (2, não 3)', /\(2\)/.test(await btnCampanha.textContent()), await btnCampanha.textContent());

  await btnCampanha.click();
  await p.waitForTimeout(500); // navega pra SIME_atores.html

  check('navegou pra Atores com a aba de disparo já selecionada', /SIME_atores\.html\?tab=disparo/.test(p.url()), p.url());
  check('aba "Disparo em massa" fica marcada como ativa', await p.locator('#tab-disparo-btn.active').count() === 1);
  const selecionados = await p.evaluate(() => [...dispSelecionados]);
  check('Bruno e Fabio (com WhatsApp no filtro) vieram pré-selecionados', selecionados.length === 2 && selecionados.includes('a2') && selecionados.includes('a6'), JSON.stringify(selecionados));
  const toastTxt = await p.locator('.toast').textContent().catch(() => '');
  check('avisa quantos destinatários vieram de Convocação', /2 destinatário/.test(toastTxt), toastTxt);

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

  // Rastreio só existe no DOM com Carta Registrada (ver 2.95) — muda o meio primeiro.
  await p.selectOption('#modal-body select >> nth=0', 'carta_registrada');
  await p.waitForTimeout(150);
  await p.fill('#mm-rastreio', 'aa123456789br');
  await p.fill('#mm-tel', '(86) 98888-7777');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && 'telefone_whatsapp' in e.payload));
  // Grava COM o 55 na frente (21/08/2026) — mesma convenção do resto do
  // sistema (Ciente/colar-lista); antes desse fix, comparar o campo (exibido
  // sem 55) com o valor guardado (com 55) sempre achava "mudou" e regravava
  // sem o 55 a cada Salvar, mesmo sem editar nada.
  check('salvar grava telefone (com 55, convenção do banco) e rastreio juntos, num update só', upd?.payload?.telefone_whatsapp === '5586988887777' && upd?.payload?.codigo_rastreio === 'AA123456789BR', JSON.stringify(upd));
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

// ── 2.62 Telefones alternativos do cadastro do TRE (achado real 21/08/2026: um mesário pode ter mais de um telefone no ELO) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  const modalTxt = await p.locator('#modal-body').textContent();
  check('modal mostra a seção de telefones alternativos do TRE', /Outros telefones no cadastro do TRE/.test(modalTxt));
  check('mostra o telefone alternativo (telefone_1_eleitor, diferente do salvo)', /Telefone 1 \(eleitor\)/.test(modalTxt) && /\(86\) 97777-8888/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 500));

  // Copiar um telefone alternativo não registra tentativa nem mexe no
  // telefone salvo — é só referência.
  await p.evaluate(() => {
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } } });
  });
  await p.locator('#modal-body .m-hist-item button:has-text("Copiar")').first().click();
  await p.waitForTimeout(100);
  const copiado = await p.evaluate(() => window.__clipboardText);
  check('copiar telefone alternativo copia o valor certo', copiado === '5586977778888', copiado);
  const tentativaIndevida = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_tentativa_contato'));
  check('copiar telefone alternativo NÃO registra tentativa de contato sozinho', !tentativaIndevida, JSON.stringify(tentativaIndevida));

  // Ana não tem nenhuma linha em sime_mesarios_raw — não deve mostrar a seção.
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(80);
  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  check('sem registro correspondente no TRE, não mostra a seção de telefones alternativos', !/Outros telefones no cadastro do TRE/.test(await p.locator('#modal-body').textContent()));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.65 Modal como hub de comunicação: wa.me, meio de contato dentro do modal, registrar tentativa manual ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  // Copia o link (em vez de abrir, 21/08/2026 — indo de nome em nome, abrir
  // uma aba/app novo a cada clique era mais disruptivo do que precisava).
  // navigator.clipboard não funciona em Chromium headless sem concessão de
  // permissão — mocka aqui só pra capturar o texto escrito.
  // navigator.clipboard só tem getter no protótipo real (sem setter) — uma
  // atribuição direta é ignorada em silêncio. Object.defineProperty troca o
  // descritor de fato.
  await p.evaluate(() => {
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } } });
  });
  const btnCopiarWa = p.locator('#modal-body button:has-text("Copiar link do WhatsApp")');
  check('modal tem botão de copiar link do wa.me de quem tem telefone', await btnCopiarWa.count() === 1);
  await btnCopiarWa.click();
  await p.waitForTimeout(100);
  const linkCopiado = await p.evaluate(() => window.__clipboardText);
  check('link copiado aponta pro número da pessoa', /5586999990002|86999990002|999990002/.test(linkCopiado || ''), linkCopiado);
  // Pedido de 21/08/2026: mensagem pré-preenchida (?text=) perguntando se o
  // contato é da pessoa certa — evita digitar a mesma pergunta a cada
  // conversa nova aberta indo de nome em nome.
  check('link copiado já vem com a mensagem de confirmação pré-preenchida', (linkCopiado || '').includes('?text=' + encodeURIComponent('Bom dia, esse contato é de BRUNO MESARIO ?')), linkCopiado);
  // Pedido de 21/08/2026: copiar o link do WhatsApp já deve contar como
  // tentativa de contato, sem precisar preencher a Nota separada.
  const tentativaAutoWa = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_tentativa_contato' && e.payload.payload?.meio === 'whatsapp'));
  check('copiar o link do WhatsApp já registra a tentativa sozinho', !!tentativaAutoWa && tentativaAutoWa.payload.payload.ator_id === 'a2', JSON.stringify(tentativaAutoWa));
  await p.waitForTimeout(150);
  const modalTxtWa = await p.locator('#modal-body').textContent();
  check('a tentativa automática do WhatsApp aparece na timeline', /Copiou o link do WhatsApp/.test(modalTxtWa), modalTxtWa.replace(/\s+/g, ' ').slice(0, 300));

  // Meio de contato dentro do modal (não só no card) — trocar pra Ligação
  // dispara o mesmo cmSalvarMeio de sempre e o modal se atualiza sozinho.
  check('modal tem o seletor de meio de contato', await p.locator('#modal-body select').count() >= 1);
  await p.selectOption('#modal-body select >> nth=0', 'ligacao');
  await p.waitForTimeout(150);
  const updMeio = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.payload.meio_contato === 'ligacao'));
  check('trocar o meio dentro do modal grava igual ao card', !!updMeio, JSON.stringify(updMeio));
  check('modal continua aberto e mostra o seletor de resultado da ligação', /Resultado da ligação/.test(await p.locator('#modal-body').textContent()));

  // Registrar uma tentativa manual — vira parte da timeline de "Tentativas de contato".
  await p.fill('#mm-tent-nota', 'Liguei às 14h, não atendeu');
  await p.click('#modal-body button:has-text("Registrar tentativa")');
  await p.waitForTimeout(250);
  // .find() por acao sozinho pegaria a tentativa automática do WhatsApp
  // (registrada mais cedo neste mesmo bloco) — filtra também pela nota.
  const updTentativa = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_tentativa_contato' && e.payload.payload?.nota === 'Liguei às 14h, não atendeu'));
  check('registrar tentativa grava log com ator_id, meio e nota', updTentativa?.payload?.payload?.ator_id === 'a2' && updTentativa?.payload?.payload?.nota === 'Liguei às 14h, não atendeu', JSON.stringify(updTentativa));
  // Bug real corrigido em 21/08/2026: o insert nunca preenchia eleicao_id, e
  // a policy de SELECT de sime_logs (eleicao_id IN (...)) nunca casa com
  // NULL — a tentativa "sumia" pra sempre na releitura, mesmo com a escrita
  // tendo sucedido (é o que causava "Registrar tentativa" parecer não
  // funcionar). Sem eleicao_id no insert, este check falha de novo.
  check('registrar tentativa preenche eleicao_id (senão fica invisível pela RLS de sime_logs)', updTentativa?.payload?.eleicao_id === 'el7', JSON.stringify(updTentativa));
  const modalTxtDepois = await p.locator('#modal-body').textContent();
  check('a tentativa manual aparece na timeline de Tentativas de contato', /Liguei às 14h, não atendeu/.test(modalTxtDepois));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.66 "Salvar" geral não perde nota de tentativa/observação digitada e não salva ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // Achado real (21/08/2026): usuário digita numa caixa de tentativa/observação
  // e clica no "💾 Salvar" do rodapé (não no botão específico) — o texto se
  // perdia em silêncio porque só telefone/rastreio eram cobertos ali.
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);

  await p.fill('#mm-tent-nota', 'Enviado pelo contato da escola');
  await p.fill('#mm-obs-nova', 'Falou que vai confirmar amanhã');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(250);

  const tentativaGravada = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_tentativa_contato' && e.payload.payload.nota === 'Enviado pelo contato da escola'));
  check('Salvar geral também grava a nota de tentativa pendente (não perde mais)', !!tentativaGravada, JSON.stringify(tentativaGravada));
  const obsGravada = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && (e.payload.observacao || '').includes('Falou que vai confirmar amanhã')));
  check('Salvar geral também grava a observação pendente (não perde mais)', !!obsGravada, JSON.stringify(obsGravada));

  // Sem nada digitado/alterado, "Salvar" ainda dá algum feedback (não fecha
  // em silêncio, o que parecia "não fez nada" pro usuário).
  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  const toastTxt = await p.locator('.toast').textContent().catch(() => '');
  check('Salvar sem nenhuma alteração avisa "Nada para salvar" em vez de fechar mudo', /Nada para salvar/.test(toastTxt), toastTxt);
  // Bug real (21/08/2026): o campo mostra o telefone SEM o "55" (fmtTelefone
  // tira o país pra exibir formatado), mas o banco guarda COM "55" — comparar
  // os dois direto sempre achava "mudou" e reescrevia o telefone sem o 55 a
  // cada Salvar, mesmo sem editar nada. Ana tem '5586999990001' guardado.
  const updTelAna = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && 'telefone_whatsapp' in e.payload));
  check('Salvar sem editar o telefone NÃO reescreve telefone_whatsapp (nem tira o 55 por engano)', !updTelAna, JSON.stringify(updTelAna));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.67 Bug real (21/08/2026): "Salvar" com falha de rede não fica em silêncio ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);

  // sb.from(...).update(...) não rejeita em erro de BANCO (resolve
  // {data,error}, já tratado) — mas uma falha de REDE de verdade (sem sinal,
  // timeout) faz o await lançar exceção. Antes do fix, cmSalvarModal() não
  // tinha try/catch: a exceção saía sem tratamento, cmFecharModal() nunca
  // era alcançado e não aparecia toast nenhum — parecia que o clique não fez
  // nada. window.__mock.forcarErroRedeTabela (ver STUB) simula essa falha.
  await p.evaluate(() => { window.__mock.forcarErroRedeTabela = 'sime_atores'; });
  await p.fill('#mm-tel', '(86) 90000-1111');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);

  check('falha de rede mostra um toast (não fica em silêncio)', /Falha ao salvar/.test(await p.locator('.toast').textContent().catch(() => '')), await p.locator('.toast').textContent().catch(() => ''));
  check('modal continua aberto (não perde a edição em andamento)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));

  // Tirando a falha simulada, "Salvar" volta a funcionar normalmente.
  await p.evaluate(() => { window.__mock.forcarErroRedeTabela = null; });
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);
  check('sem a falha, salvar volta a fechar o modal normalmente', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));

  check('zero erros JS (a exceção fica só dentro do try/catch, não estoura pra fora)', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.75 Observações no modal: adicionar (append-only, com autor e carimbo) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(250);
  check('sem observação ainda, mostra o vazio', /Nenhuma observação registrada ainda/.test(await p.locator('#modal-body').textContent()));

  await p.fill('#mm-obs-nova', 'Ligou e disse que confirma presença');
  await p.click('#modal-body button:has-text("Adicionar observação")');
  await p.waitForTimeout(200);

  const upd1 = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && typeof e.payload.observacao === 'string'));
  check('adicionar observação grava com carimbo, autor (nome do usuário logado) e o texto', /^\[2026-08-20 15:30\] Maria \(cartório\): Ligou e disse que confirma presença$/.test(upd1?.payload?.observacao || ''), JSON.stringify(upd1));

  const modalTxt1 = await p.locator('#modal-body').textContent();
  check('observação nova aparece na lista do modal', /Ligou e disse que confirma presença/.test(modalTxt1));
  check('campo de texto é limpo depois de adicionar', await p.inputValue('#mm-obs-nova') === '');

  await p.fill('#mm-obs-nova', 'Confirmou por telefone também');
  await p.click('#modal-body button:has-text("Adicionar observação")');
  await p.waitForTimeout(200);
  const modalTxt2 = await p.locator('#modal-body').textContent();
  check('segunda observação soma à primeira (não sobrescreve)', /Ligou e disse que confirma presença/.test(modalTxt2) && /Confirmou por telefone também/.test(modalTxt2), modalTxt2.replace(/\s+/g, ' ').slice(0, 400));
  const itensObs = await p.locator('.m-section:has-text("📝 Observações") .m-hist-item').allTextContents();
  check('lista mostra a mais recente primeiro', itensObs[0].includes('Confirmou por telefone também'), JSON.stringify(itensObs));

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

// ── 2.85 Confirmar manualmente: marca confirmado e enfileira a mensagem de convocação pro Hermes ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // BRUNO (a2) tem telefone — confirmar deve gravar confirmacao E enfileirar mensagem.
  const cardBruno = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  check('botão mostra "e enviar mensagem" pra quem tem telefone', /Confirmar e enviar mensagem/.test(await cardBruno.textContent()));
  await cardBruno.locator('button:has-text("Confirmar e enviar mensagem")').click();
  await p.waitForTimeout(250);

  const updConf = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.confirmacao === 'confirmado'));
  check('confirmar grava confirmacao=confirmado', !!updConf, JSON.stringify(updConf));
  const insMsg = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_campanhas_confirmacao' && e.payload.ator_id === 'a2'));
  check('enfileira em sime_campanhas_confirmacao com status pendente', insMsg?.payload?.status === 'pendente', JSON.stringify(insMsg));
  const msgTxt = insMsg?.payload?.mensagem_enviada || '';
  check('mensagem personalizada traz nome, função e seção da pessoa', /BRUNO MESARIO/.test(msgTxt) && /1º Mesário/.test(msgTxt) && /Seção 30/.test(msgTxt) && /Grupo Escolar A/.test(msgTxt), msgTxt);
  check('botão "Confirmar" some depois de confirmado', await p.locator('.import-card:has-text("BRUNO MESARIO") button:has-text("Confirmar")').count() === 0);

  // DIEGO (a4) não tem telefone — confirma mas NÃO enfileira mensagem (nada pra mandar).
  const cardDiego = p.locator('.import-card:has-text("DIEGO CARTA")').first();
  check('sem telefone, botão não promete enviar mensagem', /^✅ Confirmar$/.test((await cardDiego.locator('button:has-text("Confirmar")').textContent()).trim()));
  await cardDiego.locator('button:has-text("Confirmar")').click();
  await p.waitForTimeout(250);
  const updDiego = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a4' && e.payload.confirmacao === 'confirmado'));
  check('Diego (sem telefone) também é marcado confirmado', !!updDiego, JSON.stringify(updDiego));
  const insDiego = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_campanhas_confirmacao' && e.payload.ator_id === 'a4'));
  check('mas nada é enfileirado pro Diego (sem telefone pra mandar)', !insDiego);

  // O mesmo botão existe dentro do modal, pra quem ainda não confirmou.
  const cardCarla = p.locator('.import-card:has-text("CARLA RECUSOU")').first();
  await cardCarla.locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  check('modal mostra o botão de confirmar pra quem ainda não confirmou', await p.locator('#modal-body button:has-text("Confirmar convocação")').count() === 1);
  await p.click('#modal-body button:has-text("Confirmar convocação")');
  await p.waitForTimeout(250);
  const updCarla = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a3' && e.payload.confirmacao === 'confirmado'));
  check('confirmar pelo modal também grava confirmacao=confirmado', !!updCarla, JSON.stringify(updCarla));
  check('modal esconde o botão de confirmar depois de confirmado (sem precisar fechar/reabrir)', await p.locator('#modal-body button:has-text("Confirmar convocação")').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.9 Apoio logístico entra na mesma fila de contato dos mesários ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const bodyTxt = await p.locator('.content').textContent();
  check('lista inclui o apoio logístico, não só mesários', /ELIS APOIO/.test(bodyTxt) && /FABIO APOIO/.test(bodyTxt), bodyTxt.replace(/\s+/g, ' ').slice(0, 200));
  check('subtítulo avisa que cobre mesários e apoio logístico', /Mesários e apoio logístico/.test(bodyTxt));

  const cardElis = await p.locator('.import-card:has-text("ELIS APOIO")').first().textContent();
  check('apoio logístico (auxiliar_eleicao) mostra rótulo de função, não vazio/undefined', /Auxiliar de Serviços Eleitorais/.test(cardElis), cardElis.replace(/\s+/g, ' '));
  const cardFabio = await p.locator('.import-card:has-text("FABIO APOIO")').first().textContent();
  check('apoio logístico (coord_acessibilidade) mostra rótulo de função próprio', /Coordenador\(a\) de Acessibilidade/.test(cardFabio), cardFabio.replace(/\s+/g, ' '));

  // Filtro por função (21/08/2026) — independente do filtro de status, os dois se combinam.
  check('filtro de função tem as 4 opções (todas/mesário/coord. acessibilidade/auxiliar)', await p.locator('#cm-filtro-funcao option').count() === 4);
  await p.selectOption('#cm-filtro-funcao', 'auxiliar_eleicao');
  await p.waitForTimeout(150);
  const soAuxiliar = await p.locator('.content').textContent();
  check('filtro "Auxiliar de Eleição" mostra só ELIS, esconde mesários e o outro apoio', /ELIS APOIO/.test(soAuxiliar) && !/FABIO APOIO/.test(soAuxiliar) && !/BRUNO MESARIO/.test(soAuxiliar), soAuxiliar.replace(/\s+/g, ' ').slice(0, 200));

  await p.selectOption('#cm-filtro-funcao', 'mesario');
  await p.waitForTimeout(150);
  const soMesario = await p.locator('.content').textContent();
  check('filtro "Mesário" esconde os dois de apoio logístico', /BRUNO MESARIO/.test(soMesario) && !/ELIS APOIO/.test(soMesario) && !/FABIO APOIO/.test(soMesario), soMesario.replace(/\s+/g, ' ').slice(0, 200));

  await p.selectOption('#cm-filtro-funcao', '');
  await p.waitForTimeout(150);
  const todosDeVolta = await p.locator('.content').textContent();
  check('voltando pra "Todas as funções" mostra todo mundo de novo', /BRUNO MESARIO/.test(todosDeVolta) && /ELIS APOIO/.test(todosDeVolta) && /FABIO APOIO/.test(todosDeVolta));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.95 Código de rastreio só aparece no modal quando o meio é Carta Registrada ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // FABIO (a6) começa sem meio_contato definido (equivale a WhatsApp) — sem rastreio no modal.
  await p.locator('.import-card:has-text("FABIO APOIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  check('sem Carta Registrada, modal não mostra código de rastreio', await p.locator('#modal-body input#mm-rastreio').count() === 0);

  // Muda pra Carta Registrada — campo aparece.
  await p.selectOption('#modal-body select >> nth=0', 'carta_registrada');
  await p.waitForTimeout(150);
  check('ao trocar pra Carta Registrada, o campo de rastreio aparece', await p.locator('#modal-body input#mm-rastreio').count() === 1);

  // Salvar com o campo visível funciona normalmente.
  await p.fill('#modal-body input#mm-rastreio', 'bb987654321br');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a6' && e.payload.codigo_rastreio === 'BB987654321BR'));
  check('salvar com o campo visível grava o código normalmente', !!upd, JSON.stringify(upd));

  // Reabre e volta pra WhatsApp — campo some, e salvar não apaga o código já salvo.
  await p.locator('.import-card:has-text("FABIO APOIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  await p.selectOption('#modal-body select >> nth=0', 'whatsapp');
  await p.waitForTimeout(150);
  check('voltando pra WhatsApp, o campo de rastreio some de novo', await p.locator('#modal-body input#mm-rastreio').count() === 0);
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);
  const escritasDepois = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a6' && 'codigo_rastreio' in e.payload));
  check('salvar com o campo escondido não mexe em codigo_rastreio (não some o que já tinha)', escritasDepois.length === 1, JSON.stringify(escritasDepois));

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

// ── 3.6 Relatório ELO — atualizações pendentes na planilha do TRE ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Fixture local (não mexe no mock() compartilhado com os demais testes,
  // que já dependem das contagens atuais de sime_atores/pizzas/stat cards).
  m.sime_atores.push(
    { id:'a8', nome_completo:'HELENA CONFIRMADA', telefone_whatsapp:'5586999990008', funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'s3', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, inscricao_eleitoral:'111111111111' },
    { id:'a9', nome_completo:'IVO CONFLITO', telefone_whatsapp:'5586999990009', funcao:'mesario', funcao_mesa:'Presidente', secao_id:null, zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, inscricao_eleitoral:'222222222222' },
    { id:'a10', nome_completo:'JULIA SEM REGISTRO NO ELO', telefone_whatsapp:'5586999990010', funcao:'auxiliar_eleicao', secao_id:null, zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, inscricao_eleitoral:'333333333333' },
    { id:'a11', nome_completo:'KAIO JA SINCRONIZADO', telefone_whatsapp:'5586999990011', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:null, zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, inscricao_eleitoral:'444444444444' },
  );
  m.sime_mesarios_raw = [
    { id:'raw2', inscricao:'111111111111', confirmou_convocacao: null, origem_resposta: null, data_resposta: null },
    { id:'raw3', inscricao:'222222222222', confirmou_convocacao: 'Não', origem_resposta: 'Não', data_resposta: '17/08/2026' },
    // KAIO: já "Sim" no ELO — não deve aparecer no relatório.
    { id:'raw4', inscricao:'444444444444', confirmou_convocacao: 'Sim', origem_resposta: 'WhatsApp', data_resposta: '10/08/2026' },
    // JULIA não tem NENHUMA linha em sime_mesarios_raw — "sem registro no ELO".
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-relatorio-elo-btn');
  await p.waitForTimeout(300);

  const txt = await p.locator('.content').textContent();
  const flat = txt.replace(/\s+/g, ' ');
  check('relatório ELO mostra HELENA (sem resposta registrada no ELO)', /HELENA CONFIRMADA/.test(flat) && /Sem resposta registrada no ELO/.test(flat), flat.slice(0, 900));
  check('relatório ELO mostra IVO com alerta (ELO diz "Não")', /IVO CONFLITO/.test(flat) && /ELO diz "Não"/.test(flat), flat.slice(0, 900));
  check('relatório ELO mostra JULIA (sem registro nenhum no ELO)', /JULIA SEM REGISTRO NO ELO/.test(flat) && /Sem registro no ELO/.test(flat), flat.slice(0, 900));
  check('relatório ELO NÃO mostra KAIO (ELO já diz "Sim")', !/KAIO JA SINCRONIZADO/.test(flat), flat.slice(0, 900));
  check('relatório ELO avisa quantos casos têm conflito (1)', /1 caso\(s\) com resposta "Não"/.test(flat), flat.slice(0, 300));
  check('BRUNO/CARLA/DIEGO (não confirmados) não aparecem no relatório', !/BRUNO MESARIO/.test(flat) && !/CARLA RECUSOU/.test(flat) && !/DIEGO CARTA/.test(flat));
  // ANA é confirmado mas não tem inscricao_eleitoral na fixture — sem título, não dá pra cruzar com o ELO.
  check('ANA (confirmado, mas sem título de eleitor) não aparece — não dá pra cruzar sem título', !/ANA PRESIDENTE/.test(flat));

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
