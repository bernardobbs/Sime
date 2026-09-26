// Testa a aba "🍽️ Auxílio Alimentação" de SIME_convocacao.html
// (18/09/2026, pedido direto: modelo de relatório pra imprimir o recibo de
// auxílio alimentação — um por mesa receptora, um para cada coordenador de
// acessibilidade, um geral para os auxiliares de eleição (sábado e
// domingo, separados) e um para a junta eleitoral, sempre com espaço em
// branco pra substituições de última hora).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(_cols, opts){ if(opts && opts.count) this._count=true; return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  insert(p){
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ...row }));
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    if(!window.__mock[this.t]) window.__mock[this.t]=[];
    window.__mock[this.t].push(...linhas);
    return Promise.resolve({ error:null, data:linhas });
  }
  _casa(x){
    return Object.entries(this.f).every(([k,v]) => {
      if(k.startsWith('__in_')) return v.includes(x[k.slice(5)]);
      return x[k]===v;
    });
  }
  then(res, rej){
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
  const ler = () => { try { return JSON.parse(localStorage.getItem('_mock_session')||'null'); } catch(e){ return null; } };
  return {
    from(t){ return new QB(t); },
    rpc(name, params){
      window.__mock.rpcChamadas = window.__mock.rpcChamadas || [];
      window.__mock.rpcChamadas.push({ name, params });
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-18T15:30:00.000Z', error:null });
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

function mock(opts = {}) {
  const secoes = [
    { id: 's1', numero: 5, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'z7' },
    { id: 's2', numero: 12, local_nome: 'Escola B', municipio: 'Jatobá do Piauí', zona_id: 'z7' },
    // Seção 63 — mesa COMPLETA (4 cargos, o pior caso real, nunca há um 5º)
    // com nomes longos, pra testar "cabe estritamente em uma folha".
    { id: 's3', numero: 63, local_nome: 'Escola Municipal Grande do Centro', municipio: 'Campo Maior', zona_id: 'z7' },
  ];
  const atores = [
    { id: 'm1', nome_completo: 'PRESIDENTE MARIA', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's1', inscricao_eleitoral: '111111111111', zona_id: 'z7', ativo: true },
    { id: 'm2', nome_completo: 'MESARIO 1 JOAO', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: 's1', inscricao_eleitoral: '222222222222', zona_id: 'z7', ativo: true },
    { id: 'm3', nome_completo: 'MESARIO 2 ANA', funcao: 'mesario', funcao_mesa: '2º Mesário', secao_id: 's2', inscricao_eleitoral: '333333333333', zona_id: 'z7', ativo: true },
    { id: 'm4', nome_completo: 'MESARIO INATIVO NUNCA APARECE', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's2', inscricao_eleitoral: '999999999999', zona_id: 'z7', ativo: false },
    { id: 'm5', nome_completo: 'PRESIDENTE MARIA DA SILVA SANTOS SOUSA OLIVEIRA', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's3', inscricao_eleitoral: '101010101010', zona_id: 'z7', ativo: true },
    { id: 'm6', nome_completo: 'JOAO PEDRO OLIVEIRA DOS SANTOS FILHO NASCIMENTO', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: 's3', inscricao_eleitoral: '202020202020', zona_id: 'z7', ativo: true },
    { id: 'm7', nome_completo: 'ANA CAROLINA FERREIRA LIMA BARBOSA PEREIRA', funcao: 'mesario', funcao_mesa: '2º Mesário', secao_id: 's3', inscricao_eleitoral: '303030303030', zona_id: 'z7', ativo: true },
    { id: 'm8', nome_completo: 'FRANCISCO DAS CHAGAS RODRIGUES ALVES MENDES', funcao: 'mesario', funcao_mesa: '1º Secretário', secao_id: 's3', inscricao_eleitoral: '404040404040', zona_id: 'z7', ativo: true },
    { id: 'c1', nome_completo: 'COORDENADORA BEATRIZ', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's1', inscricao_eleitoral: '444444444444', zona_id: 'z7', ativo: true },
    { id: 'c2', nome_completo: 'COORDENADOR CARLOS SEM LOCAL', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '555555555555', zona_id: 'z7', ativo: true },
    { id: 'a1', nome_completo: 'AUXILIAR PEDRO', funcao: 'auxiliar_eleicao', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '666666666666', zona_id: 'z7', ativo: true },
    { id: 'a2', nome_completo: 'AUXILIAR LUCIA', funcao: 'auxiliar_eleicao', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '777777777777', zona_id: 'z7', ativo: true },
    { id: 'j1', nome_completo: 'JUNTA FERNANDO', funcao: 'junta_eleitoral', funcao_mesa: 'Membro', secao_id: null, inscricao_eleitoral: '888888888888', zona_id: 'z7', ativo: true },
    { id: 'j2', nome_completo: 'CARLOS MARCELLO SALES CAMPOS', funcao: 'junta_eleitoral', funcao_mesa: 'Presidente', secao_id: null, inscricao_eleitoral: '999888777666', zona_id: 'z7', ativo: true },
  ];
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, data_d: '2026-10-04', ativa: true, nome: 'Eleições Municipais 2026' }],
    sime_secoes: secoes,
    sime_atores: opts.semJunta ? atores.filter(a => a.funcao !== 'junta_eleitoral') : atores,
  };
}

