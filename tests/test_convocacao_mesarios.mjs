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
    sime_zonas: [{ id:'z7', numero:7, estado:'PI', municipio:'Campo Maior' }],
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

  // Nome do Coordenador de Acessibilidade abaixo do nome do local (01/09/2026,
  // pedido direto: "abaixo do nome pode indicar o nome do coordenador de
  // acessibilidade designado?") — GEORGE COORD (fixture a7) está na seção 31
  // (s2), que faz parte do mesmo local "Grupo Escolar A" que a seção 30 (s1);
  // ele é pendente, então o ícone é 🔶 (mesmo critério de rsStatusCargo).
  const drilldownFlat = drilldown.replace(/\s+/g, ' ');
  check('drilldown: mostra o nome do Coordenador de Acessibilidade do local (GEORGE COORD)', /Coordenador\(a\) de Acessibilidade: 🔶 GEORGE COORD/.test(drilldownFlat), drilldownFlat.slice(0, 300));

  // Clicar no nome do coordenador também abre o modal de tentativas de
  // contato (mesmo dia, pedido direto: "permita clicar no nome do
  // coordenador para verificar a situação") — mesmo mecanismo do clique no
  // nome do mesário, só que a partir do cabeçalho do local, não de um cargo.
  await p.locator('span[onclick*="cmAbrirModal(\'a7\')"]').click();
  await p.waitForTimeout(300);
  check('clicar no nome do coordenador de acessibilidade abre o modal', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('modal aberto a partir do coordenador mostra a pessoa certa (GEORGE COORD)', /GEORGE COORD/.test(await p.locator('#modal-body').textContent()));
  await p.evaluate(() => window.cmFecharModal({ target: document.getElementById('overlay') }));
  await p.waitForTimeout(100);

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

  // Local sem NENHUM Coordenador de Acessibilidade designado (Escola B, só
  // tem a seção 63/s3, sem apoio nenhum na fixture) — mostra o aviso
  // explícito em vez de deixar a linha em branco.
  await p.click('.import-card:has-text("Escola B")');
  await p.waitForTimeout(200);
  const drilldownEscolaB = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('drilldown: local sem coordenador mostra aviso explícito', /Coordenador\(a\) de Acessibilidade: ❌ Sem coordenador de acessibilidade designado/.test(drilldownEscolaB), drilldownEscolaB.slice(0, 300));
  await p.click('button:has-text("← Voltar")');
  await p.waitForTimeout(150);

  // Bug real corrigido em 01/09/2026 — cada tecla digitada na busca
  // reconstrói #content.innerHTML do zero, trocando o <input> por um
  // elemento novo; sem restaurar foco/cursor, o campo perdia o foco a cada
  // caractere (reportado como "a consulta ainda esta sendo caracter por
  // caracter" — só dava pra digitar 1 caractere por clique). Digita
  // caractere por caractere de verdade (pressSequentially simula teclas
  // reais, uma de cada vez — diferente de fill(), que seta o valor inteiro
  // de uma vez e não reproduziria o bug) e confirma que o campo continua
  // focado e com o texto completo no final.
  await p.click('#rs-busca');
  await p.locator('#rs-busca').pressSequentially('245', { delay: 30 });
  await p.waitForTimeout(150);
  check('busca real (tecla por tecla) mantém o foco no campo depois de cada caractere', await p.evaluate(() => document.activeElement?.id === 'rs-busca'));
  check('busca real (tecla por tecla) chega com o texto completo, não só o 1º caractere', await p.locator('#rs-busca').inputValue() === '245');
  await p.fill('#rs-busca', '');
  await p.waitForTimeout(150);

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

// ── 1.6 Dashboard: busca por número de seção + filtro por situação
// (01/09/2026, pedido direto: "quero poder pesquisar o numero da seção. e um
// filtro para mostrar seções todas confirmadas, seções com vagas e seções
// com mesários pendentes"). Fixture com 3 locais, cada um batendo só UMA das
// três situações — pra separar claramente o que cada filtro deve trazer. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes = [
    { id:'secCompleta', numero:100, local_nome:'Local Completo', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
    { id:'secVazia', numero:200, local_nome:'Local Vazio', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
    { id:'secPendente', numero:300, local_nome:'Local Pendente', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
  ];
  const cargo = (id, secao_id, funcao_mesa, confirmacao) => ({ id, nome_completo:id, telefone_whatsapp:'', funcao:'mesario', funcao_mesa, secao_id, zona_id:'z7', confirmacao, ativo:true });
  m.sime_atores = [
    // Local Completo (seção 100): mesa cheia e 100% confirmada.
    cargo('lc1','secCompleta','Presidente','confirmado'), cargo('lc2','secCompleta','1º Mesário','confirmado'),
    cargo('lc3','secCompleta','2º Mesário','confirmado'), cargo('lc4','secCompleta','1º Secretário','confirmado'),
    // Local Vazio (seção 200): ninguém designado — "tem vaga", mas não "tem
    // pendente" (não há ninguém aguardando confirmação, só cargo vazio).
    // Local Pendente (seção 300): mesa cheia, mas ninguém confirmou ainda —
    // "tem pendente", mas não "tem vaga" (todos os 4 cargos já têm gente).
    cargo('lp1','secPendente','Presidente','pendente'), cargo('lp2','secPendente','1º Mesário','pendente'),
    cargo('lp3','secPendente','2º Mesário','pendente'), cargo('lp4','secPendente','1º Secretário','pendente'),
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(300);

  // Busca por número de seção — antes só casava nome de local/município.
  await p.fill('input[placeholder*="Pesquisar"]', '200');
  await p.waitForTimeout(150);
  let txt = await p.locator('.content').textContent();
  check('busca "200" acha o local pelo número da seção (Local Vazio)', /Local Vazio/.test(txt) && !/Local Completo/.test(txt) && !/Local Pendente/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));
  await p.fill('input[placeholder*="Pesquisar"]', '300');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('busca "300" acha o local pelo número da seção (Local Pendente)', /Local Pendente/.test(txt) && !/Local Completo/.test(txt) && !/Local Vazio/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));

  // Vários números de uma vez, separados por VÍRGULA (01/09/2026, pedido
  // direto: "no filtro do dashboard so permite consultar numero por
  // numero") — antes o campo inteiro virava UM substring só, então "200,300"
  // não achava nenhum local (nenhum tem essa string exata). Só vírgula, não
  // espaço — nome de local é frase com espaço (testado logo abaixo, no bloco
  // 1: "Escola B" continua achando só Escola B, não qualquer local com
  // "escola" solto no nome).
  await p.fill('input[placeholder*="Pesquisar"]', '200,300');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('busca "200,300" (vírgula) acha os DOIS locais, não zero', /Local Vazio/.test(txt) && /Local Pendente/.test(txt) && !/Local Completo/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));
  await p.fill('input[placeholder*="Pesquisar"]', '200, 300');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('busca "200, 300" (vírgula + espaço, cada termo é trimado) também acha os dois', /Local Vazio/.test(txt) && /Local Pendente/.test(txt) && !/Local Completo/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));
  await p.fill('input[placeholder*="Pesquisar"]', '');
  await p.waitForTimeout(150);

  // Filtro "✅ Todas as seções confirmadas" — só Local Completo.
  await p.selectOption('select[aria-label="Filtrar por situação"]', 'confirmadas');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('filtro confirmadas: só Local Completo', /Local Completo/.test(txt) && !/Local Vazio/.test(txt) && !/Local Pendente/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));

  // Filtro "❌ Com vagas" — só Local Vazio (Local Pendente tem os 4 cargos
  // preenchidos, só não confirmados; Local Completo não tem vaga nenhuma).
  await p.selectOption('select[aria-label="Filtrar por situação"]', 'vagas');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('filtro vagas: só Local Vazio', /Local Vazio/.test(txt) && !/Local Completo/.test(txt) && !/Local Pendente/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));

  // Filtro "🔶 Com mesários pendentes de confirmação" — só Local Pendente
  // (Local Vazio não tem NINGUÉM designado, então não há pendente — só vaga).
  await p.selectOption('select[aria-label="Filtrar por situação"]', 'pendentes');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('filtro pendentes: só Local Pendente', /Local Pendente/.test(txt) && !/Local Completo/.test(txt) && !/Local Vazio/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));

  // Volta pra "Todos os locais" — os 3 aparecem de novo.
  await p.selectOption('select[aria-label="Filtrar por situação"]', 'todos');
  await p.waitForTimeout(150);
  txt = await p.locator('.content').textContent();
  check('filtro todos: os 3 locais aparecem de novo', /Local Completo/.test(txt) && /Local Vazio/.test(txt) && /Local Pendente/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 400));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 1.7 Dashboard: conflito mesário × Coordenador de Acessibilidade
