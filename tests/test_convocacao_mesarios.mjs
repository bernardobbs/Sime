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
  delete(){ this._op='delete'; return this; }
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
    if(this._op==='delete'){
      window.__mock.escritas.push({ op:'delete', tabela:this.t, filtro:{...this.f} });
      const rows=(window.__mock[this.t]||[]);
      const restantes = rows.filter(x=>!this._casa(x));
      window.__mock[this.t] = restantes;
      return res({ data:null, error:null });
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
      // Relato de terceiro (21/08/2026) — outro mesário reportou isso sobre
      // BRUNO via WhatsApp, não ele mesmo. Precisa aparecer com rótulo
      // distinto ("precisa confirmar"), não como se fosse recado dele.
      { ts:'2026-08-16T07:00:00.000Z', acao:'hermes_relato_terceiro', modulo:'hermes_mesarios', payload:{ nome_alvo:'BRUNO MESARIO', telefone_relator:'5586988887777', zona:'7', mensagem:'ele me pediu pra avisar que não vai poder', origem:'grupo Campo Maior', afetados:[{ id:'a2', nome:'BRUNO MESARIO' }], ts:'2026-08-16T07:00:00.000Z' } },
    ],
    sime_secoes: [
      { id:'s1', numero:30, local_nome:'Grupo Escolar A', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:280 },
      { id:'s2', numero:31, local_nome:'Grupo Escolar A', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:260 },
      { id:'s3', numero:63, local_nome:'Escola B', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:300 },
    ],
    sime_atores: [
      { id:'a1', nome_completo:'ANA PRESIDENTE', telefone_whatsapp:'5586999990001', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s1', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, meio_contato:'whatsapp', status_contato_alternativo:null, data_confirmacao:'2026-08-15T10:00:00Z' },
      { id:'a2', nome_completo:'BRUNO MESARIO', telefone_whatsapp:'5586999990002', funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'s1', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', status_contato_alternativo:null, data_confirmacao:null, inscricao_eleitoral:'046919051589', tem_relato_terceiro_pendente:true },
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
    sime_contatos_externos: [],
    // Campanha com script salvo — pro botão "🧩 Rodar script conversacional"
    // do modal (28/08/2026). Etapa 1 com placeholders, pra testar que a
    // mensagem enfileirada sai personalizada por pessoa/seção.
    sime_campanhas: [
      { id:'camp-script-1', nome:'Convocação de mesários (script)', zona_id:'z7', status:'ativa', created_at:'2026-08-15T10:00:00.000Z' },
    ],
    sime_campanha_etapas: [
      { id:'et-1', campanha_id:'camp-script-1', etapa_numero:1, mensagem:'Olá {nome}! Confirma presença na Seção {secao}?', imagem_url:null, respostas_esperadas:[] },
    ],
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
  // window.print() abriria um diálogo real do navegador (trava o teste
  // headless) — stub que só conta chamadas, pra testar que
  // coImprimir()/coImprimirEtiqueta() de fato dispara a impressão sem
  // precisar de um diálogo de verdade.
  await p.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
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
  // Funil: MRV totalCargos=12 (3 seções×4) + 2 locais (Coord., 1 vaga/local)
  // + auxiliarTotal=1 (ELIS, headcount — não mais 1 vaga/local, ver
  // 22/08/2026: TRE nunca traz local pra Auxiliar de Eleição, então essa
  // função virou contagem direta de pessoa, sem "vazio" calculável) → 15.
  // Convocados = mrvDesignados(4) + locaisComCoord(1, Grupo Escolar A via GEORGE) + auxiliarTotal(1, ELIS) = 6.
  // Confirmados = mrvConfirmadoCargos(1, só ANA) + locaisComCoordConfirmado(0) + auxiliarConfirmado(1, ELIS) = 2.
  check('barra-funil da zona: Total 15, Convocados 6, Confirmados 2', /Total de vagas:\s*15/.test(dashFlat) && /Convocados:\s*6/.test(dashFlat) && /Confirmados:\s*2/.test(dashFlat), dashFlat.slice(0, 500));

  const cardPizzaMRV = await p.locator('.import-card:has-text("MRV (Mesários)")').first().textContent();
  check('pizza MRV (3 fatias): confirmado 1, convocado 3, vazio 8, total 12', /Confirmado:\s*1/.test(cardPizzaMRV) && /Convocado:\s*3/.test(cardPizzaMRV) && /Vazio:\s*8/.test(cardPizzaMRV) && /Total:\s*12/.test(cardPizzaMRV), cardPizzaMRV.replace(/\s+/g, ' '));

  // .last() (não .first()) — a barra-funil acima também menciona os nomes
  // dos 3 grupos no título ("MRV + Coordenadores de Acessibilidade +
  // Auxiliares de Eleição"), então :has-text() bate nela primeiro; a pizza
  // de verdade vem depois no DOM.
  const cardPizzaCoord = await p.locator('.import-card:has-text("Coordenadores de Acessibilidade")').last().textContent();
  check('pizza Coord. de Acessibilidade (3 fatias): confirmado 0, convocado 1 (GEORGE), vazio 1 (Escola B)', /Confirmado:\s*0/.test(cardPizzaCoord) && /Convocado:\s*1/.test(cardPizzaCoord) && /Vazio:\s*1/.test(cardPizzaCoord) && /Total:\s*2/.test(cardPizzaCoord), cardPizzaCoord.replace(/\s+/g, ' '));

  // 22/08/2026: Auxiliar de Eleição virou contagem por PESSOA (não mais por
  // local) — só existe 1 auxiliar na fixture (ELIS, confirmada), então
  // Confirmado:1, Convocado:0 (não sobra ninguém "designado mas não
  // confirmado"), Vazio:0 (não há como calcular vaga vazia sem o dado do
  // TRE), Total:1.
  const cardPizzaAux = await p.locator('.import-card:has-text("Auxiliares de Eleição")').last().textContent();
  check('pizza Auxiliar de Eleição (headcount): confirmado 1 (ELIS), convocado 0, vazio 0, total 1', /Confirmado:\s*1/.test(cardPizzaAux) && /Convocado:\s*0/.test(cardPizzaAux) && /Vazio:\s*0/.test(cardPizzaAux) && /Total:\s*1/.test(cardPizzaAux), cardPizzaAux.replace(/\s+/g, ' '));

  check('pizzas usam gráfico SVG (donut), não só texto', await p.locator('.content svg').count() >= 3);
  check('resumo: 1 seção sem nenhum cargo designado (Escola B)', /1 seção\(ões\) sem nenhum cargo designado/.test(dash));

  // Tabela "por município e função" (21/08/2026) — fechada por padrão desde
  // 21/08/2026 (pedido do cartório: o topo do Dashboard ficou denso demais),
  // expande num cabeçalho clicável. Nesta fixture só existe Campo Maior,
  // então é uma única linha, mas já valida os mesmos números batidos acima
  // (MRV 1/12, Coord 0/2 via GEORGE designado, Auxiliar 1/2 via ELIS
  // confirmada — ver comentários da barra-funil/pizzas acima).
  check('Dashboard tem o cabeçalho da tabela por município (fechado)', /Progresso por município e função/.test(dash));
  check('fechada por padrão: tabela não aparece antes de clicar', await p.locator('table:has-text("Campo Maior")').count() === 0);
  await p.click('.ic-title:has-text("Progresso por município e função")');
  await p.waitForTimeout(150);
  const linhaCampoMaior = await p.locator('table tr:has-text("Campo Maior")').first().textContent();
  check('tabela por município: Campo Maior — MRV 1/12 (4 pr.)', /1\/12/.test(linhaCampoMaior) && /4 pr\./.test(linhaCampoMaior), linhaCampoMaior.replace(/\s+/g, ' '));
  check('tabela por município: Campo Maior — Coord. 0/2 (1 pr., via GEORGE)', /0\/2/.test(linhaCampoMaior) && /1 pr\./.test(linhaCampoMaior), linhaCampoMaior.replace(/\s+/g, ' '));
  check('tabela por município: Campo Maior — Auxiliar 1/2 (via ELIS, sem nota "pr." pois confirmados=designados)', /1\/2/.test(linhaCampoMaior), linhaCampoMaior.replace(/\s+/g, ' '));
  check('tabela por município: Campo Maior ainda falta preencher (❌)', /❌/.test(linhaCampoMaior), linhaCampoMaior.replace(/\s+/g, ' '));
  await p.click('.ic-title:has-text("Progresso por município e função")');
  await p.waitForTimeout(150);
  check('clicar de novo recolhe a tabela', await p.locator('table:has-text("Campo Maior")').count() === 0);

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

// ── 1.5 Dashboard por município: zona com mais de um município (achado real
// — a fixture compartilhada só tem Campo Maior; toda zona de verdade do SIME
// cobre vários municípios, ex. 7ª Zona = Campo Maior + Jatobá do Piauí). ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Fixture isolada, própria pra este teste (não mexe na compartilhada) —
  // 2 municípios com estados bem diferentes: Campo Maior 100% preenchido E
  // confirmado (MRV + Coord + Auxiliar); Jatobá do Piauí 100% PREENCHIDO mas
  // nada confirmado — dá pra ver os 3 estados de rsSituacaoMunicipio: ✅
  // tudo confirmado, 🔶 preenchido mas falta confirmar (e, na fixture normal
  // acima, ❌ nem preenchido).
  m.sime_secoes = [
    { id:'mA', numero:10, local_nome:'Local A', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:100 },
    { id:'mB', numero:20, local_nome:'Local B', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:100 },
    { id:'mJ', numero:30, local_nome:'Local C', municipio:'Jatobá do Piauí', zona_id:'z7', ativo:true, eleitores:100 },
  ];
  const cargo = (id, secao_id, funcao_mesa, confirmacao) => ({ id, nome_completo: id, telefone_whatsapp:'', funcao:'mesario', funcao_mesa, secao_id, zona_id:'z7', confirmacao, ativo:true });
  m.sime_atores = [
    // Campo Maior — Local A e Local B, mesa completa e confirmada nas duas.
    cargo('cmA1','mA','Presidente','confirmado'), cargo('cmA2','mA','1º Mesário','confirmado'),
    cargo('cmA3','mA','2º Mesário','confirmado'), cargo('cmA4','mA','1º Secretário','confirmado'),
    cargo('cmB1','mB','Presidente','confirmado'), cargo('cmB2','mB','1º Mesário','confirmado'),
    cargo('cmB3','mB','2º Mesário','confirmado'), cargo('cmB4','mB','1º Secretário','confirmado'),
    { id:'cmCoordA', nome_completo:'COORD A', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:'mA', zona_id:'z7', confirmacao:'confirmado', ativo:true },
    { id:'cmCoordB', nome_completo:'COORD B', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:'mB', zona_id:'z7', confirmacao:'confirmado', ativo:true },
    { id:'cmAuxA', nome_completo:'AUX A', telefone_whatsapp:'', funcao:'auxiliar_eleicao', secao_id:'mA', zona_id:'z7', confirmacao:'confirmado', ativo:true },
    { id:'cmAuxB', nome_completo:'AUX B', telefone_whatsapp:'', funcao:'auxiliar_eleicao', secao_id:'mB', zona_id:'z7', confirmacao:'confirmado', ativo:true },
    // Jatobá do Piauí — Local C: mesa toda DESIGNADA, só o Presidente confirmado.
    cargo('jatP','mJ','Presidente','confirmado'), cargo('jat1','mJ','1º Mesário','pendente'),
    cargo('jat2','mJ','2º Mesário','pendente'), cargo('jat3','mJ','1º Secretário','pendente'),
    { id:'jatCoord', nome_completo:'COORD JATOBA', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:'mJ', zona_id:'z7', confirmacao:'pendente', ativo:true },
    { id:'jatAux', nome_completo:'AUX JATOBA', telefone_whatsapp:'', funcao:'auxiliar_eleicao', secao_id:'mJ', zona_id:'z7', confirmacao:'pendente', ativo:true },
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(300);

  // Tabela fechada por padrão (21/08/2026) — precisa clicar pra expandir.
  await p.click('.ic-title:has-text("Progresso por município e função")');
  await p.waitForTimeout(150);
  const dash = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('tabela por município lista Campo Maior e Jatobá do Piauí', /Campo Maior/.test(dash) && /Jatobá do Piauí/.test(dash));

  const linhaCM = await p.locator('table tr:has-text("Campo Maior")').first().textContent();
  check('Campo Maior: MRV 8/8 (sem nota de designados — todos confirmados)', /8\/8/.test(linhaCM) && !/pr\./.test(linhaCM), linhaCM.replace(/\s+/g, ' '));
  check('Campo Maior: Coord. 2/2 e Auxiliar 2/2', (linhaCM.match(/2\/2/g) || []).length === 2, linhaCM.replace(/\s+/g, ' '));
  check('Campo Maior: ✅ Tudo confirmado', /✅ Tudo confirmado/.test(linhaCM), linhaCM.replace(/\s+/g, ' '));

  const linhaJat = await p.locator('table tr:has-text("Jatobá do Piauí")').first().textContent();
  check('Jatobá do Piauí: MRV 1/4 (4 pr. — mesa toda designada, só 1 confirmado)', /1\/4/.test(linhaJat) && /4 pr\./.test(linhaJat), linhaJat.replace(/\s+/g, ' '));
  check('Jatobá do Piauí: Coord. 0/1 (1 pr.) e Auxiliar 0/1 (1 pr.)', (linhaJat.match(/0\/1/g) || []).length === 2 && (linhaJat.match(/1 pr\./g) || []).length === 2, linhaJat.replace(/\s+/g, ' '));
  check('Jatobá do Piauí: 🔶 preenchido mas falta confirmar (não ✅, não ❌)', /🔶 Preenchido, falta confirmar/.test(linhaJat), linhaJat.replace(/\s+/g, ' '));

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

  // Escopado à lista de cards (.cm-lista-pessoas), não a .content inteiro —
  // desde o painel "🕓 Aguardando resposta" (27/08/2026), nomes também podem
  // aparecer no banner de destaque acima da lista, que não deve contar aqui.
  const bodyTxt = await p.locator('.cm-lista-pessoas').textContent();
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
  // Agrupamento por dia (27/08/2026, "relacionado em um único ponto as
  // tentativas do dia, para verificar se ficou alguma resposta para trás").
  check('tentativas de contato aparecem agrupadas com cabeçalho de dia (📅)', /📅/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 400));
  check('mostra a atualização anterior (histórico)', /Meio de contato.*Carta Registrada/.test(modalTxt.replace(/\s+/g, ' ')), modalTxt.replace(/\s+/g, ' ').slice(0, 400));
  check('mostra também a confirmação feita pelo próprio mesário via Hermes/WhatsApp (casada por afetados, não por ator_id)', /Confirmou por WhatsApp/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 400));

  // Rastreio só existe no DOM com Carta Registrada (ver 2.95) — muda o meio primeiro.
  await p.selectOption('#modal-body select >> nth=0', 'carta_registrada');
  await p.waitForTimeout(150);
  await p.fill('#mm-rastreio', 'aa123456789br');
  await p.fill('#mm-tel-principal', '(86) 98888-7777');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && 'telefone_whatsapp' in e.payload));
  // Grava COM o 55 na frente (21/08/2026) — mesma convenção do resto do
  // sistema (Ciente/colar-lista); antes desse fix, comparar o campo (exibido
  // sem 55) com o valor guardado (com 55) sempre achava "mudou" e regravava
  // sem o 55 a cada Salvar, mesmo sem editar nada.
  check('salvar grava telefone (com 55, convenção do banco)', upd?.payload?.telefone_whatsapp === '5586988887777', JSON.stringify(upd));
  // 27/08/2026: o telefone principal virou editável direto no cartão
  // (onblur salva sozinho, ver cmSalvarTelefoneCard) — clicar em "Salvar"
  // logo em seguida sem trocar de campo antes dispara esse onblur no meio
  // do próprio clique, então o telefone acaba indo num update PRÓPRIO
  // (disparado pelo onblur) separado do update do rastreio (disparado pelo
  // cmSalvarModal do rodapé) — os dois continuam gravando certo, só não é
  // mais um único update combinando os dois campos.
  const updRastreio = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && 'codigo_rastreio' in e.payload));
  check('e o rastreio grava certo também (update próprio do "Salvar" do rodapé)', updRastreio?.payload?.codigo_rastreio === 'AA123456789BR', JSON.stringify(updRastreio));
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