async function abrir(ctx, m, path = 'SIME_convocacao.html') {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  // window.print() abriria um diálogo real do navegador — mesmo padrão já
  // usado em tests/test_rotas.mjs pra qualquer tela com impressão sem popup.
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

// ── 1. Contagens dos 4 grupos + defaults de valor/forma ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  const txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('mesa receptora conta 7 (mesarios ativos, o inativo nunca entra)', /Mesa Receptora \(7\)/.test(txt), txt.slice(0, 400));
  check('coordenadores conta 2', /Coordenador de Acessibilidade \(2\)/.test(txt), txt.slice(0, 400));
  check('auxiliares conta 2', /Auxiliares de Eleição \(2\)/.test(txt), txt.slice(0, 400));
  check('junta conta 1', /Junta Eleitoral \(1\)/.test(txt), txt.slice(0, 400));
  check('valor default 65,00', await p.locator('#ra-valor').inputValue() === '65.00');
  check('forma default DINHEIRO', await p.locator('#ra-forma').inputValue() === 'DINHEIRO');

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Salvar valor/forma grava em sime_eleicoes ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.fill('#ra-valor', '70,50');
  await p.fill('#ra-forma', 'pix');
  await p.click('button:has-text("💾 Salvar")');
  await p.waitForTimeout(300);

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const upd = escritas.find(e => e.op === 'update' && e.tabela === 'sime_eleicoes');
  check('grava valor 70.5 e forma PIX (maiúsculo) em sime_eleicoes', !!upd && upd.payload.valor_auxilio_alimentacao === 70.5 && upd.payload.forma_auxilio_alimentacao === 'PIX', JSON.stringify(upd));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Imprimir recibos — Mesa Receptora: UMA PÁGINA POR SEÇÃO (não por
//      local), com timbre institucional, ordem de cargo, "Seção Origem"
//      nas substituições, OBS + Total pago/Suprido, log de auditoria ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Mesa Receptora")');
  await p.waitForTimeout(300);

  check('window.print() foi chamado', await p.evaluate(() => window.__printCalls) === 1);
  const paginas = await p.locator('#print-area .ra-pagina').count();
  check('uma página por SEÇÃO (3 seções, não 1 página agrupando por local)', paginas === 3, String(paginas));
  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('timbre institucional com a logo da campanha (não a marca SIME) + órgão/zona', /assets\/logo_eleicoes2026\.png/.test(html) && /7ª Zona Eleitoral — Campo Maior/.test(txt), txt.slice(0, 300));
  check('linha "Eleição:" mostra Eleições Gerais 2026 - 1º turno com a data', /Eleição:\s*Eleições Gerais de 2026 - 1º turno \(04\/10\/2026\)/.test(txt), txt.slice(0, 300));
  check('mostra as três seções no cabeçalho (Seção: 5, 12 e 63)', /Seção: 5\b/.test(txt) && /Seção: 12\b/.test(txt) && /Seção: 63\b/.test(txt), txt.slice(0, 400));
  check('mostra os locais (Escola A, Escola B e a mesa completa da 63)', /Escola A/.test(txt) && /Escola B/.test(txt) && /Escola Municipal Grande do Centro/.test(txt), txt.slice(0, 500));
  check('mostra nome/inscrição dos mesários ativos', /111111111111.*PRESIDENTE MARIA/.test(txt) && /MESARIO 1 JOAO/.test(txt) && /333333333333.*MESARIO 2 ANA/.test(txt), txt.slice(0, 800));
  check('mesário inativo nunca aparece no recibo', !/MESARIO INATIVO/.test(txt));
  check('Presidente vem antes de 1º Mesário na mesma mesa (ordem de cargo)', txt.indexOf('PRESIDENTE MARIA') < txt.indexOf('MESARIO 1 JOAO'));
  check('bloco de SUBSTITUIÇÕES presente', /SUBSTITUIÇÕES \(preencher com letra de forma\)/.test(txt));
  check('coluna "Seção Origem" nas substituições (documento é por seção)', /Seção\s*Origem/.test(txt));
  check('linha "OBS:" presente', /OBS:/.test(txt));
  check('rodapé Total pago / Local / Data / Suprido presente', /Total pago/.test(txt) && /Suprido \(carimbo e assinatura\)/.test(txt));
  check('nenhuma menção a "SIME" no documento impresso (é o documento entregue às seções)', !/SIME/.test(txt), txt.slice(0, 400));
  check('mostra forma/valor do auxílio (default)', /DINHEIRO/.test(txt) && /R\$ 65,00/.test(txt));

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const logMesa = escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'recibo_alimentacao_mesa_impresso');
  check('log de auditoria gravado com quantidade certa', !!logMesa && logMesa.payload.payload.quantidade === 7, JSON.stringify(logMesa));

  // Paisagem (18/09/2026) — verificado com page.pdf() de verdade, não só
  // innerHTML/screenshot, mesmo critério já usado pro AR de Correspondência.
  await p.emulateMedia({ media: 'print' });
  const raPdf = await p.pdf({ printBackground: true });
  const raPdfTxt = raPdf.toString('latin1');
  const mediaBoxes = [...raPdfTxt.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  // "Cada recibo de seção deve caber estritamente em uma folha" (18/09/2026,
  // pedido direto) — a Seção 63 (s3) tem mesa COMPLETA (4 cargos, o pior
  // caso real) com nomes longos; se qualquer página lógica transbordasse
  // pra uma 2ª página física, este número físico subiria pra 4, não 3.
  check('recibo real gerado em EXATAMENTE 3 páginas físicas (1 por seção, mesa completa não transborda)', mediaBoxes.length === 3, String(mediaBoxes.length));
  for (const [, , , wStr, hStr] of mediaBoxes) {
    check('cada página sai em A4 PAISAGEM (largura > altura)', parseFloat(wStr) > parseFloat(hStr), `${wStr}x${hStr}`);
  }

  // Grade suprimida (18/09/2026, "pode suprimir a grade das tabelas... as
  // informações de substituições será preenchida a mão") — célula não tem
  // mais borda nos 4 lados, só linha horizontal (border-bottom). Checado
  // ainda com a media 'print' ativa (a regra vive dentro de @media print).
  const bordas = await p.evaluate(() => {
    const td = document.querySelector('#print-area .ra-tabela td');
    if (!td) return null;
    const cs = getComputedStyle(td);
    return { top: cs.borderTopStyle, left: cs.borderLeftStyle, right: cs.borderRightStyle, bottom: cs.borderBottomStyle };
  });
  check('célula da tabela sem grade (sem borda nos lados/topo, só embaixo)',
    !!bordas && bordas.top === 'none' && bordas.left === 'none' && bordas.right === 'none' && bordas.bottom !== 'none',
    JSON.stringify(bordas));

  await p.emulateMedia({ media: 'screen' });

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Imprimir recibos — Coordenadores: agrupa por local, e quem não tem
//      local resolvido entra numa seção própria, nunca escondido ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Coordenadores")');
  await p.waitForTimeout(300);

  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('coordenadora com local aparece agrupada em Escola A', /Escola A/.test(txt) && /COORDENADORA BEATRIZ/.test(txt));
  check('coordenador sem local aparece mesmo assim, numa seção própria', /Sem local definido/.test(txt) && /COORDENADOR CARLOS SEM LOCAL/.test(txt), txt.slice(0, 800));
  check('rótulo de função correto (sem "(a)", igual ao ELO)', /Coordenador de Acessibilidade/.test(txt) && !/Coordenador\(a\)/.test(txt));
  check('sem coluna "Seção Origem" nas substituições (documento é por local, não por seção)', !/Seção\s*Origem/.test(txt), txt.slice(0, 400));
  check('linha "OBS:" presente', /OBS:/.test(txt));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Imprimir recibos — Auxiliares: DUAS páginas no mesmo clique, uma
//      pra Sábado (D-1) e outra pra Domingo (Dia D), lista geral (sem
//      agrupar por local) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Sábado e Domingo")');
  await p.waitForTimeout(300);

  check('window.print() chamado uma vez só (as 2 páginas saem no mesmo job)', await p.evaluate(() => window.__printCalls) === 1);
  const paginas = await p.locator('#print-area .ra-pagina').count();
  check('exatamente 2 páginas geradas', paginas === 2, String(paginas));
  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('subtítulo Sábado (D-1) presente', /Sábado \(D-1\)/.test(txt));
  check('subtítulo Domingo \\(Dia D\\) presente', /Domingo \(Dia D\)/.test(txt));
  check('as duas pessoas aparecem NAS DUAS páginas (2x cada)', (txt.match(/AUXILIAR PEDRO/g) || []).length === 2 && (txt.match(/AUXILIAR LUCIA/g) || []).length === 2, txt.slice(0, 200));
  check('rótulo de função "Auxiliar de Serviços Eleitorais" (igual ao ELO, não "Auxiliar de Eleição") — 2 pessoas × 2 páginas', (txt.match(/Auxiliar de Serviços Eleitorais/g) || []).length === 4);
  check('zona aparece no timbre (lista geral, sem local de votação)', /7ª Zona Eleitoral — Campo Maior/.test(txt));
  check('sem coluna "Seção Origem" nas substituições (lista geral)', !/Seção\s*Origem/.test(txt));
  check('linha "OBS:" presente nas duas páginas', (txt.match(/OBS:/g) || []).length === 2);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Imprimir recibo — Junta Eleitoral: lista geral, um dia só (sem
//      Sábado/Domingo) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibo — Junta Eleitoral")');
  await p.waitForTimeout(300);

  const paginas = await p.locator('#print-area .ra-pagina').count();
  check('junta gera 1 página só (não separa por dia)', paginas === 1, String(paginas));
  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('mostra o membro da junta', /JUNTA FERNANDO/.test(txt));
  check('rótulo "Membro da Junta Eleitoral"', /Membro da Junta Eleitoral/.test(txt));
  check('sem subtítulo de dia (Sábado/Domingo) — recibo único', !/Sábado/.test(txt) && !/Domingo/.test(txt));
  check('linha "OBS:" presente', /OBS:/.test(txt));

  // Juiz Eleitoral (18/09/2026, "carlos marcello, é membro da junta, mas é
  // o juiz eleitoral ele não assina recibo") — Presidente da Junta é, por
  // lei (art. 36, Lei 4.737/65), o próprio juiz eleitoral: nunca entra na
  // contagem nem no recibo.
  check('CARLOS MARCELLO (juiz eleitoral, Presidente da Junta) NUNCA aparece no recibo', !/CARLOS MARCELLO/.test(txt), txt.slice(0, 400));
  check('recibo mostra só 1 pessoa (o juiz foi excluído da contagem)', (txt.match(/JUNTA FERNANDO/g) || []).length >= 1 && !/Presidente/.test(txt), txt.slice(0, 400));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Grupo vazio (0 pessoas) desabilita o botão, nunca gera recibo vazio ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ semJunta: true }));
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  const txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('junta conta 0 quando não há ninguém', /Junta Eleitoral \(0\)/.test(txt), txt.slice(0, 400));
  const disabled = await p.locator('button:has-text("Imprimir recibo — Junta Eleitoral")').isDisabled();
  check('botão de imprimir junta fica desabilitado sem ninguém cadastrado', disabled);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 8. Controle de pagamento (25/09/2026) — abre em "Pendentes", conta