// (01/09/2026, pedido direto: "um mesário nunca pode ser coordenador de
// acessibilidade e membro da mesa ao mesmo tempo" — achado real conferindo
// isso no banco: existem casos assim na 7ª Zona, mesma pessoa confirmada
// nos dois papéis em seções diferentes ao mesmo tempo). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes = [
    { id:'secConflitoMesa', numero:10, local_nome:'Local X', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
    { id:'secConflitoCoord', numero:20, local_nome:'Local Y', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
  ];
  // Mesma pessoa (mesmo título de eleitor) designada como mesário no Local X
  // E como Coordenador de Acessibilidade no Local Y, ao mesmo tempo.
  m.sime_atores = [
    { id:'mesA', nome_completo:'CARLOS DUPLO PAPEL', telefone_whatsapp:'', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'secConflitoMesa', zona_id:'z7', confirmacao:'confirmado', ativo:true, inscricao_eleitoral:'099999999999' },
    { id:'coordA', nome_completo:'CARLOS DUPLO PAPEL', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:'secConflitoCoord', zona_id:'z7', confirmacao:'confirmado', ativo:true, inscricao_eleitoral:'099999999999' },
  ];

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(300);

  // Abre o local do mesário (Local X) — o cargo Presidente deve mostrar o
  // aviso de que essa pessoa também é coordenador em outra seção.
  await p.click('.import-card:has-text("Local X")');
  await p.waitForTimeout(200);
  const drilldownX = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('conflito: card do mesário mostra aviso de que também é Coord. Acessibilidade (Seção 20)', /tb\. Coord\. Seção 20/.test(drilldownX), drilldownX.slice(0, 400));
  const tituloPresidente = await p.locator('[title*="também é Coordenador"]').first().getAttribute('title');
  check('conflito: tooltip do cargo explica o conflito por extenso', !!tituloPresidente && /também é Coordenador\(a\) de Acessibilidade na Seção 20/.test(tituloPresidente), tituloPresidente || '(sem title)');
  await p.click('button:has-text("← Voltar")');
  await p.waitForTimeout(150);

  // Abre o local do coordenador (Local Y) — a linha do coordenador deve
  // mostrar o aviso recíproco (também é mesário em outra seção).
  await p.click('.import-card:has-text("Local Y")');
  await p.waitForTimeout(200);
  const drilldownY = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('conflito: linha do coordenador mostra aviso de que também é mesário (Seção 10)', /também é mesário \(Seção 10\)/.test(drilldownY), drilldownY.slice(0, 400));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 1.8 Dashboard: ícone do cargo reflete o meio de contato quando ainda
// não confirmou (01/09/2026, pedido direto: "mude o icone se for ainda não
// confirmado permanece o losango, se mudar para carta de convocação mude o
// icone para uma carta, se for oficial de justiça mude o icone para um
// policial..., se for contato telefonico mude o [icone] para um
// telefone"). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes = [
    { id:'secIcones', numero:50, local_nome:'Local Ícones', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
    { id:'secIconeConfirmado', numero:51, local_nome:'Local Ícones', municipio:'Campo Maior', zona_id:'z7', ativo:true, eleitores:200 },
  ];
  const cargo = (id, secao_id, funcao_mesa, confirmacao, meio_contato) => ({ id, nome_completo:id, telefone_whatsapp:'', funcao:'mesario', funcao_mesa, secao_id, zona_id:'z7', confirmacao, ativo:true, meio_contato });
  m.sime_atores = [
    // Seção 50: os 4 cargos, cada um com um meio de contato diferente,
    // todos ainda pendentes (nenhum confirmou).
    cargo('icPresidente','secIcones','Presidente','pendente','whatsapp'),        // padrão — continua losango
    cargo('icMesario1','secIcones','1º Mesário','pendente','carta_registrada'),  // vira carta
    cargo('icMesario2','secIcones','2º Mesário','pendente','oficial_justica'),   // vira "policial"
    cargo('icSecretario','secIcones','1º Secretário','pendente','ligacao'),      // vira telefone
    // Seção 51: mesmo meio (carta_registrada), mas JÁ confirmado — prova que
    // o ícone de status confirmado (✅) tem prioridade, não muda pra carta.
    cargo('icConfirmadoCarta','secIconeConfirmado','Presidente','confirmado','carta_registrada'),
  ];

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(300);
  await p.click('.import-card:has-text("Local Ícones")');
  await p.waitForTimeout(200);

  const cardSecao50 = await p.locator('.import-card:has-text("Seção 50")').first().textContent();
  check('meio WhatsApp/padrão, ainda pendente: continua o losango 🔶', cardSecao50.includes('🔶'), cardSecao50.replace(/\s+/g, ' '));
  check('meio Carta Registrada, ainda pendente: ícone vira carta ✉️', cardSecao50.includes('✉️'), cardSecao50.replace(/\s+/g, ' '));
  check('meio Oficial de Justiça, ainda pendente: ícone vira "policial" 👮', cardSecao50.includes('👮'), cardSecao50.replace(/\s+/g, ' '));
  check('meio Ligação telefônica, ainda pendente: ícone vira telefone 📞', cardSecao50.includes('📞'), cardSecao50.replace(/\s+/g, ' '));

  const tituloCarta = await p.locator('[title*="✉️"], div[title*="Carta Registrada"]').first().getAttribute('title').catch(() => null);
  check('tooltip do cargo carta explica o meio por extenso', !!tituloCarta && /Aguardando confirmação \(Carta Registrada\)/.test(tituloCarta), tituloCarta || '(sem title)');

  const cardSecao51 = await p.locator('.import-card:has-text("Seção 51")').first().textContent();
  check('confirmado com meio Carta Registrada: continua ✅, NÃO vira carta (status confirmado tem prioridade)', cardSecao51.includes('✅') && !cardSecao51.includes('✉️'), cardSecao51.replace(/\s+/g, ' '));

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
  await p.waitForTimeout(350); // busca agora tem debounce de 250ms (ver cmOnBuscaInput)
  const porTitulo = await p.locator('.content').textContent();
  check('buscar pelo número do título encontra só quem bate', /BRUNO MESARIO/.test(porTitulo) && !/ANA PRESIDENTE/.test(porTitulo), porTitulo.slice(0, 200));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.71 Bug real corrigido em 31/08/2026, reportado pelo cartório: "só
// permite digitar uma letra por vez, e está demorando muito". Causa: o
// campo de busca chamava render() a cada tecla, e render() reconstrói
// #content inteiro via innerHTML — o que recria o <input> como um elemento
// novo a cada tecla, derrubando o foco no meio da própria digitação. Testa
// digitando devagar o bastante (300ms/tecla) pra estourar o debounce de
// 250ms várias vezes DURANTE a digitação — se o foco se perdesse, letras
// subsequentes cairiam no vazio e o valor final ficaria incompleto. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const busca = p.locator('#cm-busca');
  await busca.click();
  await busca.pressSequentially('BRUNO', { delay: 300 });
  await p.waitForTimeout(400); // além do último debounce

  check('nenhuma letra se perde — valor final tem a palavra inteira', await busca.inputValue() === 'BRUNO', await busca.inputValue());
  check('campo continua com o foco depois de vários re-renders no meio da digitação', await p.evaluate(() => document.activeElement?.id === 'cm-busca'));
  const listaFiltrada = await p.locator('.content').textContent();
  check('filtro aplicado corretamente ao fim da digitação', /BRUNO MESARIO/.test(listaFiltrada) && !/ANA PRESIDENTE/.test(listaFiltrada));

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

  // Excluir o que foi cadastrado à mão — todo cartão com valor tem o ✕
  // (01/09/2026: generalizado de "só o alternativo" pra qualquer cartão,
  // ver bloco 2.6b).
  const linhaManual = p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone alternativo (cartório)' });
  check('cartão com valor tem botão de excluir', await linhaManual.locator('button[aria-label="Excluir número"]').count() === 1);
  await linhaManual.locator('button[aria-label="Excluir número"]').click();
  await p.waitForTimeout(200);
  const updRemocao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a2' && e.payload.telefone_alternativo === null));
  check('excluir telefone alternativo grava null', !!updRemocao, JSON.stringify(updRemocao));
  check('telefone alternativo excluído some da lista', !/Telefone alternativo \(cartório\)/.test(await p.locator('#modal-body').textContent()));

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

// ── 2.815 "✅ Concluir substituição" (31/08/2026, achado real: FRANCISCO LUIZ
// NETO estava dispensado e substituído por Sanndra havia dias, mas ficou
// preso em "precisa substituir" pra sempre — não existia nenhum jeito do
// cartório fechar uma substituição já resolvida por fora do WhatsApp).
// Diferente de "🔁 Substituir" (só marca/desmarca o item de trabalho em
// aberto), este é o DESFECHO: confirmacao='substituido' + ativo=false, a
// pessoa sai da fila ativa. ──
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

  await p.fill('#modal-body input#mm-substituto-nome', 'Sanndra Conceição Soares');
  await p.locator('#modal-body input#mm-substituto-nome').press('Tab');
  await p.waitForTimeout(150);

  const botaoConcluir = p.locator('#modal-body button:has-text("Concluir substituição")');
  check('botão "Concluir substituição" aparece no modal enquanto a flag está marcada', await botaoConcluir.count() === 1);

  await botaoConcluir.click();
  await p.waitForTimeout(200);

  const updFinal = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.confirmacao === 'substituido'));
  check('conclui grava confirmacao=substituido + ativo=false + precisa_substituir=false, tudo de uma vez', !!updFinal && updFinal.payload.ativo === false && updFinal.payload.precisa_substituir === false, JSON.stringify(updFinal));

  const logFinal = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_substituicao_concluida'));
  check('grava log mesario_substituicao_concluida com o nome do substituto', logFinal?.payload?.payload?.substituto_nome === 'Sanndra Conceição Soares', JSON.stringify(logFinal));

  check('modal fecha sozinho', await p.locator('#overlay.open').count() === 0);
  await p.waitForTimeout(150);
  check('pessoa some da lista (ativo=false, cmCarregar só lista ativo=true)', await p.locator('.import-card:has-text("ANA PRESIDENTE")').count() === 0);

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
  // registrar "sabemos que foi notificado, só não confirmou ainda".
  await btnConvocadoModal.click();
  await p.waitForTimeout(250);
  const updConvocado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a3' && e.payload.confirmacao === 'convocado'));
  check('"Convocado" grava confirmacao=convocado e limpa data_confirmacao', !!updConvocado && updConvocado.payload.data_confirmacao === null, JSON.stringify(updConvocado));
  check('botão "Convocado" fica destacado depois de clicar, "Confirmado" perde o destaque', (await btnConvocadoModal.getAttribute('class') || '').includes('btn-dark') && !(await btnConfirmadoModal.getAttribute('class') || '').includes('btn-dark'));
  check('grava log de auditoria "mesario_marcado_convocado"', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_marcado_convocado' && e.payload.payload.ator_id === 'a3')));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.855 Botão "Convocado" é um clique só, sem caixinha separada
// (28/08/2026 originalmente, revisado no mesmo dia — o gate por checkbox
// separada foi reportado como duplicação confusa: "a função de confirmar a
// convocação ficou duplicado, uma seleção e um botão". Corrigido fundindo os
// dois — clicar em "Convocado" já é, por si só, a confirmação manual do
// cartório de que a carta/mensagem chegou, mesmo padrão que "Confirmado" já
// usava desde antes) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(150);

  check('não existe mais caixinha separada "recebeu a convocação" no modal', await p.locator('#modal-body input[type="checkbox"]').count() === 0);

  // ANA começa sem convocacao_recebida (fixture padrão) — um único clique em
  // "Convocado" já grava os dois fatos juntos, sem passo intermediário.
  await p.locator('#modal-body button:has-text("📋 Convocado")').click();
  await p.waitForTimeout(200);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.confirmacao === 'convocado'));
  check('um clique só grava confirmacao=convocado', !!upd, JSON.stringify(upd));
  check('e já grava convocacao_recebida=true (+ ts) junto, no mesmo update', !!upd && upd.payload.convocacao_recebida === true && !!upd.payload.convocacao_recebida_ts, JSON.stringify(upd));
  check('nenhum update separado só de convocacao_recebida (não existe mais 2 passos)', (await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1').length)) === 1);

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

// ── 2.6 Contatar mesários: indicar/filtrar quem não tem WhatsApp
// (01/09/2026, pedido direto: "estou com uma dificildade de identificar os
// mesário que não tem whatsapp... verifique uma forma de indicar se o
// numero é ou não whatsapp e como filtrar isso"). Redesenhado no mesmo dia,
// por NÚMERO em vez de por pessoa (pedido direto: "o marcar sem whatsapp
// deve vir junto ao numero tipo um x no canto para excluir o numero caso
// não seja numero da pessoa e do outro lado, sem whatsapp") — ver bloco
// 2.6b pros dois botões de canto do cartãozinho. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push(
    // GERALDO: número em FORMATO DE FIXO (DDD+8, sem o 9º dígito) — sinal
    // automático, não precisa de nenhuma flag marcada.
    { id:'a40', nome_completo:'GERALDO TELEFONE FIXO', telefone_whatsapp:'558632220000', funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', telefones_sem_whatsapp:[] },
    // IRACEMA: número em formato de CELULAR normal, mas o cartório já sabe
    // por fora que não tem WhatsApp — o dígito dela já está marcado.
    { id:'a41', nome_completo:'IRACEMA SEM WHATSAPP MANUAL', telefone_whatsapp:'5586988887766', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', telefones_sem_whatsapp:['86988887766'] },
  );

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  const cardGeraldo = await p.locator('.import-card:has-text("GERALDO TELEFONE FIXO")').first().textContent();
  check('número em formato de fixo mostra o badge "Principal sem WhatsApp"', /Principal sem WhatsApp/.test(cardGeraldo), cardGeraldo.replace(/\s+/g, ' '));
  const cardIracema = await p.locator('.import-card:has-text("IRACEMA SEM WHATSAPP MANUAL")').first().textContent();
  check('quem tem o principal marcado manualmente também mostra o badge', /Principal sem WhatsApp/.test(cardIracema), cardIracema.replace(/\s+/g, ' '));

  const cardAna = await p.locator('.import-card:has-text("ANA PRESIDENTE")').first().textContent();
  check('número em formato de celular normal, sem marcação manual, não mostra o badge', !/Principal sem WhatsApp/.test(cardAna), cardAna.replace(/\s+/g, ' '));

  // Filtro "📵 Sem WhatsApp" — combina os dois sinais (automático + manual),
  // sempre sobre o telefone PRINCIPAL (é o que Hermes/campanha usam).
  await p.selectOption('#cm-filtro', 'sem_whatsapp');
  await p.waitForTimeout(200);
  const listaFiltrada = await p.locator('.cm-lista-pessoas').textContent();
  check('filtro "Sem WhatsApp" mostra GERALDO (automático) e IRACEMA (manual)', /GERALDO TELEFONE FIXO/.test(listaFiltrada) && /IRACEMA SEM WHATSAPP MANUAL/.test(listaFiltrada), listaFiltrada.replace(/\s+/g, ' ').slice(0, 400));
  check('filtro "Sem WhatsApp" esconde quem tem número de celular normal (ANA)', !/ANA PRESIDENTE/.test(listaFiltrada));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.6b Cartãozinho de telefone: ✕ excluir + 📵 marcar sem WhatsApp, por
// NÚMERO (01/09/2026, pedido direto, olhando o cartão no modal: "o marcar
// sem whatsapp deve vir junto ao numero tipo um x no canto para excluir o
// numero caso não seja numero da pessoa e do outro lado, sem whatsapp").
// Cada cartão de "Todos os telefones conhecidos" ganha os dois cantos —
// substituiu o botão avulso "📵 Sem WhatsApp" que existia solto no topo do
// modal (ver bloco 2.6). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  // BRUNO (a2) tem principal + telefone do TRE (Telefone 1 (eleitor)) na
  // fixture padrão (mesmo par usado no bloco "cartãozinho" mais acima).
  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  const cartaoPrincipal = p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' });
  check('cartão do principal já nasce com os dois botões de canto (✕ e 📵)', await cartaoPrincipal.locator('button[aria-label="Excluir número"]').count() === 1 && await cartaoPrincipal.locator('button[aria-label="Marcar sem WhatsApp"]').count() === 1);
  const cartaoTre = p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' });
  check('cartão de número do TRE (só leitura) também ganha os dois botões', await cartaoTre.locator('button[aria-label="Excluir número"]').count() === 1 && await cartaoTre.locator('button[aria-label="Marcar sem WhatsApp"]').count() === 1);

  // Marca o número do TRE como "não é WhatsApp".
  await cartaoTre.locator('button[aria-label="Marcar sem WhatsApp"]').click();
  await p.waitForTimeout(200);
  const atorMarcado = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('marcar grava o dígito em telefones_sem_whatsapp', (atorMarcado.telefones_sem_whatsapp || []).includes('86977778888'), JSON.stringify(atorMarcado.telefones_sem_whatsapp));
  const logMarcado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_telefone_sem_whatsapp' && e.payload.payload?.ator_id === 'a2'));
  check('grava log mesario_telefone_sem_whatsapp', !!logMarcado && logMarcado.payload.payload.sem_whatsapp === true, JSON.stringify(logMarcado));
  const textoDepoisMarcar = await p.locator('#modal-body').textContent();
  check('cartão marcado mostra a legenda "Não é WhatsApp"', /Não é WhatsApp/.test(textoDepoisMarcar), textoDepoisMarcar.replace(/\s+/g, ' ').slice(0, 500));
  check('cartão marcado não tem mais botão de copiar link (💬 vira só texto opaco)', await p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' }).locator('button[aria-label*="Copiar link do WhatsApp"]').count() === 0);

  // Desmarca de novo.
  await p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' }).locator('button[aria-label="Marcar sem WhatsApp"]').click();
  await p.waitForTimeout(200);
  const atorDesmarcado = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('desmarcar tira o dígito de telefones_sem_whatsapp', !(atorDesmarcado.telefones_sem_whatsapp || []).includes('86977778888'), JSON.stringify(atorDesmarcado.telefones_sem_whatsapp));
  check('copiar link volta a aparecer depois de desmarcar', await p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' }).locator('button[aria-label*="Copiar link do WhatsApp"]').count() === 1);

  // Excluir o número do TRE (não confundir com "sem WhatsApp" — é "não é o
  // número desta pessoa"). Não dá pra apagar de sime_mesarios_raw (só
  // leitura), então vira um "ignorado" pra ESTA pessoa.
  await p.locator('#modal-body .cm-tel-card', { hasText: 'Telefone 1 (eleitor)' }).locator('button[aria-label="Excluir número"]').click();
  await p.waitForTimeout(250);
  const atorExcluido = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('excluir número do TRE grava o dígito em telefones_ignorados (não mexe no staging)', (atorExcluido.telefones_ignorados || []).includes('86977778888'), JSON.stringify(atorExcluido.telefones_ignorados));
  const logIgnorado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_telefone_ignorado' && e.payload.payload?.ator_id === 'a2'));
  check('grava log mesario_telefone_ignorado', !!logIgnorado, JSON.stringify(logIgnorado));
  const textoDepoisExcluir = await p.locator('#modal-body').textContent();
  check('número excluído some da lista de telefones', !/Telefone 1 \(eleitor\)/.test(textoDepoisExcluir), textoDepoisExcluir.replace(/\s+/g, ' ').slice(0, 500));

  // Excluir o PRINCIPAL limpa telefone_whatsapp direto (campo próprio do
  // SIME, ao contrário do número do TRE acima).
  await p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' }).locator('button[aria-label="Excluir número"]').click();
  await p.waitForTimeout(250);
  const atorSemPrincipal = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('excluir o principal limpa telefone_whatsapp (não vira "ignorado")', atorSemPrincipal.telefone_whatsapp === null, JSON.stringify(atorSemPrincipal.telefone_whatsapp));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.6c Cartãozinho de telefone: 3º botão de canto — ✅ confirmar número
// (01/09/2026, pedido direto: "alem de sem whastapp poderia haver um botão
// para numero confirmado"). Diferente de sime_atores.confirmacao (a PESSOA
// confirmando participação), este é sobre o NÚMERO — o cartório verificou
// por fora que é mesmo dela. Não é mutuamente exclusivo com "sem
// WhatsApp". ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("BRUNO MESARIO")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  const cartaoPrincipal = p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' });
  check('cartão já nasce com o 3º botão de canto (✅ confirmar)', await cartaoPrincipal.locator('button[aria-label="Confirmar número"]').count() === 1);

  await cartaoPrincipal.locator('button[aria-label="Confirmar número"]').click();
  await p.waitForTimeout(200);
  const atorConfirmado = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('confirmar grava o dígito em telefones_confirmados', (atorConfirmado.telefones_confirmados || []).includes('86999990002'), JSON.stringify(atorConfirmado.telefones_confirmados));
  const logConfirmado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_telefone_confirmado' && e.payload.payload?.ator_id === 'a2'));
  check('grava log mesario_telefone_confirmado', !!logConfirmado && logConfirmado.payload.payload.confirmado === true, JSON.stringify(logConfirmado));
  const textoConfirmado = await p.locator('#modal-body').textContent();
  check('cartão confirmado mostra a legenda "✅ Confirmado"', /✅ Confirmado/.test(textoConfirmado), textoConfirmado.replace(/\s+/g, ' ').slice(0, 500));

  // Marcar "sem WhatsApp" no MESMO cartão não desfaz a confirmação — os
  // dois eixos são independentes (um fixo pode ser confirmado como dela e
  // ainda assim não ter WhatsApp).
  await p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' }).locator('button[aria-label="Marcar sem WhatsApp"]').click();
  await p.waitForTimeout(200);
  const atorDois = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('marcar sem WhatsApp não desfaz a confirmação do número', (atorDois.telefones_confirmados || []).includes('86999990002') && (atorDois.telefones_sem_whatsapp || []).includes('86999990002'), JSON.stringify({ confirmados: atorDois.telefones_confirmados, sem_whatsapp: atorDois.telefones_sem_whatsapp }));

  // Desfazer a confirmação.
  await p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' }).locator('button[aria-label="Confirmar número"]').click();
  await p.waitForTimeout(200);
  const atorDesconfirmado = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a2'));
  check('desfazer a confirmação tira o dígito de telefones_confirmados', !(atorDesconfirmado.telefones_confirmados || []).includes('86999990002'), JSON.stringify(atorDesconfirmado.telefones_confirmados));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.6d Cartãozinho de telefone: número do TRE sem DDD não vira cartão
// duplicado do principal (01/09/2026, achado real: WANESSA ALVES DE SOUZA
// — "mesmo o contato vindo do elo verificamos que não é dela (86)
// 99471-9268, deveria poder excluir o contato, faltou limpar o modal com
// as informações"). Investigado: telefone_2_eleitor dela no TRE era
// "994719268" (sem o DDD 86) — o mesmo número do telefone_whatsapp
// principal, só que sem os dois primeiros dígitos. cmListaTelefones()
// deduplicava só por string de dígitos crua, então "994719268" nunca batia
// com "86994719268" (do principal) e virava um SEGUNDO cartão pro MESMO
// número — excluir esse cartão (só leitura, foi pra telefones_ignorados)
// não tinha efeito nenhum visível, porque o principal continuava mostrando
// o mesmo número intocado. Corrigido normalizando os dois lados pelo
// mesmo normalizarTelefoneWhatsapp() usado em todo import (assume DDD 86
// pra número de 9 dígitos soltos) ANTES de comparar — 331 pessoas na 7ª
// Zona tinham esse mesmo padrão no TRE, não era só ela. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push(
    { id:'a45', nome_completo:'WANESSA TESTE SEM DDD', telefone_whatsapp:'5586994719268', funcao:'coord_acessibilidade', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', inscricao_eleitoral:'099999998888' },
  );
  m.sime_mesarios_raw.push(
    // Mesmo número do principal (86994719268), só que sem o DDD — exatamente
    // como o TRE mandou pra WANESSA de verdade.
    { id:'raw45', inscricao:'099999998888', telefone_pessoal_mesario:'', telefone_1_eleitor:'', telefone_2_eleitor:'994719268', telefone_contato_eleitor:'', telefone_comercial_mesario:'', importado_em:'2026-08-20T09:00:00.000Z' },
  );

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("WANESSA TESTE SEM DDD")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(300);

  check('só aparece 1 cartão pro número (o do TRE sem DDD não vira duplicata)', await p.locator('#modal-body .cm-tel-card').count() === 1);
  check('não sobra nenhum vestígio de "Telefone 2 (eleitor)" — foi deduplicado, não excluído', await p.locator('#modal-body').locator('text=Telefone 2 (eleitor)').count() === 0);

  // Agora que só existe 1 cartão (o principal), excluí-lo de fato limpa o
  // número — o cenário real que a WANESSA esperava.
  await p.locator('#modal-body .cm-tel-card', { hasText: 'WhatsApp (principal)' }).locator('button[aria-label="Excluir número"]').click();
  await p.waitForTimeout(250);
  const atorExcluido = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a45'));
  check('excluir o único cartão restante realmente limpa telefone_whatsapp', atorExcluido.telefone_whatsapp === null, JSON.stringify(atorExcluido.telefone_whatsapp));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.7 Botão "🚫 Dispensar (ELO)" (01/09/2026, achado real: ANA ALICE DOS
// SANTOS DA SILVA tinha um carimbo manual em observação dizendo "Marcado
// ativo=false" — escrito à mão, via SQL Editor — mas voltou a aparecer ativa
// depois de um resync porque não existia flag nenhuma protegendo a marcação.
// Até este pedido, o único jeito de dispensar alguém era pelo SQL Editor;
// pedido direto: "deve haver um botao para indicar que ela foi dispensada e
// tirar ela do cadastro"). Mesmo efeito final que a correção manual sempre
// fez (ativo=false + dispensado_manual=true), só que pelo botão. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push(
    // OLIVIA: vai ser dispensada. PATRICIA: já ocupa o MESMO cargo/seção
    // (caso comum de substituição já processada pelo TRE — cada uma é um
    // sime_atores independente) e deve continuar intocada depois.
    { id:'a50', nome_completo:'OLIVIA DISPENSADA', telefone_whatsapp:'5586999995050', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', dispensado_manual:false },
    { id:'a51', nome_completo:'PATRICIA SUBSTITUTA', telefone_whatsapp:'5586999995051', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s3', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, meio_contato:'whatsapp', dispensado_manual:false },
  );

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-contatar-btn');
  await p.waitForTimeout(300);

  await p.locator('.import-card:has-text("OLIVIA DISPENSADA")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);

  check('seção "Dispensar (ELO)" começa recolhida (colapsável por padrão)', await p.locator('#mm-dispensar-motivo').count() === 0);
  await p.locator('.m-section-hdr:has-text("Dispensar (ELO)")').click();
  await p.waitForTimeout(150);

  const botaoDispensar = p.locator('#modal-body button:has-text("Dispensar e tirar do cadastro")');
  check('clicar no cabeçalho expande a seção e mostra o botão "Dispensar"', await botaoDispensar.count() === 1);

  await p.fill('#modal-body #mm-dispensar-motivo', 'Recusa formal registrada no ELO em 07/08/2026');
  await botaoDispensar.click();
  await p.waitForTimeout(250);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a50' && e.payload.dispensado_manual === true));
  check('grava ativo=false + dispensado_manual=true', !!upd && upd.payload.ativo === false, JSON.stringify(upd));

  const atorOlivia = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a50'));
  check('observação recebe o carimbo "Dispensado(a) — <motivo>" com o motivo digitado', /Dispensado\(a\) — Recusa formal registrada no ELO em 07\/08\/2026/.test(atorOlivia.observacao || ''), atorOlivia.observacao);

  const log = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_dispensado_manual' && e.payload.payload?.ator_id === 'a50'));
  check('grava log mesario_dispensado_manual com o motivo', log?.payload?.payload?.motivo === 'Recusa formal registrada no ELO em 07/08/2026', JSON.stringify(log));

  check('modal fecha sozinho', await p.locator('#overlay.open').count() === 0);
  await p.waitForTimeout(150);
  check('OLIVIA some da lista (ativo=false, cmCarregar só lista ativo=true)', await p.locator('.import-card:has-text("OLIVIA DISPENSADA")').count() === 0);

  const atorPatricia = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a51'));
  check('quem já ocupava o mesmo cargo/seção continua intocada (ativo=true, dispensado_manual=false)', atorPatricia.ativo === true && atorPatricia.dispensado_manual === false, JSON.stringify(atorPatricia));
  check('PATRICIA continua aparecendo na lista', await p.locator('.import-card:has-text("PATRICIA SUBSTITUTA")').count() === 1);

  // Motivo é opcional — não bloqueia a ação (filosofia "nunca bloquear por
  // campos opcionais").
  await p.locator('.import-card:has-text("PATRICIA SUBSTITUTA")').first().locator('div[onclick*="cmAbrirModal"]').first().click();
  await p.waitForTimeout(200);
  await p.locator('#modal-body button:has-text("Dispensar e tirar do cadastro")').click();
  await p.waitForTimeout(250);
  const atorPatriciaDepois = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a51'));
  check('dispensar sem preencher motivo funciona normalmente', atorPatriciaDepois.ativo === false && atorPatriciaDepois.dispensado_manual === true);
  check('sem motivo, observação recebe o texto padrão "sem motivo informado"', /Dispensado\(a\) — sem motivo informado/.test(atorPatriciaDepois.observacao || ''), atorPatriciaDepois.observacao);

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

  // Etiqueta continua RETRATO mesmo depois do AR virar paisagem (31/08/2026)
  // — `page: co-ar-page` só é atribuído a `.co-pagina-ar`, nunca a
  // `.co-pagina-etiqueta`; sem regressão pro padrão do Enderecador de
  // Encomendas que a etiqueta segue.
  await p.emulateMedia({ media: 'print' });
  const etqPdf = await p.pdf({ printBackground: true });
  const etqBox = [...etqPdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  check('etiqueta continua A4 RETRATO (altura > largura) — só o AR virou paisagem', etqBox.length >= 1 && parseFloat(etqBox[0][4]) > parseFloat(etqBox[0][3]), etqBox[0] ? `${etqBox[0][3]}x${etqBox[0][4]}` : 'sem MediaBox');
  // emulateMedia('print') deixa a UI normal `display:none` (só #print-area
  // fica visível) — sem voltar pra 'screen' aqui, o próximo clique (no
  // botão AR de NUNO) trava esperando um elemento "invisível" pra sempre.
  await p.emulateMedia({ media: 'screen' });

  // Gera o AR de NUNO (botão individual).
  await p.locator('[data-ator-id="a21"] button:has-text("📄 AR")').click();
  await p.waitForTimeout(200);
  check('gerar AR chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 2);
  const printHtmlAr = await p.locator('#print-area').innerHTML();
  check('AR impresso tem o modelo de confirmação de recebimento, não uma etiqueta', /AVISO DE RECEBIMENTO/.test(printHtmlAr) && /NOME LEGÍVEL DO RECEBEDOR/.test(printHtmlAr) && /NUNO DADOS MESARIO/.test(printHtmlAr) && /Av\. Nova, 50/.test(printHtmlAr), printHtmlAr.slice(0, 600));
  check('AR segue o modelo oficial: tentativas de entrega, motivo de devolução, endereço de devolução', /TENTATIVAS DE ENTREGA/.test(printHtmlAr) && /MOTIVO DE DEVOLUÇÃO/.test(printHtmlAr) && /Não procurado/.test(printHtmlAr) && /ENDEREÇO PARA DEVOLUÇÃO DO AR/.test(printHtmlAr), printHtmlAr.slice(0, 800));
  check('AR nunca inventa código de rastreio — só reserva o espaço, texto idêntico ao PDF real do gerarAR.cfm oficial', /\(CÓDIGO DE BARRAS OU Nº DE REGISTRO DO OBJETO\)/.test(printHtmlAr));
  check('AR segue a mesma estrutura de célula única do modelo oficial: destinatário, código e devolução juntos (sem quebra de linha entre eles), pareados com UNIDADE DE POSTAGEM/CARIMBO empilhados à direita', /rowspan="2"/.test(printHtmlAr) && /UNIDADE DE POSTAGEM/.test(printHtmlAr) && /CARIMBO/.test(printHtmlAr));
  check('AR tem a 3ª coluna própria (RUBRICA E MATRÍCULA DO CARTEIRO), não misturada com motivo', /RUBRICA E MATRÍCULA DO/.test(printHtmlAr));
  check('AR tem caixinha NUMERADA de verdade no motivo de devolução (1 a 9), igual ao PDF real do gerarAR.cfm', /co-ar-check">1</.test(printHtmlAr) && /co-ar-check">9</.test(printHtmlAr));
  check('AR tem a coluna OBSERVAÇÃO própria (existe no formulário oficial de verdade) com "Carta de convocação"', /<b>OBSERVAÇÃO<\/b><br>Carta de convocação/.test(printHtmlAr));
  check('AR tem a faixa "(ÁREA DE COLA NO VERSO)" fora da tabela, igual ao modelo oficial', /ÁREA DE COLA NO VERSO/.test(printHtmlAr));
  check('grava log de AR impresso', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'correspondencia_ar_impresso')));

  // 31/08/2026, pedido direto "até o tamanho do ar ficou igual?" — o PDF
  // real do gerarAR.cfm oficial enviado é A4 PAISAGEM (tabela larga e
  // baixa, 552×371 no HTML de origem), não retrato. page.pdf() faz
  // paginação/orientação de verdade (ao contrário de innerHTML/screenshot),
  // então é o único jeito confiável de testar isso — via `page: co-ar-page`
  // (CSS Paged Media nomeado) o AR vira paisagem sem mexer na etiqueta
  // (que continua retrato, padrão do Enderecador de Encomendas).
  await p.emulateMedia({ media: 'print' });
  const arPdf = await p.pdf({ printBackground: true });
  // Sem lib de PDF no projeto — o MediaBox de cada página fica em texto
  // puro no PDF (não comprimido), então dá pra ler direto do buffer.
  const arPdfTxt = arPdf.toString('latin1');
  const mediaBoxes = [...arPdfTxt.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  check('AR real gerado em 1 página só (sem transbordar)', mediaBoxes.length === 1, String(mediaBoxes.length));
  const [, , , wStr, hStr] = mediaBoxes[0];
  check('AR real sai em A4 PAISAGEM (largura > altura), igual ao PDF do gerarAR.cfm oficial', parseFloat(wStr) > parseFloat(hStr), `${wStr}x${hStr}`);
  await p.emulateMedia({ media: 'screen' }); // mesmo motivo de cima — volta a UI a ficar clicável

  // Seleção em massa: marca DIEGO, imprime etiquetas selecionadas.
  await p.locator('[data-ator-id="a4"] input[type=checkbox]').check();
  await p.click('button:has-text("Imprimir etiquetas selecionadas (1)")');
  await p.waitForTimeout(200);
  check('imprimir em massa chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 3);

  // ── AR em lote (31/08/2026, pedido direto: "quero poder imprimir os ar
  // também") — antes só existia "Imprimir etiquetas selecionadas"; AR só
  // saía um de cada vez, pelo botão individual do card. coImprimir() já
  // aceitava lista de ids pra qualquer tipo — só faltava o botão. Marca
  // DIEGO (já selecionado acima) + NUNO e confirma que o lote gera as DUAS
  // páginas de AR, não só uma. ──
  await p.locator('[data-ator-id="a21"] input[type=checkbox]').check();
  await p.click('button:has-text("Imprimir AR selecionados (2)")');
  await p.waitForTimeout(200);
  check('imprimir AR em lote chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 4);
  const printHtmlArLote = await p.locator('#print-area').innerHTML();
  check('AR em lote gera uma página por pessoa selecionada (DIEGO e NUNO, não só uma)', /DIEGO CARTA/.test(printHtmlArLote) && /NUNO DADOS MESARIO/.test(printHtmlArLote), printHtmlArLote.slice(0, 200));
  check('AR em lote usa o modelo de AR, não a etiqueta', (printHtmlArLote.match(/AVISO DE RECEBIMENTO/g) || []).length === 2, printHtmlArLote.slice(0, 200));
  check('grava log de AR impresso em lote (quantidade=2)', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'correspondencia_ar_impresso' && e.payload.payload?.quantidade === 2)));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3.8 Oficial de Justiça — relação de controle interno pra convocação
// entregue em mão (31/08/2026, pedido direto: "ELABORE MAIS UMA ABA PARA O
// OFICIAL DE JUSTIÇA CONTROLE A CONVOCAÇÃO DOS MESÁRIOS") ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push(
    // PAULO: oficial_justica com endereço no ELO (cadastro de eleitor).
    { id:'a30', nome_completo:'PAULO OFICIAL', telefone_whatsapp:'', funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'oficial_justica', status_contato_alternativo:null, inscricao_eleitoral:'055555555555' },
    // QUITERIA: oficial_justica SEM nenhuma linha no ELO — "sem endereço".
    { id:'a31', nome_completo:'QUITERIA SEM ENDERECO', telefone_whatsapp:'', funcao:'coord_acessibilidade', secao_id:null, zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'oficial_justica', status_contato_alternativo:'a_enviar', inscricao_eleitoral:'066666666666' },
    // RAFAEL: WhatsApp, não oficial de justiça — não deve aparecer aqui.
    { id:'a32', nome_completo:'RAFAEL WHATSAPP', telefone_whatsapp:'5586999990032', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s3', zona_id:'z7', confirmacao:'pendente', ativo:true, observacao:null, meio_contato:'whatsapp', inscricao_eleitoral:'077000000000' },
    // SILVIA: oficial_justica mas JÁ confirmada — não precisa mais do
    // oficial, então não deve aparecer na lista (01/09/2026, pedido direto).
    { id:'a33', nome_completo:'SILVIA JA CONFIRMADA', telefone_whatsapp:'', funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s3', zona_id:'z7', confirmacao:'confirmado', ativo:true, observacao:null, meio_contato:'oficial_justica', inscricao_eleitoral:'088000000000' },
  );
  m.sime_mesarios_raw.push(
    { id:'raw30', inscricao:'055555555555', endereco_eleitor:'Rua do Oficial, 200', bairro_eleitor:'Centro', cep_eleitor:'64280200', nome_municipio_endereco_eleitor:'Campo Maior', uf_endereco_eleitor:'PI' },
  );

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-oficial-justica-btn');
  await p.waitForTimeout(300);

  let txt = await p.locator('.content').textContent();
  const txtFlat = txt.replace(/\s+/g, ' ');
  check('lista PAULO (oficial_justica, com endereço)', /PAULO OFICIAL/.test(txt), txtFlat.slice(0, 500));
  check('não lista RAFAEL (meio de contato é WhatsApp, não oficial de justiça)', !/RAFAEL WHATSAPP/.test(txt));
  check('QUITERIA (sem linha no ELO) cai na lista "sem endereço", à parte', /Sem endereço no ELO/.test(txt) && /QUITERIA SEM ENDERECO/.test(txt), txtFlat.slice(0, 800));
  check('endereço de PAULO vem do ELO (cadastro de eleitor)', /Rua do Oficial, 200/.test(txt), txtFlat.slice(0, 800));
  check('resumo de status (mesmo vocabulário de Carta Registrada: A enviar/Enviado/Entregue/Devolvido)', /A enviar:/.test(txt) && /Enviado:/.test(txt) && /Entregue:/.test(txt) && /Devolvido:/.test(txt), txtFlat.slice(0, 400));
  check('não lista SILVIA (já confirmada — não precisa mais do oficial)', !/SILVIA JA CONFIRMADA/.test(txt));
  check('nota de transparência: 1 já confirmado saiu da lista sozinho', /1 já confirmado\(s\) — saíram desta lista automaticamente/.test(txtFlat), txtFlat.slice(0, 500));

  // Troca o status de PAULO pelo <select> do card — mesma ação de log que o
  // modal de "Contatar mesários" já usa (mesario_status_contato_alt), pra
  // aparecer certinho na timeline de Atualizações da pessoa lá.
  await p.locator('[data-ator-id="a30"] select').selectOption('enviado');
  await p.waitForTimeout(200);
  const atorPaulo = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a30'));
  check('status gravado em sime_atores.status_contato_alternativo', atorPaulo.status_contato_alternativo === 'enviado', JSON.stringify(atorPaulo));
  const logStatus = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_status_contato_alt' && e.payload.payload?.ator_id === 'a30'));
  check('grava log mesario_status_contato_alt (mesma ação do modal de Contatar mesários)', !!logStatus && logStatus.payload.payload.status === 'enviado', JSON.stringify(logStatus));
  check('"enviado" NÃO marca convocado sozinho — só "entregue" faz isso', atorPaulo.confirmacao === 'pendente');

  // "Entregue" pelo oficial marca convocado sozinho (01/09/2026, pedido
  // direto: "quando marcar entregue pelo oficial ja marca como convocado")
  // — testado com QUITERIA (ainda intocada, confirmacao='pendente').
  await p.locator('[data-ator-id="a31"] select').selectOption('entregue');
  await p.waitForTimeout(200);
  let atorQuiteria = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a31'));
  check('"entregue" marca confirmacao=convocado + convocacao_recebida=true', atorQuiteria.confirmacao === 'convocado' && atorQuiteria.convocacao_recebida === true, JSON.stringify(atorQuiteria));
  check('toast avisa que marcou como convocado', (await p.textContent('#toast')).includes('convocado'));
  check('grava log mesario_marcado_convocado (mesma ação de "Convocado" em Contatar mesários)', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_marcado_convocado' && e.payload.payload?.ator_id === 'a31')));

  // Marcar "entregue" de novo (já convocado) não regride nem duplica o log —
  // guarda contra reaplicar o mesmo efeito colateral à toa.
  const qtdLogsConvocadoAntes = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_marcado_convocado' && e.payload.payload?.ator_id === 'a31').length);
  await p.locator('[data-ator-id="a31"] select').selectOption('a_enviar');
  await p.waitForTimeout(150);
  await p.locator('[data-ator-id="a31"] select').selectOption('entregue');
  await p.waitForTimeout(200);
  const qtdLogsConvocadoDepois = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_marcado_convocado' && e.payload.payload?.ator_id === 'a31').length);
  check('marcar "entregue" de novo (já convocado) não duplica o log de convocado', qtdLogsConvocadoDepois === qtdLogsConvocadoAntes, `antes=${qtdLogsConvocadoAntes} depois=${qtdLogsConvocadoDepois}`);
  atorQuiteria = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'a31'));
  check('continua convocado (não regrediu)', atorQuiteria.confirmacao === 'convocado');

  // Imprime a relação de PAULO (botão individual).
  await p.locator('[data-ator-id="a30"] button:has-text("🖨️ Relação")').click();
  await p.waitForTimeout(200);
  check('imprimir relação chama window.print()', await p.evaluate(() => window.__printCalls) === 1);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('relação impressa mostra o nome e o endereço do destinatário', /PAULO OFICIAL/.test(printHtml) && /Rua do Oficial, 200/.test(printHtml), printHtml.slice(0, 600));
  check('relação tem título e rótulo de controle interno (não finge ser mandado oficial)', /Relação para Convocação via Oficial de Justiça/.test(printHtml) && /não substitui o mandado/.test(printHtml), printHtml.slice(0, 800));
  check('relação tem colunas de assinatura e data pro cumprimento', /Assinatura \/ recebimento/.test(printHtml) && /<th>Data<\/th>/.test(printHtml));
  check('grava log de relação impressa (quantidade=1)', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'oficial_justica_relacao_impressa' && e.payload.payload?.quantidade === 1)));

  // Seleção em massa: marca PAULO + QUITERIA, imprime relação selecionados.
  await p.locator('[data-ator-id="a30"] input[type=checkbox]').check();
  await p.locator('[data-ator-id="a31"] input[type=checkbox]').check();
  await p.click('button:has-text("Imprimir relação selecionados (2)")');
  await p.waitForTimeout(200);
  check('imprimir relação em lote chama window.print() de novo', await p.evaluate(() => window.__printCalls) === 2);
  const printHtmlLote = await p.locator('#print-area').innerHTML();
  check('relação em lote traz as duas pessoas selecionadas (PAULO e QUITERIA)', /PAULO OFICIAL/.test(printHtmlLote) && /QUITERIA SEM ENDERECO/.test(printHtmlLote), printHtmlLote.slice(0, 300));
  check('quem está sem endereço no ELO ainda entra na relação (marcado à parte, não some da lista)', /Sem endereço no ELO/.test(printHtmlLote));
  check('grava log de relação impressa em lote (quantidade=2)', await p.evaluate(() => window.__mock.escritas.some(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'oficial_justica_relacao_impressa' && e.payload.payload?.quantidade === 2)));

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