// ── 2.62 Lista única de telefones — principal + alternativos do TRE + cadastrado à mão (21/08/2026) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  const modalTxt = await p.locator('#modal-body').textContent();
  // 27/08/2026: o número do principal virou um <input> editável dentro do
  // cartão (não mais texto simples) — .textContent() não pega valor de
  // input, então o número em si tem que ser checado via inputValue(), só o
  // rótulo "WhatsApp (principal)" continua aparecendo como texto normal.
  check('lista única mostra o telefone principal', /WhatsApp \(principal\)/.test(modalTxt) && (await p.locator('#mm-tel-principal').inputValue()) === '(86) 99999-0002', modalTxt.replace(/\s+/g, ' ').slice(0, 500));
  check('lista única também mostra o telefone alternativo do TRE (telefone_1_eleitor, diferente do salvo)', /Telefone 1 \(eleitor\)/.test(modalTxt) && /\(86\) 97777-8888/.test(modalTxt), modalTxt.replace(/\s+/g, ' ').slice(0, 500));

  // Pedido direto (21/08/2026): "o botão de copiar vir antes de cada número"
  // — copiar QUALQUER telefone da lista (não só o principal) monta o link do
  // wa.me PRA AQUELE número e já registra a tentativa sozinha, pra realmente
  // dar pra "tentar contactar o número", não só ver ele como referência.
  await p.evaluate(() => {
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } } });
  });
  const linhaAlternativo = p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' });
  await linhaAlternativo.locator('button[aria-label*="Copiar link do WhatsApp"]').click();
  await p.waitForTimeout(150);
  const copiado = await p.evaluate(() => window.__clipboardText);
  check('copiar o telefone alternativo monta o link do wa.me PRA ESSE número (não o principal)', (copiado || '').includes('5586977778888') && !(copiado || '').includes('5586999990002'), copiado);
  const tentativaAlt = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_tentativa_contato'));
  check('copiar o telefone alternativo TAMBÉM registra tentativa de contato (antes não registrava)', !!tentativaAlt && tentativaAlt.payload.payload.ator_id === 'a2', JSON.stringify(tentativaAlt));

  // Cadastrar um telefone extra que não veio de nenhuma fonte oficial —
  // pedido direto: "poderíamos ter uma forma de cadastrar outro telefone".
  await p.waitForTimeout(150); // modal recarrega depois de copiar
  await p.fill('#mm-tel-alt-novo', '(86) 90000-1234');
  await p.click('#modal-body button:has-text("Adicionar telefone")');
  await p.waitForTimeout(200);
  const updAlt = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_alternativo));
  check('adicionar telefone alternativo grava com 55 (convenção do banco)', updAlt?.payload?.telefone_alternativo === '5586900001234', JSON.stringify(updAlt));
  const modalComAlt = await p.locator('#modal-body').textContent();
  // Mesmo motivo do principal acima: o número do alternativo já cadastrado
  // também virou um <input> editável — checa o rótulo por texto e o número
  // por inputValue().
  check('telefone alternativo cadastrado à mão aparece na lista única', /Telefone alternativo \(cartório\)/.test(modalComAlt) && (await p.locator('#mm-tel-alternativo').inputValue()) === '(86) 90000-1234', modalComAlt.replace(/\s+/g, ' ').slice(0, 500));

  // Remover o que foi cadastrado à mão.
  const linhaManual = p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone alternativo (cartório)' });
  check('só o cadastrado à mão tem botão de remover (não o do TRE nem o principal)', await linhaManual.locator('button[title="Remover telefone alternativo"]').count() === 1);
  await linhaManual.locator('button[title="Remover telefone alternativo"]').click();
  await p.waitForTimeout(200);
  const updRemocao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_alternativo === null));
  check('remover telefone alternativo grava null', !!updRemocao, JSON.stringify(updRemocao));
  check('telefone alternativo removido some da lista', !/Telefone alternativo \(cartório\)/.test(await p.locator('#modal-body').textContent()));

  // "Eleger" o telefone do TRE como principal (27/08/2026, pedido direto:
  // "se a pessoa tiver 4 números... eu precisar eleger um para ser o
  // principal") — botão "⭐ Usar como principal" só aparece nos cartões que
  // NÃO são o principal, e só quando têm valor.
  check('cartão do principal não tem botão "Usar como principal" (ele já é)', await p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' }).locator('button:has-text("Usar como principal")').count() === 0);
  const cartaoEleitor = p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' });
  check('cartão do TRE tem botão "Usar como principal"', await cartaoEleitor.locator('button:has-text("Usar como principal")').count() === 1);
  await cartaoEleitor.locator('button:has-text("Usar como principal")').click();
  await p.waitForTimeout(250);
  const updPrincipalEleito = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_whatsapp === '5586977778888'));
  check('eleger o telefone do TRE grava como novo principal (com 55)', !!updPrincipalEleito, JSON.stringify(updPrincipalEleito));
  check('modal recarrega e o cartão principal já mostra o número eleito', (await p.locator('#mm-tel-principal').inputValue()) === '(86) 97777-8888');

  // Ana não tem nenhuma linha em sime_mesarios_raw nem telefone_alternativo —
  // a lista única mostra só o principal dela.
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(80);
  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  const modalAna = await p.locator('#modal-body').textContent();
  check('Ana (sem registro no TRE, sem alternativo) só mostra o telefone principal na lista', /WhatsApp \(principal\)/.test(modalAna) && !/Telefone 1 \(eleitor\)/.test(modalAna) && !/Telefone alternativo \(cartório\)/.test(modalAna), modalAna.replace(/\s+/g, ' ').slice(0, 400));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.63 Editar telefone direto no cartãozinho (27/08/2026, pedido direto
// com print anexado: "no cartão zinco quero poder editar e quero poder
// adicionar outros telefones, nao necessariamente o que vem do elo") —
// substitui o campo solto "Telefone (WhatsApp) — principal" que ficava fora
// da lista, duplicando a mesma informação em dois lugares. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // DIEGO (a4) não tem telefone_whatsapp nenhum — o cartão principal
  // precisa aparecer mesmo assim (vazio), senão não haveria como cadastrar
  // o primeiro número dele.
  await p.locator('.import-card:has-text("DIEGO CARTA")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  check('campo solto "Telefone (WhatsApp) — principal" não existe mais no modal', !/Telefone \(WhatsApp\) — principal/.test(await p.locator('#modal-body').textContent()));
  check('DIEGO (sem telefone ainda) mostra o cartão principal vazio, pronto pra cadastrar', await p.locator('#mm-tel-principal').count() === 1 && (await p.locator('#mm-tel-principal').inputValue()) === '');
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(80);

  // BRUNO (a2) já tem telefone — editar o número no cartão (onblur, sem
  // clicar em "Salvar") grava sozinho, mesmo padrão de nome/telefone do
  // substituto.
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  await p.fill('#mm-tel-principal', '(86) 91111-2222');
  await p.locator('#mm-tel-principal').press('Tab');
  await p.waitForTimeout(200);
  const updPrincipal = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_whatsapp === '5586911112222'));
  check('editar o principal no cartão salva sozinho ao sair do campo (onblur)', !!updPrincipal, JSON.stringify(updPrincipal));
  check('toast confirma a atualização', /Telefone atualizado/.test(await p.locator('.toast').textContent()));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.64 "+ Adicionar telefone" só aparece enquanto não há alternativo —