// certo, marcar/desmarcar grava sime_atores + log de auditoria, valor
// editável independente do checkbox, busca por nome/seção, filtro por
// status. Juiz eleitoral nunca entra (mesmo critério do recibo). ──
{
  const ctx = await b.newContext();
  const m = mock();
  // PRESIDENTE MARIA já paga de antemão, pra testar o filtro "Pagos"/"Todos"
  // e o resumo sem depender só de marcações feitas durante o teste.
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_pago = true;
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_valor_pago = 260;
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_pago_em = '2026-09-24T18:00:00.000Z';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  // Total = 2 Presidentes (m1, m5) + 2 coordenadores + 2 auxiliares + 1
  // junta (não-juiz) = 7. Os demais 5 mesários (1º/2º Mesário, 1º
  // Secretário) NUNCA entram aqui — só o Presidente recebe pagamento
  // direto (25/09/2026, pedido direto: "só faremos pagamento para os
  // presidente... que se encarregará de repassar os outros membros da
  // mesa").
  const resumoTxt = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('resumo mostra 1 de 7 pagos (só Presidentes + coord + aux + junta, sem juiz)', /1 de 7 já pagos/.test(resumoTxt), resumoTxt.slice(0, 200));
  check('juiz eleitoral (CARLOS MARCELLO) nunca aparece no controle de pagamento', !/CARLOS MARCELLO/.test(resumoTxt));

  // Muda o filtro pra "Todos" só pra confirmar a exclusão dos demais cargos
  // da mesa, independente de status (não é um problema de filtro Pendente/
  // Pago escondendo eles).
  await p.selectOption('#ra-controle-pagamento select', '');
  await p.waitForTimeout(200);
  const resumoTodos = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('1º Mesário/2º Mesário/1º Secretário NUNCA aparecem, nem em "Todos"', !/MESARIO 1 JOAO/.test(resumoTodos) && !/MESARIO 2 ANA/.test(resumoTodos) && !/JOAO PEDRO OLIVEIRA/.test(resumoTodos) && !/ANA CAROLINA FERREIRA/.test(resumoTodos) && !/FRANCISCO DAS CHAGAS RODRIGUES/.test(resumoTodos), resumoTodos);
  check('os dois Presidentes aparecem em "Todos" (um pago, um pendente)', /PRESIDENTE MARIA —/.test(resumoTodos) && /PRESIDENTE MARIA DA SILVA/.test(resumoTodos), resumoTodos);
  await p.selectOption('#ra-controle-pagamento select', 'pendente');
  await p.waitForTimeout(200);

  const resumoTxt2 = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('abre filtrado em "Pendentes" por padrão — PRESIDENTE MARIA (já paga) não aparece na lista', !/PRESIDENTE MARIA —/.test(resumoTxt2), resumoTxt2);
  check('o outro Presidente (pendente) aparece com sugestão de valor R$260', /PRESIDENTE MARIA DA SILVA/.test(resumoTxt2), resumoTxt2);
  check('valor sugerido do 2º Presidente já vem 260.00 (não o valor único de sime_eleicoes, que é 65)', await p.locator('#ra-pag-valor-m5').inputValue() === '260.00');
  check('valor sugerido do auxiliar (AUXILIAR PEDRO) já vem 65.00 (1 dia, padrão)', await p.locator('#ra-pag-valor-a1').inputValue() === '65.00');

  // Marca o 2º Presidente (m5) como pago, com o valor sugerido mesmo (260).
  // Usa click() (não check()) de propósito: marcar como pago faz a própria
  // linha sumir da tela (filtro padrão é "Pendentes"), então o checkbox
  // literalmente deixa de existir no DOM logo depois do clique — check()
  // ficaria esperando pra sempre por um "confirmado marcado" que nunca
  // chega a ser observável ali.
  await p.click('#ra-controle-pagamento .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") input[type=checkbox]');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && e.payload.auxilio_alimentacao_pago === true));
  check('marcar como pago grava pago=true, valor e data em sime_atores', upd?.payload?.auxilio_alimentacao_pago === true && Number(upd?.payload?.auxilio_alimentacao_valor_pago) === 260 && !!upd?.payload?.auxilio_alimentacao_pago_em, JSON.stringify(upd));

  const logPago = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_auxilio_alimentacao_pago' && l.payload.ator_id === 'm5'));
  check('grava log de auditoria com o valor', logPago?.payload?.valor === 260, JSON.stringify(logPago));

  // Some da lista "Pendentes" (padrão) depois de marcado — reflete direto,
  // sem precisar trocar de filtro.
  const resumoTxt3 = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('depois de marcar, some da lista de pendentes e o resumo sobe pra 2 de 7', /2 de 7 já pagos/.test(resumoTxt3) && !/PRESIDENTE MARIA DA SILVA/.test(resumoTxt3), resumoTxt3.slice(0, 200));

  // Filtro "Pagos" mostra os 2 Presidentes marcados.
  await p.selectOption('#ra-controle-pagamento select', 'pago');
  await p.waitForTimeout(200);
  const resumoPagos = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('filtro "Pagos" mostra os dois Presidentes', /PRESIDENTE MARIA —/.test(resumoPagos) && /PRESIDENTE MARIA DA SILVA/.test(resumoPagos), resumoPagos);

  // Busca por nome — volta pro "Todos" pra não competir com o filtro de status.
  await p.selectOption('#ra-controle-pagamento select', '');
  await p.fill('#ra-pag-busca', 'coordenadora');
  await p.waitForTimeout(350);
  const resumoBusca = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('busca por nome filtra só quem bate (COORDENADORA BEATRIZ)', /COORDENADORA BEATRIZ/.test(resumoBusca) && !/PRESIDENTE MARIA/.test(resumoBusca) && !/AUXILIAR/.test(resumoBusca), resumoBusca);
  await p.fill('#ra-pag-busca', '');
  await p.waitForTimeout(350);

  // Desmarcar volta pra pendente e limpa a data (mas não o valor).
  await p.uncheck('#ra-controle-pagamento .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") input[type=checkbox]');
  await p.waitForTimeout(200);
  const updDesfeito = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'm5'));
  check('desmarcar limpa a data de pagamento', updDesfeito.auxilio_alimentacao_pago === false && updDesfeito.auxilio_alimentacao_pago_em === null, JSON.stringify(updDesfeito));
  const logDespago = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_auxilio_alimentacao_despago' && l.payload.ator_id === 'm5'));
  check('grava log de auditoria ao desmarcar', !!logDespago);

  // Editar só o valor (sem mexer no checkbox) grava sozinho, onblur.
  await p.selectOption('#ra-controle-pagamento select', '');
  await p.waitForTimeout(200);
  await p.fill('#ra-pag-valor-c1', '65,00'.replace(',', '.'));
  await p.locator('#ra-pag-valor-c1').blur();
  await p.waitForTimeout(200);
  const updValor = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'c1' && e.payload.auxilio_alimentacao_valor_pago === 65 && e.payload.auxilio_alimentacao_pago === undefined));
  check('editar só o valor (sem marcar pago) grava sozinho o campo, sem mexer no status', !!updValor, JSON.stringify(updValor));

  // Seletor "🗓️ dias…" do auxiliar — só existe pra auxiliar_eleicao, nunca
  // pra Presidente/coordenador — escolher "Sáb. + dom." preenche e SALVA
  // o valor (130) sozinho, sem precisar de onblur manual.
  check('seletor de dias só existe nas linhas de auxiliar de eleição', await p.locator('#ra-controle-pagamento .m-hist-item:has-text("AUXILIAR PEDRO") select').count() === 1 && await p.locator('#ra-controle-pagamento .m-hist-item:has-text("COORDENADORA BEATRIZ") select').count() === 0);
  await p.selectOption('#ra-controle-pagamento .m-hist-item:has-text("AUXILIAR PEDRO") select', '2');
  await p.waitForTimeout(200);
  check('escolher "Sáb. + dom." preenche o campo de valor com 130.00', await p.locator('#ra-pag-valor-a1').inputValue() === '130.00');
  const updDias = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && e.payload.auxilio_alimentacao_valor_pago === 130));
  check('escolher os dias já salva o valor sozinho (sem precisar de onblur manual)', !!updDias, JSON.stringify(updDias));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 9. Aviso de conflito de papel por título de eleitor (26/09/2026,
// achado real em auditoria: Adriana Paz Oliveira é Presidente de uma seção
// E Coordenadora de Acessibilidade de outra ao mesmo tempo, sem nenhum
// aviso cruzado entre as duas linhas — risco de marcar as duas como pagas
// sem perceber que é a mesma pessoa recebendo por um trabalho que só vai
// fazer uma vez). Nunca bloqueia — só avisa, e conta no resumo. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // COORDENADORA DUPLICADA compartilha o MESMO título de PRESIDENTE MARIA
  // (m1, Seção 5) — mesma pessoa segurando dois papéis ativos ao mesmo
  // tempo (m1 continua sem pagamento marcado, mock() de base não mexe
  // nisso — só o bloco 8 faz essa mutação, isolada dele).
  m.sime_atores.push({ id: 'c3', nome_completo: 'COORDENADORA DUPLICADA MARIA', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's2', inscricao_eleitoral: '111111111111', zona_id: 'z7', ativo: true });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.selectOption('#ra-controle-pagamento select', '');
  await p.waitForTimeout(200);

  const resumoTxt = (await p.locator('#ra-controle-pagamento').textContent()).replace(/\s+/g, ' ');
  check('resumo avisa 2 pessoas com papel duplicado', /2 com papel duplicado/.test(resumoTxt), resumoTxt.slice(0, 250));

  const linhaPresidente = (await p.locator('#ra-controle-pagamento .m-hist-item:has-text("PRESIDENTE MARIA —")').textContent()).replace(/\s+/g, ' ');
  check('linha do Presidente avisa que a mesma pessoa também é Coordenadora, com a seção dela', /mesma pessoa também está em: Coordenador de Acessibilidade \(Seção 12\)/.test(linhaPresidente), linhaPresidente);

  const linhaCoord = (await p.locator('#ra-controle-pagamento .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA")').textContent()).replace(/\s+/g, ' ');
  check('linha da Coordenadora avisa que a mesma pessoa também é Presidente, com a seção dele', /mesma pessoa também está em: Presidente \(Seção 5\)/.test(linhaCoord), linhaCoord);

  const linhaSemConflito = (await p.locator('#ra-controle-pagamento .m-hist-item:has-text("COORDENADORA BEATRIZ")').textContent()).replace(/\s+/g, ' ');
  check('quem não tem conflito não mostra nenhum aviso', !/mesma pessoa também está em/.test(linhaSemConflito), linhaSemConflito);

  // Marcar um dos dois como pago não afeta o aviso do outro — o aviso é
  // sobre a EXISTÊNCIA do papel duplicado, não sobre o status de pagamento.
  await p.click('#ra-controle-pagamento .m-hist-item:has-text("PRESIDENTE MARIA —") input[type=checkbox]');
  await p.waitForTimeout(200);
  const linhaCoordDepois = (await p.locator('#ra-controle-pagamento .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA")').textContent()).replace(/\s+/g, ' ');
  check('aviso continua depois de um dos dois ser marcado como pago', /mesma pessoa também está em: Presidente \(Seção 5\)/.test(linhaCoordDepois), linhaCoordDepois);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