// depois disso a edição é pelo próprio cartão (27/08/2026). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  check('sem alternativo ainda, mostra "+ Adicionar outro telefone"', await p.locator('#mm-tel-alt-novo').count() === 1);
  check('sem alternativo ainda, não existe cartão pra editar (só depois de existir um)', await p.locator('#mm-tel-alternativo').count() === 0);

  await p.fill('#mm-tel-alt-novo', '(86) 93333-4444');
  await p.click('#modal-body button:has-text("Adicionar telefone")');
  await p.waitForTimeout(200);
  check('depois de adicionar, "+ Adicionar outro telefone" some (edição vira só pelo cartão)', await p.locator('#mm-tel-alt-novo').count() === 0);
  check('e o cartão editável do alternativo aparece com o valor certo', (await p.locator('#mm-tel-alternativo').inputValue()) === '(86) 93333-4444');

  // Editar o alternativo já existente pelo próprio cartão (onblur salva sozinho).
  await p.fill('#mm-tel-alternativo', '(86) 95555-6666');
  await p.locator('#mm-tel-alternativo').press('Tab');
  await p.waitForTimeout(250);
  const updAltEditado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_alternativo === '5586955556666'));
  check('editar o alternativo já existente no cartão salva sozinho (onblur)', !!updAltEditado, JSON.stringify(updAltEditado));
  // Limpar o campo (deixar vazio) equivale a remover — a estrutura muda
  // (o cartão precisa sumir e "+ Adicionar" reaparecer), então esse caso
  // específico reconstrói o modal ao salvar.
  check('"+ Adicionar outro telefone" continua fora enquanto o alternativo existir', await p.locator('#mm-tel-alt-novo').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.635 Bug real corrigido em 27/08/2026 — editar o telefone principal e
// clicar em "Salvar" LOGO em seguida (sem trocar de campo antes) perdia o
// resto do que tinha sido digitado (rastreio, nota, observação): o onblur
// do cartão disparava cmRenderModal() no meio do próprio clique, trocando o
// botão "Salvar" por um elemento novo — o clique original mirava o botão
// antigo (já removido do DOM) e se perdia, sem toast nem erro nenhum.
// Corrigido fazendo o onblur do telefone principal nunca reconstruir o
// modal (o cartão já é sempre o mesmo <input>, nada muda de estrutura). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);
  await p.selectOption('#modal-body select >> nth=0', 'carta_registrada');
  await p.waitForTimeout(150);
  await p.fill('#mm-rastreio', 'zz987654321br');
  // Sem Tab/blur explícito aqui — clica direto em "Salvar", exatamente o
  // cenário que expunha a corrida.
  await p.fill('#mm-tel-principal', '(86) 97777-1111');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(300);

  check('modal fecha normalmente (não trava com o clique perdido)', !(await p.evaluate(() => document.getElementById('overlay').classList.contains('open'))));
  const updTelRace = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_whatsapp === '5586977771111'));
  check('o telefone editado no cartão foi salvo', !!updTelRace, JSON.stringify(updTelRace));
  const updRastreioRace = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.codigo_rastreio === 'ZZ987654321BR'));
  check('E o rastreio digitado no rodapé TAMBÉM foi salvo (não se perdeu no clique)', !!updRastreioRace, JSON.stringify(updRastreioRace));

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
  // Botão de copiar do telefone principal — agora faz parte da lista única
  // de telefones (21/08/2026), não é mais uma ação separada no topo. Layout
  // reconstruído em 27/08/2026 (pedido direto, print anexado do modal
  // desejado): cada telefone virou um cartão com o ícone 💬 acima do número
  // (em vez do botão de texto "🔗 Copiar" ao lado) — o ícone é o alvo do
  // clique, identificado por aria-label (sem mais texto "Copiar" visível).
  const cardTelPrincipal = p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' });
  const btnCopiarWa = cardTelPrincipal.locator('button[aria-label*="Copiar link do WhatsApp"]');
  check('modal tem o ícone 💬 de copiar link do wa.me de quem tem telefone', await btnCopiarWa.count() === 1);
  check('o ícone é o 💬 (parecido com WhatsApp), não um botão de texto', (await btnCopiarWa.textContent()).trim() === '💬');
  await btnCopiarWa.click();
  await p.waitForTimeout(100);
  const linkCopiado = await p.evaluate(() => window.__clipboardText);
  check('link copiado aponta pro número da pessoa', /5586999990002|86999990002|999990002/.test(linkCopiado || ''), linkCopiado);
  // Pedido de 21/08/2026: mensagem pré-preenchida (?text=) perguntando se o
  // contato é da pessoa certa — evita digitar a mesma pergunta a cada
  // conversa nova aberta indo de nome em nome. 27/08/2026: a saudação
  // ("Bom dia"/"Boa tarde"/"Boa noite") agora depende da hora em que o link
  // é copiado — o teste roda a qualquer hora do dia, então calcula a
  // saudação esperada com a mesma regra em vez de fixar "Bom dia".
  const saudacaoEsperada = (() => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; })();
  check('link copiado já vem com a mensagem de confirmação pré-preenchida, saudação certa pra hora atual', (linkCopiado || '').includes('?text=' + encodeURIComponent(`${saudacaoEsperada}, esse contato é de BRUNO MESARIO ?`)), linkCopiado);
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
  // Achado real em 21/08/2026: nenhuma tentativa/atualização dizia QUEM do
  // cartório fez a ação — corrigido gravando payload.autor (nomeDoUsuario())
  // em toda ação desta tela, e mostrando "(por Fulano)" nas duas timelines.
  check('tentativa manual grava quem registrou (autor)', updTentativa?.payload?.payload?.autor === 'Maria', JSON.stringify(updTentativa));
  check('timeline de tentativas mostra "(por Maria)"', /Liguei às 14h, não atendeu \(por Maria\)/.test(modalTxtDepois.replace(/\s+/g, ' ')), modalTxtDepois.replace(/\s+/g, ' ').slice(0, 400));

  // Trocar o meio de contato (linha 526 acima) também precisa registrar autor.
  const updMeioAutor = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_meio_contato'));
  check('trocar meio de contato grava quem fez (autor)', updMeioAutor?.payload?.payload?.autor === 'Maria', JSON.stringify(updMeioAutor));
  const modalTxtLogs = await p.locator('#modal-body').textContent();
  check('lista de Atualizações mostra "(por Maria)" pro meio de contato trocado', /Meio de contato.*\(por Maria\)/.test(modalTxtLogs.replace(/\s+/g, ' ')), modalTxtLogs.replace(/\s+/g, ' ').slice(0, 500));
  // Relato de terceiro (fixture: hermes_relato_terceiro sobre BRUNO/a2) — tem
  // que aparecer com rótulo distinto do recado da própria pessoa, avisando
  // que precisa confirmar (21/08/2026).
  check('Atualizações distingue relato de terceiro — avisa "precisa confirmar"', /Relato de terceiro.*grupo Campo Maior.*PRECISA CONFIRMAR/.test(modalTxtLogs.replace(/\s+/g, ' ')), modalTxtLogs.replace(/\s+/g, ' ').slice(0, 600));

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
  await p.fill('#mm-tel-principal', '(86) 90000-1111');
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
  // Escopado à lista de cards — o painel "🕓 Aguardando resposta" é GLOBAL
  // (não muda com o filtro selecionado), então Bruno pode continuar
  // aparecendo lá mesmo filtrado pra fora da lista de cards abaixo.
  const filtrado = await p.locator('.cm-lista-pessoas').textContent();
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

  // Desmarcar pelo modal (mesmo botão existe lá dentro — 27/08/2026: subiu
  // pra linha de 3 botões de status no topo do modal, texto fixo "🔁
  // Substituir", o estado atual passa a aparecer pelo preenchido (btn-dark)
  // em vez de mudar de texto).
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);
  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  const btnSubstituirModal = p.locator('#modal-body button:has-text("🔁 Substituir")');
  check('botão de substituir aparece destacado (btn-dark) enquanto a flag está marcada', (await btnSubstituirModal.getAttribute('class') || '').includes('btn-dark'));
  await btnSubstituirModal.click();
  await p.waitForTimeout(150);
  check('desmarcar pelo modal atualiza o modal na hora (sem precisar fechar/reabrir)', !/Precisa substituto/.test(await p.locator('#modal-body').textContent()));
  check('botão de substituir perde o destaque depois de desmarcar', !(await p.locator('#modal-body button:has-text("🔁 Substituir")').getAttribute('class') || '').includes('btn-dark'));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.81 Nome do substituto (27/08/2026, pedido direto: "ao marcar para
// substituir, deve ter uma forma de informar o nome do substituto") ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('button:has-text("Marcar para substituir")').click();
  await p.waitForTimeout(150);

  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  check('modal mostra campo de nome do substituto quando a flag está marcada', await p.locator('#modal-body input#mm-substituto-nome').count() === 1);

  await p.fill('#modal-body input#mm-substituto-nome', 'Fulano de Tal');
  await p.locator('#modal-body input#mm-substituto-nome').press('Tab'); // dispara blur → salva
  await p.waitForTimeout(150);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.substituto_nome === 'Fulano de Tal'));
  check('salva o nome do substituto ao sair do campo (onblur)', !!upd, JSON.stringify(upd));
  check('Situação no modal mostra o nome do substituto', (await p.locator('#modal-body').textContent()).includes('Fulano de Tal'));
  check('card na lista também mostra o nome do substituto', (await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().textContent()).includes('Fulano de Tal'));

  // Telefone do substituto (27/08/2026, pedido direto: "deve vir para
  // acrescentar todos os dados do substituto") — mesmo padrão do nome.
  check('modal mostra campo de telefone do substituto quando a flag está marcada', await p.locator('#modal-body input#mm-substituto-telefone').count() === 1);
  await p.fill('#modal-body input#mm-substituto-telefone', '(86) 98765-4321');
  await p.locator('#modal-body input#mm-substituto-telefone').press('Tab');
  await p.waitForTimeout(150);
  const updTel = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.substituto_telefone === '5586987654321'));
  check('salva o telefone do substituto ao sair do campo (onblur), com 55', !!updTel, JSON.stringify(updTel));
  const modalComTel = await p.locator('#modal-body').textContent();
  check('Situação no modal mostra o telefone do substituto formatado', modalComTel.includes('(86) 98765-4321'));
  check('link "Abrir WhatsApp do substituto" aparece', await p.locator('#modal-body a:has-text("Abrir WhatsApp do substituto")').count() === 1);

  // Desmarcar substituição limpa nome E telefone junto — não fazem sentido sem a flag.
  await p.click('#modal-body button:has-text("🔁 Substituir")');
  await p.waitForTimeout(150);
  const updLimpo = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.precisa_substituir === false));
  check('desmarcar grava substituto_nome=null junto', updLimpo?.payload?.substituto_nome === null, JSON.stringify(updLimpo));
  check('desmarcar grava substituto_telefone=null junto', updLimpo?.payload?.substituto_telefone === null, JSON.stringify(updLimpo));
  check('campo de nome do substituto some do modal ao desmarcar', await p.locator('#modal-body input#mm-substituto-nome').count() === 0);
  check('campo de telefone do substituto some do modal ao desmarcar', await p.locator('#modal-body input#mm-substituto-telefone').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.85 Confirmar participação: só marca confirmado, NÃO enfileira mensagem
// nenhuma pro Hermes — bug real corrigido em 21/08/2026 (o cartório reportou
// que o botão estava criando fila automática de mensagem sem ter pedido). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // BRUNO (a2) tem telefone — confirmar grava confirmacao e NÃO enfileira nada.
  const cardBruno = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  check('botão é só "Confirmar participação", sem prometer mensagem', /✅ Confirmar participação/.test(await cardBruno.textContent()) && !/enviar mensagem/i.test(await cardBruno.textContent()));
  await cardBruno.locator('button:has-text("Confirmar participação")').click();
  await p.waitForTimeout(250);

  const updConf = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.confirmacao === 'confirmado'));
  check('confirmar grava confirmacao=confirmado', !!updConf, JSON.stringify(updConf));
  const insMsg = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_campanhas_confirmacao' && e.payload.ator_id === 'a2'));
  check('NÃO enfileira mensagem nenhuma em sime_campanhas_confirmacao', !insMsg, JSON.stringify(insMsg));
  check('botão "Confirmar participação" some depois de confirmado', await p.locator('.import-card:has-text("BRUNO MESARIO") button:has-text("Confirmar participação")').count() === 0);

  // DIEGO (a4) não tem telefone — mesmo botão, mesmo resultado (só confirma).
  const cardDiego = p.locator('.import-card:has-text("DIEGO CARTA")').first();
  await cardDiego.locator('button:has-text("Confirmar participação")').click();
  await p.waitForTimeout(250);
  const updDiego = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a4' && e.payload.confirmacao === 'confirmado'));
  check('Diego (sem telefone) também é marcado confirmado', !!updDiego, JSON.stringify(updDiego));
  const insDiego = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_campanhas_confirmacao' && e.payload.ator_id === 'a4'));
  check('e também não enfileira nada pro Diego', !insDiego);

  // O mesmo status existe dentro do modal — 27/08/2026, pedido direto do
  // cartório ao ver o modal: virou uma linha fixa de 3 botões (Confirmado/
  // Convocado/Substituir) sempre visível, em vez de um botão único que some
  // depois de confirmado. O botão ativo fica com btn-dark, os outros btn-out.
  const cardCarla = p.locator('.import-card:has-text("CARLA RECUSOU")').first();
  await cardCarla.locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  const btnConfirmadoModal = p.locator('#modal-body button:has-text("✅ Confirmado")');
  const btnConvocadoModal = p.locator('#modal-body button:has-text("📋 Convocado")');
  check('modal mostra os 3 botões de status (Confirmado/Convocado/Substituir)', await btnConfirmadoModal.count() === 1 && await btnConvocadoModal.count() === 1 && await p.locator('#modal-body button:has-text("🔁 Substituir")').count() === 1);
  check('CARLA (recusou) não está com "Confirmado" nem "Convocado" destacado', !(await btnConfirmadoModal.getAttribute('class') || '').includes('btn-dark') && !(await btnConvocadoModal.getAttribute('class') || '').includes('btn-dark'));
  await btnConfirmadoModal.click();
  await p.waitForTimeout(250);
  const updCarla = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a3' && e.payload.confirmacao === 'confirmado'));
  check('confirmar pelo modal também grava confirmacao=confirmado', !!updCarla, JSON.stringify(updCarla));
  check('botão "Confirmado" fica destacado (sem precisar fechar/reabrir)', (await p.locator('#modal-body button:has-text("✅ Confirmado")').getAttribute('class') || '').includes('btn-dark'));

  // "Convocado" (27/08/2026, pedido direto: "convocado significa que ele
  // recebeu a carta, mas pode ser substituído" — diferente de confirmado).
  // Virou um valor de confirmacao de verdade em 28/08/2026 (antes era o
  // mesmo 'pendente' de sempre) — grava confirmacao='convocado' e limpa
  // data_confirmacao, pra desfazer uma confirmação marcada por engano ou
  // registrar "sabemos que foi notificado, só não confirmou ainda". CARLA já
  // tem convocacao_recebida=true (o clique em "Confirmado" logo acima já
  // marca isso sozinho), então o gate do botão nem entra em jogo aqui — ver
  // bloco 2.86 abaixo pra testar o gate em si.
  await btnConvocadoModal.click();
  await p.waitForTimeout(250);
  const updConvocado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a3' && e.payload.confirmacao === 'convocado'));
  check('"Convocado" grava confirmacao=convocado e limpa data_confirmacao', !!updConvocado && updConvocado.payload.data_confirmacao === null, JSON.stringify(updConvocado));
  check('botão "Convocado" fica destacado depois de clicar, "Confirmado" perde o destaque', (await btnConvocadoModal.getAttribute('class') || '').includes('btn-dark') && !(await btnConfirmadoModal.getAttribute('class') || '').includes('btn-dark'));
  check('grava log de auditoria "mesario_marcado_convocado"', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_marcado_convocado' && e.payload.payload.ator_id === 'a3')));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.855 Botão "Convocado" só destrava depois de marcar "recebeu a
// convocação" (28/08/2026, pedido direto: "o botão de convocado deve ser
// habilitado somente quando informamos que o eleitor recebeu a
// convocação") ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);

  const checkbox = p.locator('#modal-body input[type="checkbox"]');
  check('caixa "recebeu a convocação" começa desmarcada (fixture padrão)', !(await checkbox.isChecked()));

  // Clicar "Convocado" sem marcar a caixa primeiro: nunca fica `disabled`
  // (mesmo critério já usado no resto do sistema — um botão disabled sem
  // feedback nenhum já causou confusão real numa tela de correspondência),
  // mas avisa por toast e NÃO grava nada.
  await p.locator('#modal-body button:has-text("📋 Convocado")').click();
  await p.waitForTimeout(200);
  const semGate = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.confirmacao === 'convocado'));
  check('sem marcar a caixa, "Convocado" não grava nada', !semGate, JSON.stringify(semGate));

  // Marca a caixa — vira um update em convocacao_recebida.
  await checkbox.click();
  await p.waitForTimeout(200);
  const updRecebida = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.convocacao_recebida === true));
  check('marcar a caixa grava convocacao_recebida=true (+ ts)', !!updRecebida && !!updRecebida.payload.convocacao_recebida_ts, JSON.stringify(updRecebida));
  check('grava log de auditoria "mesario_convocacao_recebida"', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_convocacao_recebida' && e.payload.payload.ator_id === 'a1' && e.payload.payload.recebida === true)));

  // Agora sim "Convocado" funciona.
  await p.locator('#modal-body button:has-text("📋 Convocado")').click();
  await p.waitForTimeout(200);
  const comGate = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.confirmacao === 'convocado'));
  check('depois de marcar a caixa, "Convocado" grava confirmacao=convocado', !!comGate, JSON.stringify(comGate));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.86 "Relato de terceiro pendente": flag gravada pelo Hermes
// (acao='relatar_terceiro'), surfaced com badge/filtro/botão de resolver —
// mesmo padrão de precisa_substituir (achado real 21/08/2026: sem isso, o
// cartório só via o relato abrindo o modal de cada pessoa, um por um). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const cardBruno0 = p.locator('.import-card:has-text("BRUNO MESARIO")').first();
  check('badge "Relato de terceiro pendente" aparece no card (flag já vem true do fixture)', /Relato de terceiro pendente/.test(await cardBruno0.textContent()));
  check('outro card sem a flag não mostra o badge', !/Relato de terceiro pendente/.test(await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().textContent()));

  // Filtro dedicado — bucket próprio em CM_BUCKETS, não reaproveita nenhum status de confirmacao.
  await p.selectOption('#cm-filtro', 'relato_terceiro_pendente');
  await p.waitForTimeout(150);
  const filtrado = await p.locator('.content').textContent();
  check('filtro "relato de terceiro" mostra só BRUNO', /BRUNO MESARIO/.test(filtrado) && !/ANA PRESIDENTE/.test(filtrado), filtrado.replace(/\s+/g, ' ').slice(0, 200));
  await p.selectOption('#cm-filtro', '');
  await p.waitForTimeout(150);

  // Modal também mostra o badge na linha "Situação".
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  check('modal mostra "Relato de terceiro pendente" na Situação', /Relato de terceiro pendente/.test(await p.locator('.m-kv-row:has-text("Situação")').textContent()));
  check('modal tem o botão "Marcar relato como resolvido"', await p.locator('#modal-body button:has-text("Marcar relato como resolvido")').count() === 1);

  await p.click('#modal-body button:has-text("Marcar relato como resolvido")');
  await p.waitForTimeout(200);

  const updResolvido = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.payload.tem_relato_terceiro_pendente === false));
  check('resolver grava tem_relato_terceiro_pendente=false', !!updResolvido && updResolvido.filtro.id === 'a2', JSON.stringify(updResolvido));
  const logResolvido = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_relato_terceiro_resolvido' && e.payload.payload.ator_id === 'a2'));
  check('resolver grava log mesario_relato_terceiro_resolvido', !!logResolvido, JSON.stringify(logResolvido));
  check('modal atualiza na hora: botão de resolver some, badge some da Situação', await p.locator('#modal-body button:has-text("Marcar relato como resolvido")').count() === 0 && !/Relato de terceiro pendente/.test(await p.locator('.m-kv-row:has-text("Situação")').textContent()));

  check('badge some do card também (sem precisar recarregar)', !/Relato de terceiro pendente/.test(await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent()));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.85 Área dedicada às tentativas sem resposta (27/08/2026, pedido
// direto: "eu quero uma área dedicada às tentativas de contato que não
// tiveram respostas ainda") — painel de destaque + filtro próprio ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // BRUNO (a2) já tem campanha status='enviado' e confirmacao='pendente' na
  // fixture base — é exatamente o caso "já tentamos, ninguém confirmou".
  const painelTxt = await p.locator('.import-result.ir-warn:has-text("aguardando resposta")').first().textContent();
  check('painel de destaque aparece com a contagem certa', /1 pessoa\(s\) aguardando resposta/.test(painelTxt), painelTxt);
  check('painel lista o nome de quem está nessa situação', /BRUNO MESARIO/.test(painelTxt), painelTxt);

  // Bucket próprio no filtro de sempre — contagem bate com o painel.
  const opcaoAguardando = await p.locator('#cm-filtro option[value="aguardando_resposta"]').textContent();
  check('opção "Aguardando resposta" no filtro mostra a mesma contagem', /\(1\)/.test(opcaoAguardando), opcaoAguardando);

  // Clicar no painel aplica o filtro — mesmo padrão de "área dedicada" nos
  // dois formatos pedidos (painel sempre visível + filtro selecionável).
  await p.click('.import-result.ir-warn:has-text("aguardando resposta")');
  await p.waitForTimeout(150);
  check('clicar no painel seleciona o filtro "Aguardando resposta"', await p.locator('#cm-filtro').inputValue() === 'aguardando_resposta');
  const cardsFiltrados = await p.locator('.import-card:has-text("MESARIO"), .import-card:has-text("PRESIDENTE"), .import-card:has-text("RECUSOU")').allTextContents();
  check('lista filtrada mostra só quem está aguardando resposta', cardsFiltrados.some(t => /BRUNO/.test(t)) && !cardsFiltrados.some(t => /ANA PRESIDENTE/.test(t)), cardsFiltrados.join(' | '));

  // Quem nunca foi contactado (sem campanha nem tentativa manual) não entra
  // no bucket "aguardando_resposta" — só em "pendente" (que continua mais
  // amplo, cobrindo os dois casos).
  await p.selectOption('#cm-filtro', 'pendente');
  await p.waitForTimeout(150);
  const totalPendente = (await p.locator('.import-card').count()) - 1; // -1 do card de cabeçalho
  check('bucket "pendente" continua mais amplo que "aguardando_resposta" (inclui quem nunca foi contactado)', totalPendente > 1, totalPendente);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.86 Tentativa MANUAL também conta pra "aguardando resposta" (não só
// campanha) — achado real ao construir 2.85: p.tentativas só contava
// campanha 'enviado', então alguém contactado só por "Registrar tentativa"/
// "Copiar link" aparecia como se nunca tivesse sido contactado ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  // Bruno já conta (campanha) — some mais uma tentativa manual e confirma
  // que o contador de tentativas dele sobe, sem duplicar a pessoa no painel
  // (ele já estava lá).
  await p.fill('#mm-tent-nota', 'Liguei de novo, caiu a chamada');
  await p.click('#modal-body button:has-text("Registrar tentativa")');
  await p.waitForTimeout(200);
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(150);

  const cardBrunoDepois = await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent();
  check('tentativa manual soma no contador exibido no card (campanha + manual)', /Já contactado \(2x\)/.test(cardBrunoDepois), cardBrunoDepois);
  const painelDepois = await p.locator('.import-result.ir-warn:has-text("aguardando resposta")').first().textContent();
  check('painel continua contando 1 pessoa (Bruno não duplica por ter 2 tentativas)', /1 pessoa\(s\) aguardando resposta/.test(painelDepois), painelDepois);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.87 Indicador de bolinha (🔴🟡🟢) + sugestão de escalonamento
// (27/08/2026, pedido direto: "verde amarela e vermelha ... se nunca foi
// contactado bolinha vermelha, se foi contactado hoje bolinha verde, se já
// foi contactado e nunca respondeu bolinha amarela ... uma indicação para
// passar o contato para o próximo nível, no caso carta ou oficial de
// justiça") ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // FABIO APOIO (a6) é pendente e nunca teve nenhuma tentativa (nem
  // campanha, nem manual) na fixture — bolinha vermelha.
  const cardFabio0 = await p.locator('.import-card:has-text("FABIO APOIO")').first().textContent();
  check('nunca contactado mostra bolinha vermelha', /🔴 Nunca contactado/.test(cardFabio0), cardFabio0.replace(/\s+/g, ' '));

  // BRUNO (a2) já tem 1 tentativa de campanha, mas de um dia no passado —
  // bolinha amarela (mesmo texto de sempre, "Já contactado (1x) — aguardando
  // resposta", só que agora prefixado pela bolinha em vez do 📨).
  const cardBruno0 = await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent();
  check('contactado antes (não hoje) mostra bolinha amarela', /🟡 Já contactado \(1x\) — aguardando resposta/.test(cardBruno0), cardBruno0.replace(/\s+/g, ' '));
  check('ainda sem 3 tentativas, não sugere escalonamento', !/considere Carta Registrada/.test(cardBruno0));

  // Registrar uma tentativa AGORA (bump otimista usa a hora local real do
  // teste) vira bolinha verde na hora, sem precisar recarregar a aba.
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  await p.fill('#mm-tent-nota', 'Liguei agora, não atendeu');
  await p.click('#modal-body button:has-text("Registrar tentativa")');
  await p.waitForTimeout(200);
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(150);
  const cardBrunoHoje = await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent();
  check('tentativa registrada agora vira bolinha verde na hora', /🟢 Já contactado \(2x\) — contactado hoje/.test(cardBrunoHoje), cardBrunoHoje.replace(/\s+/g, ' '));

  // Mais uma tentativa (total 3) — bate o limite de sugerir escalonamento,
  // já que o meio ainda é WhatsApp (não Carta/Ofício).
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  await p.fill('#mm-tent-nota', 'Terceira tentativa, ainda nada');
  await p.click('#modal-body button:has-text("Registrar tentativa")');
  await p.waitForTimeout(200);
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(150);
  const cardBruno3x = await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent();
  check('com 3 tentativas sem resposta, sugere escalonamento pra Carta/Ofício', /3x sem resposta pelo WhatsApp — considere Carta Registrada ou Oficial de Justiça/.test(cardBruno3x), cardBruno3x.replace(/\s+/g, ' '));
  check('botões de escalonamento aparecem no card', await p.locator('.import-card:has-text("BRUNO MESARIO") button:has-text("Passar pra Carta Registrada")').count() === 1
    && await p.locator('.import-card:has-text("BRUNO MESARIO") button:has-text("Passar pra Oficial de Justiça")').count() === 1);

  // Clicar "Passar pra Carta Registrada" muda o meio — sugestão some (não
  // faz sentido sugerir escalonar quem já foi escalado).
  await p.click('.import-card:has-text("BRUNO MESARIO") button:has-text("Passar pra Carta Registrada")');
  await p.waitForTimeout(200);
  const cardBrunoEscalado = await p.locator('.import-card:has-text("BRUNO MESARIO")').first().textContent();
  check('depois de trocar pra Carta Registrada, a sugestão de escalonamento some', !/considere Carta Registrada/.test(cardBrunoEscalado), cardBrunoEscalado.replace(/\s+/g, ' '));
  const updMeio = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.meio_contato === 'carta_registrada'));
  check('grava meio_contato=carta_registrada de verdade', !!updMeio, JSON.stringify(updMeio));

  // Quem já confirmou (ANA) não tem bolinha nenhuma — já tem desfecho.
  const cardAna0 = await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().textContent();
  check('quem já confirmou não mostra bolinha', !/🔴|🟡|🟢/.test(cardAna0), cardAna0.replace(/\s+/g, ' '));

  // Modal também mostra a bolinha na linha "Situação".
  await p.locator('.import-card:has-text("FABIO APOIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);
  const situacaoFabio = await p.locator('#modal-body .m-kv-row:has-text("Situação")').textContent();
  check('modal mostra a bolinha na linha Situação também', /🔴 Nunca contactado/.test(situacaoFabio), situacaoFabio);

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
  // Idem — escopado à lista de cards, não ao painel global do topo.
  const soAuxiliar = await p.locator('.cm-lista-pessoas').textContent();
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

// ── 2.96 Rodar script conversacional: colapsado por padrão, cascata por
// todos os números conhecidos (modal, 27-28/08/2026) ──
// Pedido direto (27/08): "caso não seja usado fica recolhido" (colapsável),
// e "ele seguiria tentando contato com todos os numeros do mesário caso um
// não confirme vai para o proximo" (cascata) — mesmo mecanismo do Disparo em
// massa (enfileira em sime_campanhas_confirmacao com campanha_id +
// etapa_atual:1), só que um item por vez, com os demais números guardados
// em numeros_restantes pra api/hermes-campanhas.js cascatear sozinho.
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);

  check('seção "Rodar script" começa recolhida (colapsável por padrão)', await p.locator('#mm-script-campanha').count() === 0);
  await p.locator('.m-section-hdr:has-text("Rodar script conversacional")').click();
  await p.waitForTimeout(150);
  check('clicar no cabeçalho expande a seção', await p.locator('#mm-script-campanha').count() === 1);
  check('campo agora é "Número extra (opcional)", sem pré-preencher', (await p.inputValue('#mm-script-tel')) === '');

  check('modal lista o script salvo da zona', await p.locator('#mm-script-campanha option', { hasText: 'Convocação de mesários (script)' }).count() === 1);

  await p.selectOption('#mm-script-campanha', 'camp-script-1');
  await p.waitForTimeout(200);
  check('escolher o script mostra a prévia (crua, sem personalizar) da etapa 1', (await p.locator('#modal-body').textContent()).includes('Confirma presença na Seção'));
  // BRUNO (a2) tem 2 telefones conhecidos na fixture: o principal e o
  // telefone_1_eleitor do ELO (raw1) — a ordem de tentativa deve listar os dois.
  check('mostra a ordem de tentativa com os telefones já conhecidos', (await p.locator('#modal-body').textContent()).includes('Ordem de tentativa'));

  // Número extra do pedido: um DIFERENTE de tudo que já é conhecido — entra
  // primeiro na fila, os conhecidos vão pra numeros_restantes.
  await p.fill('#mm-script-tel', '(86) 98888-7777');
  await p.click('#modal-body button:has-text("▶ Enviar")');
  await p.waitForTimeout(200);

  const inserido = await p.evaluate(() => (window.__mock.sime_campanhas_confirmacao || []).find(c => c.telefone_whatsapp === '5586988887777'));
  check('enfileira em sime_campanhas_confirmacao pro número extra (1º da fila)', !!inserido, JSON.stringify(inserido));
  check('item continua vinculado ao ator_id certo mesmo indo pra outro número', inserido?.ator_id === 'a2', String(inserido?.ator_id));
  check('item já entra na etapa 1 do script escolhido', inserido?.campanha_id === 'camp-script-1' && inserido?.etapa_atual === 1, JSON.stringify(inserido));
  check('mensagem enfileirada é a etapa 1 já personalizada (nome + seção)', /BRUNO MESARIO/.test(inserido?.mensagem_enviada || '') && /Seção 30/.test(inserido?.mensagem_enviada || ''), inserido?.mensagem_enviada);
  check('item começa pendente, igual ao disparo em massa', inserido?.status === 'pendente', inserido?.status);
  check('item marcado avulso:true — fura status rascunho/pausada da campanha em hermes-campanhas.js', inserido?.avulso === true, String(inserido?.avulso));
  check('numeros_restantes guarda os telefones conhecidos (principal + ELO), pro cascateamento', Array.isArray(inserido?.numeros_restantes) && inserido.numeros_restantes.includes('5586999990002') && inserido.numeros_restantes.includes('5586977778888'), JSON.stringify(inserido?.numeros_restantes));

  const logGravado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_script_enviado'));
  check('grava log de auditoria com autor, campanha e telefone usado', !!logGravado?.payload?.payload?.autor && logGravado.payload.payload.telefone === '5586988887777' && logGravado.payload.payload.campanha_id === 'camp-script-1', JSON.stringify(logGravado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.965 Rodar script: sem número extra, cascata usa só os conhecidos ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  await p.locator('.m-section-hdr:has-text("Rodar script conversacional")').click();
  await p.waitForTimeout(150);
  await p.selectOption('#mm-script-campanha', 'camp-script-1');
  await p.waitForTimeout(200);
  // Sem digitar nada no "Número extra" — só os conhecidos.
  await p.click('#modal-body button:has-text("▶ Enviar")');
  await p.waitForTimeout(200);

  const inserido = await p.evaluate(() => (window.__mock.sime_campanhas_confirmacao || []).find(c => c.telefone_whatsapp === '5586999990002'));
  check('sem número extra, usa o principal como 1º da fila', !!inserido, JSON.stringify(inserido));
  check('o telefone do ELO entra em numeros_restantes', Array.isArray(inserido?.numeros_restantes) && inserido.numeros_restantes.includes('5586977778888'), JSON.stringify(inserido?.numeros_restantes));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.97 Rodar script: sem escolher script, avisa em vez de enfileirar vazio ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  await p.locator('.m-section-hdr:has-text("Rodar script conversacional")').click();
  await p.waitForTimeout(150);
  await p.click('#modal-body button:has-text("▶ Enviar")'); // nenhum script escolhido ainda
  await p.waitForTimeout(150);

  const antes = await p.evaluate(() => (window.__mock.sime_campanhas_confirmacao || []).length);
  check('sem script escolhido, não enfileira nada', antes === 1); // só o camp1 original da fixture

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

  // ── normalizarTelefoneWhatsapp() — heurística usada por TODO import
  // (Ciente, colar lista, roster do TRE), pedido do cartório em 21/08/2026:
  // "sempre que importar o contato, normalizar pro formato WhatsApp". ──
  const normCasos = await p.evaluate(() => ({
    ja13: normalizarTelefoneWhatsapp('5586988887777'),
    len11SoFaltava55: normalizarTelefoneWhatsapp('86988887777'),
    // 10 dígitos, celular antigo sem o 9 (3º dígito 6-9) — soma "55" + "9".
    len10CelularAntigo: normalizarTelefoneWhatsapp('8677776666'),
    // 10 dígitos, fixo (3º dígito 2-5) — só soma "55", nunca ganha o 9.
    len10Fixo: normalizarTelefoneWhatsapp('8633334444'),
    // 9 dígitos já celular completo, sem DDD — assume 86.
    len9SemDDD: normalizarTelefoneWhatsapp('988887777'),
    // 8 dígitos, celular antigo sem DDD nem o 9 — assume 86 + soma o 9.
    len8CelularAntigo: normalizarTelefoneWhatsapp('77776666'),
    // placeholder — nunca vira um número inventado.
    placeholder: normalizarTelefoneWhatsapp('000000000000'),
    vazio: normalizarTelefoneWhatsapp(''),
  }));
  check('já em "55"+DDD+9: mantém como está', normCasos.ja13 === '5586988887777', JSON.stringify(normCasos.ja13));
  check('DDD+9 sem "55": só soma o "55"', normCasos.len11SoFaltava55 === '5586988887777', JSON.stringify(normCasos.len11SoFaltava55));
  check('DDD+8 celular antigo: soma "55" e o dígito 9', normCasos.len10CelularAntigo === '5586977776666', JSON.stringify(normCasos.len10CelularAntigo));
  check('DDD+8 fixo: só soma "55", não inventa o 9', normCasos.len10Fixo === '558633334444', JSON.stringify(normCasos.len10Fixo));
  check('9 dígitos sem DDD: assume 86', normCasos.len9SemDDD === '5586988887777', JSON.stringify(normCasos.len9SemDDD));
  check('8 dígitos celular antigo sem DDD: assume 86 e soma o 9', normCasos.len8CelularAntigo === '5586977776666', JSON.stringify(normCasos.len8CelularAntigo));
  check('placeholder "000000000000" nunca vira número inventado', normCasos.placeholder === '000000000000', JSON.stringify(normCasos.placeholder));
  check('vazio continua vazio', normCasos.vazio === '', JSON.stringify(normCasos.vazio));

  // ── normalizarTituloEleitor() (27/08/2026, achado real: HEMANUELA e 708
  // outros casos duplicados porque Excel come o zero à esquerda do título) ──
  const tituloCasos = await p.evaluate(() => ({
    ja12: normalizarTituloEleitor('046919051589'),
    sem11: normalizarTituloEleitor('46919051589'),
    comEspacos: normalizarTituloEleitor('0469 1905 1589'),
    vazio: normalizarTituloEleitor(''),
  }));
  check('já com 12 dígitos: mantém como está', tituloCasos.ja12 === '046919051589', JSON.stringify(tituloCasos.ja12));
  check('11 dígitos (zero comido pelo Excel): completa com zero à esquerda', tituloCasos.sem11 === '046919051589', JSON.stringify(tituloCasos.sem11));
  check('tolera espaço entre blocos', tituloCasos.comEspacos === '046919051589', JSON.stringify(tituloCasos.comEspacos));
  check('vazio continua vazio', tituloCasos.vazio === '', JSON.stringify(tituloCasos.vazio));

  // ── Atualizar contatos (formato de 16 colunas, com Ciente) ──
  const mcHeaders = ['Zona','Seção','Nome','Inscrição','Situação','Localidade','Nº Local','Nome Local','Cód. Objeto Local','Nº Função Eleitoral','Função Eleitoral','Data Atualização','Ciente','whatsapp','celular','telefone2'];
  const mcRow = (over) => mcHeaders.map(h => over[h] ?? '').join(',');
  const mcCsv = [
    mcHeaders.join(','),
    // casa com BRUNO (inscricao_eleitoral='046919051589') — Ciente=1, telefone novo.
    // Título SEM o zero à esquerda de propósito (27/08/2026, achado real:
    // Excel/planilha come esse zero) — precisa casar mesmo assim.
    mcRow({ 'Inscrição':'46919051589', 'Ciente':'1', 'whatsapp':'86988887777' }),
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
  // convocacao_recebida junto (28/08/2026) — confirmar já implica ter
  // recebido a convocação, mesma regra aplicada ao botão "Confirmado" do
  // modal e à confirmação via Hermes.
  check('marca convocacao_recebida=true junto', updBruno?.payload?.convocacao_recebida === true, JSON.stringify(updBruno));
  // Com "55" na frente (21/08/2026) — antes gravava os dígitos crus do
  // arquivo, fora do padrão que o resto do sistema assume.
  check('atualiza telefone junto, já normalizado com 55', updBruno?.payload?.telefone_whatsapp === '5586988887777', JSON.stringify(updBruno));
  check('Bruno realmente mudou no mock (não só o log de escrita)', await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2').confirmacao) === 'confirmado');

  const resumo = await p.locator('.content').textContent();
  check('mostra 1 atualizado e 1 sem cadastro correspondente', /1.*atualizado/.test(resumo) && /1.*sem cadastro correspondente/.test(resumo), resumo.replace(/\s+/g, ' ').slice(0, 400));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3.4 Sincronizar mesários: subir só 1 das 2 planilhas (MRV ou Apoio) não
// pode inativar a outra — bug real corrigido em 21/08/2026. Antes, o delete
// de staging apagava TODA a zona/UF antes de reinserir; subindo só a MRV
// (sem reanexar a Apoio, que o cartório não tinha em mãos nessa rodada), o
// staging da Apoio sumia e sime_sync_atores_from_raw inativava por engano
// quem era só do outro tipo. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Staging pré-existente de uma sincronização ANTERIOR da Apoio especializado
  // — precisa sobreviver a um upload de hoje que só traz a MRV.
  m.sime_mesarios_raw = [
    { id: 'rawAL1', inscricao: '555555555555', zona_eleitoral_trabalho: '7', uf_trabalho: 'PI', tipo_registro: 'AL' },
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-sync-btn');
  await p.waitForTimeout(200);

  const msHeaders = ["Processo Eleitoral","Pleito","UF de trabalho","Zona eleitoral de trabalho","Inscrição","CPF (eleitor)","CPF (dados mesário)","Nome civil","Nome Social","Data de nascimento","Tipo telefone 1 (eleitor)","Telefone 1 (eleitor)","Tipo telefone 2 (eleitor)","Telefone 2 (eleitor)","Telefone contato (eleitor)","Tipo telefone pessoal (dados mesário)","Telefone pessoal (dados mesário)","Tipo telefone comercial (dados mesário)","Telefone comercial (dados mesário)","E-mail (eleitor)","E-mail (dados mesário)","Tipo correspondência","Grau de instrução (eleitor)","Grau de instrução (dados mesário)","Ocupação (eleitor)","Ocupação (dados mesário)","Excluído de eleição futura","Data limite exclusão de eleição futura","Observação (dados mesário)","Possui carro","Experiência","ASE 205","UF do endereço do eleitor","Código município do endereço do eleitor","Nome município do endereço do eleitor","Endereço do eleitor","Bairro do eleitor","CEP do eleitor","Zona eleitoral do eleitor","UF (dados mesário)","Código município (dados mesário)","Nome município (dados mesário)","Endereço (dados mesário)","Bairro (dados mesário)","CEP (dados mesário)","UF comercial (dados mesário)","Código município comercial (dados mesário)","Nome município comercial (dados mesário)","Endereço comercial (dados mesário)","Bairro comercial (dados mesário)","CEP comercial (dados mesário)","Nome de empresa","Função na empresa","Código município local de trabalho","Nome município local de trabalho","Bairro","CEP","Número do Local de votação local de trabalho","Nome do local de votação local de trabalho","Descrição local de trabalho","Seção local de trabalho","MRJ local de trabalho","UF de votação do eleitor","Código município de votação do eleitor","Nome município de votação do eleitor","Bairro de votação do eleitor","CEP de votação do eleitor","Número do local de votação do eleitor","Nome do local de votação do eleitor","Número da seção de votação do eleitor","Tipo função eleitoral","Descrição função eleitoral","Data atribuição","Data convocação","Data nomeação","Data atualização (dados mesário)","Data último RAE","Confirmou convocação","Origem da resposta","Data de resposta","Justificativa"];
  const msRow = (over) => msHeaders.map(h => over[h] ?? '').join(',');
  const msCsv = [
    msHeaders.join(','),
    msRow({ 'UF de trabalho':'PI', 'Zona eleitoral de trabalho':'7', 'Inscrição':'046919051589', 'Nome civil':'BRUNO MESARIO', 'Seção local de trabalho':'0030', 'Nome município local de trabalho':'Campo Maior', 'Tipo função eleitoral':'MRV', 'Descrição função eleitoral':'Presidente' }),
  ].join('\n');
  const msPath = '/tmp/_sime_test_mrv.csv';
  writeFileSync(msPath, msCsv, 'utf8');
  await p.setInputFiles('#ms-csv-input', msPath);
  await p.waitForTimeout(300);
  unlinkSync(msPath);

  check('carrega o arquivo MRV (1 linha)', /1 registro/.test((await p.locator('.content').textContent()).replace(/\s+/g, ' ')));
  await p.click('button:has-text("✓ Sincronizar com o SIME")');
  await p.waitForTimeout(300);

  const delChamada = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'delete' && e.tabela === 'sime_mesarios_raw'));
  check('delete do staging é escopado só ao tipo_registro presente no upload (MRV)', JSON.stringify(delChamada?.filtro?.__in_tipo_registro) === JSON.stringify(['MRV']), JSON.stringify(delChamada));
  const rawSobrevivente = await p.evaluate(() => window.__mock.sime_mesarios_raw.find(r => r.id === 'rawAL1'));
  check('staging da Apoio (upload anterior) sobrevive a um sync que só trouxe MRV', !!rawSobrevivente, JSON.stringify(rawSobrevivente));

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

  // Com "55" na frente (21/08/2026) — mesma normalização de mcAtualizar.
  const updBruno2 = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.inscricao_eleitoral === '046919051589' && e.payload.telefone_whatsapp === '5586986665544'));
  check('linha limpa (título+telefone válidos) grava telefone_whatsapp normalizado com 55, sem mexer em confirmacao', !!updBruno2 && !('confirmacao' in updBruno2.payload), JSON.stringify(updBruno2));

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
    // LEO: título salvo no SIME já normalizado (12 dígitos), mas a linha do
    // ELO (sime_mesarios_raw) ainda tem o formato cru do arquivo, sem o zero
    // à esquerda (27/08/2026, mesmo achado real da duplicata da HEMANUELA) —
    // tem que casar mesmo assim, senão o relatório mentiria "sem registro".
    { id:'a12', nome_completo:'LEO TITULO SEM ZERO NO ELO', telefone_whatsapp:'5586999990012', funcao:'mesario', funcao_mesa:'2º Secretário', secao_id:null, zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, inscricao_eleitoral:'055555555555' },
  );
  m.sime_mesarios_raw = [
    { id:'raw2', inscricao:'111111111111', confirmou_convocacao: null, origem_resposta: null, data_resposta: null },
    { id:'raw3', inscricao:'222222222222', confirmou_convocacao: 'Não', origem_resposta: 'Não', data_resposta: '17/08/2026' },
    // KAIO: já "Sim" no ELO — não deve aparecer no relatório.
    { id:'raw4', inscricao:'444444444444', confirmou_convocacao: 'Sim', origem_resposta: 'WhatsApp', data_resposta: '10/08/2026' },
    // LEO: mesmo título de a12 (055555555555), mas SEM o zero à esquerda —
    // já "Sim" no ELO, então também não deve aparecer no relatório.
    { id:'raw5', inscricao:'55555555555', confirmou_convocacao: 'Sim', origem_resposta: 'WhatsApp', data_resposta: '11/08/2026' },
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
  check('relatório ELO casa título mesmo com zero à esquerda divergente entre SIME e ELO — NÃO mostra LEO', !/LEO TITULO SEM ZERO NO ELO/.test(flat), flat.slice(0, 900));
  check('relatório ELO avisa quantos casos têm conflito (1)', /1 caso\(s\) com resposta "Não"/.test(flat), flat.slice(0, 300));
  check('BRUNO/CARLA/DIEGO (não confirmados) não aparecem no relatório', !/BRUNO MESARIO/.test(flat) && !/CARLA RECUSOU/.test(flat) && !/DIEGO CARTA/.test(flat));
  // ANA é confirmado mas não tem inscricao_eleitoral na fixture — sem título, não dá pra cruzar com o ELO.
  check('ANA (confirmado, mas sem título de eleitor) não aparece — não dá pra cruzar sem título', !/ANA PRESIDENTE/.test(flat));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3.7 Correspondência — etiqueta + AR pra convocação por carta ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Fixture local (não mexe no mock() compartilhado com os demais testes).
  // DIEGO (a4) já é 'carta_registrada' na fixture padrão — só falta título
  // de eleitor + uma linha no ELO com endereço, pra testar o caminho normal
  // (fallback pro cadastro de eleitor, já que ele não tem "dados do mesário").
  m.sime_atores.find(a => a.id === 'a4').inscricao_eleitoral = '098765432100';
  m.sime_atores.push(
    // MARIA: carta_registrada mas SEM nenhuma linha no ELO — "sem endereço".
    { id:'a20', nome_completo:'MARIA SEM ENDERECO', telefone_whatsapp:'', funcao:'mesario', funcao_mesa:'2º Secretário', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'carta_registrada', inscricao_eleitoral:'077777777777' },
    // NUNO: carta_registrada com os DOIS blocos preenchidos no ELO — testa
    // que "dados do mesário" ganha do "cadastro de eleitor" (prioridade).
    { id:'a21', nome_completo:'NUNO DADOS MESARIO', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:null, zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'carta_registrada', inscricao_eleitoral:'088888888888' },
    // OTAVIO: WhatsApp, não carta — não deve aparecer na lista de destinatários.
    { id:'a22', nome_completo:'OTAVIO WHATSAPP', telefone_whatsapp:'5586999990022', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', inscricao_eleitoral:'099999999999' },
  );
  m.sime_mesarios_raw.push(
    { id:'raw10', inscricao:'098765432100', endereco_eleitor:'Rua das Flores, 100', bairro_eleitor:'Centro', cep_eleitor:'64280000', nome_municipio_endereco_eleitor:'Campo Maior', uf_endereco_eleitor:'PI' },
    { id:'raw11', inscricao:'088888888888', endereco_dados_mesario:'Av. Nova, 50', bairro_dados_mesario:'Bairro Novo', cep_dados_mesario:'64280100', nome_municipio_dados_mesario:'Campo Maior', uf_dados_mesario:'PI', endereco_eleitor:'Endereço antigo que não deve aparecer', bairro_eleitor:'Bairro antigo', cep_eleitor:'64280999', nome_municipio_endereco_eleitor:'Campo Maior', uf_endereco_eleitor:'PI' },
  );

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-correspondencia-btn');
  await p.waitForTimeout(300);

  let txt = await p.locator('.content').textContent();
  check('aviso: remetente incompleto antes de preencher', /Preencha o remetente/.test(txt));
  check('lista os 2 destinatários com endereço (DIEGO, NUNO)', /DIEGO CARTA/.test(txt) && /NUNO DADOS MESARIO/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 500));
  check('não lista OTAVIO (meio de contato é WhatsApp, não carta)', !/OTAVIO WHATSAPP/.test(txt));
  check('MARIA (sem linha no ELO) cai na lista "sem endereço", à parte', /Sem endereço no ELO/.test(txt) && /MARIA SEM ENDERECO/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 800));
  check('endereço de DIEGO usa o do cadastro de eleitor (só bloco disponível)', /Rua das Flores, 100/.test(txt) && /Cadastro de eleitor \(TRE\)/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 800));
  check('endereço de NUNO usa "dados do mesário" (prioridade sobre o de eleitor)', /Av\. Nova, 50/.test(txt) && !/Endereço antigo que não deve aparecer/.test(txt) && /Dados do mesário \(TRE\)/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 800));

  // 27/08/2026, fix cbd05e1: botão NUNCA fica disabled (um botão disabled
  // não dispara clique nenhum, sem toast, sem aviso — "clicar não fez
  // nada" reportado em produção) — clicar sem remetente completo mostra
  // toast explicando o que falta, e não deve chamar window.print().
  check('botão de etiqueta não fica disabled (nunca — evita clique morto)', !(await p.locator('[data-ator-id="a4"] button:has-text("🏷️ Etiqueta")').isDisabled()));
  await p.locator('[data-ator-id="a4"] button:has-text("🏷️ Etiqueta")').click();
  await p.waitForTimeout(200);
  check('clicar sem remetente completo avisa por toast, não falha em silêncio', (await p.textContent('#toast')).includes('Preencha nome do cartório'));
  check('clicar sem remetente completo NÃO chama window.print()', await p.evaluate(() => window.__printCalls) === 0);

  // Preenche e salva o remetente (cartório da zona).
  await p.fill('#co-rem-nome', 'Cartório da 7ª Zona Eleitoral');
  await p.fill('#co-rem-endereco', 'Praça da Matriz, 10');
  await p.fill('#co-rem-bairro', 'Centro');
  await p.fill('#co-rem-cep', '64280000');
  await p.fill('#co-rem-municipio', 'Campo Maior');
  await p.fill('#co-rem-uf', 'PI');
  await p.click('button:has-text("💾 Salvar remetente")');
  await p.waitForTimeout(300);

  txt = await p.locator('.content').textContent();
  check('aviso de remetente incompleto some depois de salvar', !/Preencha o remetente/.test(txt));
  const updZona = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_zonas'));
  check('remetente gravado em sime_zonas (update, não insert novo)', !!updZona && updZona.payload.remetente_nome === 'Cartório da 7ª Zona Eleitoral', JSON.stringify(updZona));
  check('grava log de auditoria do remetente salvo', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'correspondencia_remetente_salvo')));

  // Imprime a etiqueta de DIEGO (botão individual).
  await p.locator('[data-ator-id="a4"] button:has-text("🏷️ Etiqueta")').click();
  await p.waitForTimeout(200);
  check('imprimir etiqueta chama window.print()', await p.evaluate(() => window.__printCalls) === 1);
  // 27/08/2026: layout reconstruído pra seguir o modelo público do
  // Enderecador de Encomendas dos Correios (dois PDFs reais enviados pelo
  // dono do projeto) — etiqueta ganhou recebedor/assinatura embutidos,
  // "entrega no vizinho", barra DESTINATÁRIO e espaço reservado (nunca um
  // código inventado) pra colar a etiqueta de rastreio da agência.
  const printHtmlEtiqueta = await p.locator('#print-area').innerHTML();
  check('etiqueta impressa mostra remetente e destinatário', /Cartório da 7ª Zona Eleitoral/.test(printHtmlEtiqueta) && /DIEGO CARTA/.test(printHtmlEtiqueta) && /Rua das Flores, 100/.test(printHtmlEtiqueta), printHtmlEtiqueta.slice(0, 600));
  check('etiqueta segue o modelo oficial: recebedor, entrega no vizinho, DESTINATÁRIO', /Recebedor:/.test(printHtmlEtiqueta) && /ENTREGA NO VIZINHO AUTORIZADA/.test(printHtmlEtiqueta) && /Entrega no vizinho não autorizada/.test(printHtmlEtiqueta) && /DESTINATÁRIO/.test(printHtmlEtiqueta), printHtmlEtiqueta.slice(0, 800));
  check('etiqueta nunca inventa código de rastreio — só reserva o espaço pra colar', /Cole aqui a etiqueta de rastreio/.test(printHtmlEtiqueta));
  check('grava log de etiqueta impressa', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'correspondencia_etiqueta_impressa')));

  // Gera o AR de NUNO (botão individual).
  await p.locator('[data-ator-id="a21"] button:has-text("📄 AR")').click();
  await p.waitForTimeout(200);
  check('gerar AR chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 2);
  const printHtmlAr = await p.locator('#print-area').innerHTML();
  check('AR impresso tem o modelo de confirmação de recebimento, não uma etiqueta', /AVISO DE RECEBIMENTO/.test(printHtmlAr) && /NOME LEGÍVEL DO RECEBEDOR/.test(printHtmlAr) && /NUNO DADOS MESARIO/.test(printHtmlAr) && /Av\. Nova, 50/.test(printHtmlAr), printHtmlAr.slice(0, 600));
  check('AR segue o modelo oficial: tentativas de entrega, motivo de devolução, endereço de devolução', /TENTATIVAS DE ENTREGA/.test(printHtmlAr) && /MOTIVO DE DEVOLUÇÃO/.test(printHtmlAr) && /Não procurado/.test(printHtmlAr) && /ENDEREÇO PARA DEVOLUÇÃO DO AR/.test(printHtmlAr), printHtmlAr.slice(0, 800));
  check('AR nunca inventa código de rastreio — só reserva o espaço pra colar', /cole aqui a etiqueta de rastreio/.test(printHtmlAr));
  check('grava log de AR impresso', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'correspondencia_ar_impresso')));

  // Seleção em massa: marca DIEGO, imprime etiquetas selecionadas.
  await p.locator('[data-ator-id="a4"] input[type=checkbox]').check();
  await p.click('button:has-text("Imprimir etiquetas selecionadas (1)")');
  await p.waitForTimeout(200);
  check('imprimir em massa chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 3);

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
