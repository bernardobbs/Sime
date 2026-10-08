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
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);

  // Total = 2 Presidentes (m1, m5) + 2 coordenadores + 2 auxiliares + 1
  // junta (não-juiz) = 7. Os demais 5 mesários (1º/2º Mesário, 1º
  // Secretário) NUNCA entram aqui — só o Presidente recebe pagamento
  // direto (25/09/2026, pedido direto: "só faremos pagamento para os
  // presidente... que se encarregará de repassar os outros membros da
  // mesa").
  const resumoTxt = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('resumo mostra 1 de 7 pagos (só Presidentes + coord + aux + junta, sem juiz)', /1 de 7 já pagos/.test(resumoTxt), resumoTxt.slice(0, 200));
  check('juiz eleitoral (CARLOS MARCELLO) nunca aparece no controle de pagamento', !/CARLOS MARCELLO/.test(resumoTxt));

  // Muda o filtro pra "Todos" só pra confirmar a exclusão dos demais cargos
  // da mesa, independente de status (não é um problema de filtro Pendente/
  // Pago escondendo eles).
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);
  const resumoTodos = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('1º Mesário/2º Mesário/1º Secretário NUNCA aparecem, nem em "Todos"', !/MESARIO 1 JOAO/.test(resumoTodos) && !/MESARIO 2 ANA/.test(resumoTodos) && !/JOAO PEDRO OLIVEIRA/.test(resumoTodos) && !/ANA CAROLINA FERREIRA/.test(resumoTodos) && !/FRANCISCO DAS CHAGAS RODRIGUES/.test(resumoTodos), resumoTodos);
  check('os dois Presidentes aparecem em "Todos" (um pago, um pendente)', /PRESIDENTE MARIA —/.test(resumoTodos) && /PRESIDENTE MARIA DA SILVA/.test(resumoTodos), resumoTodos);
  await p.selectOption('#ra-controle-unificado select', 'pendente');
  await p.waitForTimeout(200);

  const resumoTxt2 = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
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
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") input[type=checkbox]');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && e.payload.auxilio_alimentacao_pago === true));
  check('marcar como pago grava pago=true, valor e data em sime_atores', upd?.payload?.auxilio_alimentacao_pago === true && Number(upd?.payload?.auxilio_alimentacao_valor_pago) === 260 && !!upd?.payload?.auxilio_alimentacao_pago_em, JSON.stringify(upd));

  const logPago = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_auxilio_alimentacao_pago' && l.payload.ator_id === 'm5'));
  check('grava log de auditoria com o valor', logPago?.payload?.valor === 260, JSON.stringify(logPago));

  // Some da lista "Pendentes" (padrão) depois de marcado — reflete direto,
  // sem precisar trocar de filtro.
  const resumoTxt3 = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('depois de marcar, some da lista de pendentes e o resumo sobe pra 2 de 7', /2 de 7 já pagos/.test(resumoTxt3) && !/PRESIDENTE MARIA DA SILVA/.test(resumoTxt3), resumoTxt3.slice(0, 200));

  // Filtro "Pagos" mostra os 2 Presidentes marcados.
  await p.selectOption('#ra-controle-unificado select', 'pago');
  await p.waitForTimeout(200);
  const resumoPagos = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('filtro "Pagos" mostra os dois Presidentes', /PRESIDENTE MARIA —/.test(resumoPagos) && /PRESIDENTE MARIA DA SILVA/.test(resumoPagos), resumoPagos);

  // Busca por nome — volta pro "Todos" pra não competir com o filtro de status.
  await p.selectOption('#ra-controle-unificado select', '');
  await p.fill('#ra-ctl-busca', 'coordenadora');
  await p.waitForTimeout(350);
  const resumoBusca = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('busca por nome filtra só quem bate (COORDENADORA BEATRIZ)', /COORDENADORA BEATRIZ/.test(resumoBusca) && !/PRESIDENTE MARIA/.test(resumoBusca) && !/AUXILIAR/.test(resumoBusca), resumoBusca);
  await p.fill('#ra-ctl-busca', '');
  await p.waitForTimeout(350);

  // Desmarcar volta pra pendente e limpa a data (mas não o valor).
  await p.uncheck('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") input[type=checkbox]');
  await p.waitForTimeout(200);
  const updDesfeito = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'm5'));
  check('desmarcar limpa a data de pagamento', updDesfeito.auxilio_alimentacao_pago === false && updDesfeito.auxilio_alimentacao_pago_em === null, JSON.stringify(updDesfeito));
  const logDespago = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_auxilio_alimentacao_despago' && l.payload.ator_id === 'm5'));
  check('grava log de auditoria ao desmarcar', !!logDespago);

  // Editar só o valor (sem mexer no checkbox) grava sozinho, onblur.
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);
  await p.fill('#ra-pag-valor-c1', '65,00'.replace(',', '.'));
  await p.locator('#ra-pag-valor-c1').blur();
  await p.waitForTimeout(200);
  const updValor = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'c1' && e.payload.auxilio_alimentacao_valor_pago === 65 && e.payload.auxilio_alimentacao_pago === undefined));
  check('editar só o valor (sem marcar pago) grava sozinho o campo, sem mexer no status', !!updValor, JSON.stringify(updValor));

  // Seletor "🗓️ dias…" do auxiliar — só existe pra auxiliar_eleicao, nunca
  // pra Presidente/coordenador — escolher "Sáb. + dom." preenche e SALVA
  // o valor (130) sozinho, sem precisar de onblur manual.
  check('seletor de dias só existe nas linhas de auxiliar de eleição', await p.locator('#ra-controle-unificado .m-hist-item:has-text("AUXILIAR PEDRO") select').count() === 1 && await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA BEATRIZ") select').count() === 0);
  await p.selectOption('#ra-controle-unificado .m-hist-item:has-text("AUXILIAR PEDRO") select', '2');
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
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  const resumoTxt = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('resumo avisa 2 pessoas com papel duplicado', /2 com papel duplicado/.test(resumoTxt), resumoTxt.slice(0, 250));

  const linhaPresidente = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —")').textContent()).replace(/\s+/g, ' ');
  check('linha do Presidente avisa que a mesma pessoa também é Coordenadora, com a seção dela', /mesma pessoa também está em: Coordenador de Acessibilidade \(Seção 12\)/.test(linhaPresidente), linhaPresidente);

  const linhaCoord = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA")').textContent()).replace(/\s+/g, ' ');
  check('linha da Coordenadora avisa que a mesma pessoa também é Presidente, com a seção dele', /mesma pessoa também está em: Presidente \(Seção 5\)/.test(linhaCoord), linhaCoord);

  const linhaSemConflito = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA BEATRIZ")').textContent()).replace(/\s+/g, ' ');
  check('quem não tem conflito não mostra nenhum aviso', !/mesma pessoa também está em/.test(linhaSemConflito), linhaSemConflito);

  // Marcar um dos dois como pago não afeta o aviso do outro — o aviso é
  // sobre a EXISTÊNCIA do papel duplicado, não sobre o status de pagamento.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —") input[type=checkbox]');
  await p.waitForTimeout(200);
  const linhaCoordDepois = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA")').textContent()).replace(/\s+/g, ' ');
  check('aviso continua depois de um dos dois ser marcado como pago', /mesma pessoa também está em: Presidente \(Seção 5\)/.test(linhaCoordDepois), linhaCoordDepois);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 10. Modal de detalhe (29/09/2026, pedido direto: "quero poder clicar
// no nome do mesário, para verificar o pix, informar se o pix foi feito, o
// valor e uma observação") — abre no clique do nome, na lista do Controle de
// pagamento; edita PIX/valor/pago e adiciona observação, tudo persistindo em
// sime_atores (mesmas colunas/ações de log já usadas em "Contatar
// mesários" — mesario_editar_pix/mesario_observacao_adicionada). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  // Clica no nome do Presidente pendente (m5, Seção 63) — abre o modal
  // compartilhado (#overlay/#modal-body).
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") b');
  await p.waitForTimeout(300);

  check('overlay abre', await p.locator('#overlay').evaluate(el => el.classList.contains('open')));
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('modal mostra o nome e o papel/seção da pessoa', /PRESIDENTE MARIA DA SILVA/.test(modalTxt) && /Presidente/.test(modalTxt) && /Seção 63/.test(modalTxt), modalTxt.slice(0, 300));
  check('campo de PIX começa vazio (ninguém cadastrou ainda)', await p.locator('#ra-modal-pix').inputValue() === '');
  check('checkbox "PIX feito" começa desmarcado', !(await p.locator('#modal-body input[type=checkbox]').isChecked()));
  check('valor já vem sugerido em 260.00 (Presidente)', await p.locator('#ra-modal-valor').inputValue() === '260.00');

  // Editar o PIX — onblur salva sozinho, mesma coluna/ação de log já
  // usadas no modal de "Contatar mesários" (mesario_editar_pix).
  await p.fill('#ra-modal-pix', '11122233344');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(200);
  const updPix = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && e.payload.pix === '11122233344'));
  check('editar o PIX grava em sime_atores', !!updPix, JSON.stringify(updPix));
  const logPix = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_editar_pix' && l.payload.ator_id === 'm5'));
  check('grava log mesario_editar_pix (mesma ação já usada em Contatar mesários)', !!logPix, JSON.stringify(logPix));

  // Marcar "PIX feito" — usa o valor do próprio campo do modal (260).
  await p.click('#modal-body input[type=checkbox]');
  await p.waitForTimeout(200);
  const updPago = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && e.payload.auxilio_alimentacao_pago === true));
  check('marcar "PIX feito" no modal grava pago=true com o valor certo', updPago?.payload?.auxilio_alimentacao_valor_pago === 260, JSON.stringify(updPago));
  const resumoDepois = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('a lista por baixo (mesmo escondida atrás do overlay) já reflete o pagamento no resumo', /1 de 7 já pagos/.test(resumoDepois), resumoDepois.slice(0, 200));

  // Observação — mesmo campo/ação de log usados em Contatar mesários
  // (mesario_observacao_adicionada), com o carimbo de autor/data.
  await p.fill('#ra-modal-obs-nova', 'Confirmado por telefone com o presidente');
  await p.click('#modal-body button:has-text("➕ Adicionar observação")');
  await p.waitForTimeout(200);
  const pessoaObs = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'm5'));
  check('observação gravada em sime_atores.observacao com carimbo de autor/data', /\[2026-09-18 15:30\] Maria \(cartório\): Confirmado por telefone com o presidente/.test(pessoaObs?.observacao || ''), pessoaObs?.observacao);
  const logObs = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_observacao_adicionada' && l.payload.ator_id === 'm5'));
  check('grava log mesario_observacao_adicionada', !!logObs);
  const modalTxt2 = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('observação nova aparece na lista dentro do próprio modal', /Confirmado por telefone com o presidente/.test(modalTxt2), modalTxt2.slice(-300));
  check('caixa de observação foi limpa depois de adicionar', await p.locator('#ra-modal-obs-nova').inputValue() === '');

  // Fechar o modal via botão dedicado.
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);
  check('fechar o modal remove a classe "open" do overlay', !(await p.locator('#overlay').evaluate(el => el.classList.contains('open'))));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 11. Modal de detalhe também mostra o aviso de papel duplicado, mesmo
// texto já usado na linha da lista (26/09/2026) ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push({ id: 'c3', nome_completo: 'COORDENADORA DUPLICADA MARIA', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's2', inscricao_eleitoral: '111111111111', zona_id: 'z7', ativo: true });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —") b');
  await p.waitForTimeout(300);
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('modal do Presidente com conflito avisa a Coordenadora duplicada', /mesma pessoa também está em: Coordenador de Acessibilidade \(Seção 12\)/.test(modalTxt), modalTxt.slice(0, 400));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 12. Sub-abas "🖨️ Impressão" × "💰 Controle de pagamento" (29/09/2026,
// pedido direto: "melhore a aba de auxilio alimentação, com uma parte
// separada só para impressão") — nasce em "Impressão"; os botões de gerar
// recibo somem quando troca pra "Controle de pagamento", e vice-versa; o
// contador de pagamento no próprio botão da sub-aba já reflete o resumo
// sem precisar clicar nela. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  check('nasce na sub-aba Impressão — botão de Mesa Receptora visível de cara', await p.locator('button:has-text("Imprimir recibos — Mesa Receptora")').count() === 1);
  check('controle de pagamento não está no DOM ainda (só aparece na outra sub-aba)', await p.locator('#ra-controle-unificado').count() === 0);
  check('botão da sub-aba de pagamento já mostra o resumo (0/7) sem precisar clicar', /Controle de pagamento e frequência — 0\/7/.test(await p.locator('button:has-text("Controle de pagamento e frequência")').textContent()));

  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  check('trocando pra "Controle de pagamento", os botões de imprimir somem', await p.locator('button:has-text("Imprimir recibos — Mesa Receptora")').count() === 0);
  check('e a lista de pagamento aparece', await p.locator('#ra-controle-unificado').count() === 1);

  await p.click('button:has-text("🖨️ Impressão")');
  await p.waitForTimeout(300);
  check('voltando pra "Impressão", a lista de pagamento some de novo', await p.locator('#ra-controle-unificado').count() === 0);
  check('e os botões de imprimir voltam', await p.locator('button:has-text("Imprimir recibos — Mesa Receptora")').count() === 1);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 13. QR Code do PIX no modal (30/09/2026, pedido direto: "conseguiriamos
// gerar o qrcode do pix ao abrir o modal com o valor preenchido e
// informação Auxilio alimentação eleições 2026 seção XXX?") — BR Code
// (Pix Copia e Cola) montado no cliente com vendor/qrcode.min.js (mesma lib
// já usada em SIME_tokens.html/SIME_rotas.html, agora também carregada em
// SIME_convocacao.html). Só aparece quando a pessoa já tem PIX cadastrado;
// atualiza sozinho quando a chave ou o valor mudam. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  // m5 = Presidente, Seção 63, ainda sem PIX cadastrado.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") b');
  await p.waitForTimeout(300);

  check('sem PIX cadastrado, o modal não desenha QR nenhum', await p.locator('#ra-modal-qr canvas').count() === 0);
  check('sem PIX, mostra a dica pra cadastrar em vez do QR', /Cadastre uma chave PIX acima pra gerar o QR Code/.test(await p.locator('#ra-modal-qr-wrap').textContent()));

  await p.fill('#ra-modal-pix', '11122233344');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(300);

  check('depois de salvar o PIX, o QR aparece (1 canvas só, não acumula)', await p.locator('#ra-modal-qr canvas').count() === 1);
  const legenda1 = await p.locator('#ra-modal-qr-wrap').textContent();
  check('legenda mostra o valor sugerido (Presidente = R$260) e a seção', /R\$\s*260,00/.test(legenda1) && /Seção 63/.test(legenda1), legenda1);

  // Payload EMV/BR Code em si — checa estrutura (GUI, chave, descrição
  // ASCII sem acento, cidade da zona) e o CRC16 (recalculado à parte no
  // teste, mesmo algoritmo, pra confirmar que bate com o que o app gravou
  // no fim do payload).
  const payload = await p.evaluate(() =>
    window.raPixPayload('11122233344', 'PRESIDENTE MARIA DA SILVA SANTOS SOUSA OLIVEIRA', 'Campo Maior', 260, 'Auxílio Alimentação Eleições 2026 - Seção 63'));
  check('payload começa com o indicador de formato padrão (000201)', payload.startsWith('000201'), payload);
  check('payload contém o GUI oficial do Pix', payload.includes('br.gov.bcb.pix'), payload);
  check('payload contém a chave PIX exata (sem alterar maiúscula/acento)', payload.includes('11122233344'), payload);
  check('payload contém a descrição em ASCII maiúsculo, sem acento', payload.includes('AUXILIO ALIMENTACAO ELEICOES 2026 - SECAO 63'), payload);
  check('payload contém a cidade da zona (também sem acento)', payload.includes('CAMPO MAIOR'), payload);
  check('payload contém o valor formatado com 2 casas', payload.includes('260.00'), payload);
  const crcRecalculado = await p.evaluate((pl) => {
    let crc = 0xFFFF;
    const str = pl.slice(0, -4);
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) & 0xFF) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }, payload);
  check('CRC16 no fim do payload bate com o recalculado (CCITT, poly 0x1021)', payload.slice(-4) === crcRecalculado, `${payload.slice(-4)} vs ${crcRecalculado}`);

  // Editar o valor também redesenha o QR (não acumula canvas) e atualiza a
  // legenda — mesmo padrão de "qualquer edição de chave/valor reflete na
  // hora", sem precisar fechar/reabrir o modal.
  await p.fill('#ra-modal-valor', '300.00');
  await p.locator('#ra-modal-valor').blur();
  await p.waitForTimeout(300);
  check('editar o valor mantém 1 canvas só (redesenha, não acumula)', await p.locator('#ra-modal-qr canvas').count() === 1);
  const legenda2 = await p.locator('#ra-modal-qr-wrap').textContent();
  check('legenda reflete o novo valor depois de editar', /R\$\s*300,00/.test(legenda2), legenda2);

  // Sem chave nenhuma, o payload nunca é gerado (nunca inventa uma chave).
  const semChave = await p.evaluate(() => window.raPixPayload('', 'FULANO', 'Campo Maior', 100, 'teste'));
  check('sem chave PIX, raPixPayload devolve null (nunca inventa)', semChave === null);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 14. Filtro por função (Presidente/Coordenador/Auxiliar) e por
// município no Controle de pagamento (30/09/2026, pedido direto: "quero
// poder filtrar somente os presidentes, somente os coordenadores ou
// somente os auxiliares e filtrar por municipio também") — dois filtros
// independentes (RA_FUNCAO_FILTRO/raPagFiltroMunicipio), combinam entre si
// e com o filtro de status/busca já existentes. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Só a mock() base tem "Campo Maior" no universo de pagamento (as
  // Seções 5/63) — acrescenta uma coordenadora em Jatobá do Piauí (Seção
  // 12) pra ter um segundo município de verdade pra filtrar.
  m.sime_atores.push({ id: 'c4', nome_completo: 'COORDENADORA JATOBA', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's2', inscricao_eleitoral: '121212121212', zona_id: 'z7', ativo: true });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select >> nth=0', ''); // status: Todos, pra ver o universo inteiro
  await p.waitForTimeout(200);

  const selects = p.locator('#ra-controle-unificado select');
  const selFuncao = selects.nth(1);
  const selMunicipio = selects.nth(2);

  const opcoesFuncao = (await selFuncao.textContent()).replace(/\s+/g, ' ');
  check('select de função lista os 4 grupos com contagem certa', /Todas as funções \(8\)/.test(opcoesFuncao) && /Presidente \(Mesa Receptora\) \(2\)/.test(opcoesFuncao) && /Coordenador\(a\) de Acessibilidade \(3\)/.test(opcoesFuncao) && /Auxiliar de Serviços Eleitorais \(2\)/.test(opcoesFuncao) && /Membro da Junta Eleitoral \(1\)/.test(opcoesFuncao), opcoesFuncao);

  const opcoesMunicipio = (await selMunicipio.textContent()).replace(/\s+/g, ' ');
  check('select de município lista os municípios distintos (só quem tem seção)', /Todos os municípios/.test(opcoesMunicipio) && /Campo Maior/.test(opcoesMunicipio) && /Jatobá do Piauí/.test(opcoesMunicipio), opcoesMunicipio);

  await selFuncao.selectOption('mesario');
  await p.waitForTimeout(200);
  let itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('filtro "Presidente" mostra só os 2 Presidentes, nenhum coordenador/auxiliar/junta', itens.length === 2 && itens.every(t => /PRESIDENTE/.test(t)), JSON.stringify(itens));

  await selFuncao.selectOption('coord_acessibilidade');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('filtro "Coordenador" mostra as 3 coordenadoras/coordenador, ninguém mais', itens.length === 3 && itens.every(t => /COORDENAD/.test(t)), JSON.stringify(itens));

  await selFuncao.selectOption('auxiliar_eleicao');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('filtro "Auxiliar" mostra só os 2 auxiliares de eleição', itens.length === 2 && itens.every(t => /AUXILIAR/.test(t)), JSON.stringify(itens));

  // Volta pra "Todas as funções" e filtra só por município — Campo Maior
  // tem 3 pessoas com seção lá (2 Presidentes + 1 coordenadora); a
  // coordenadora de Jatobá e quem não tem seção nenhuma (2 auxiliares +
  // junta + 1 coordenador sem local) ficam de fora.
  await selFuncao.selectOption('');
  await p.waitForTimeout(150);
  await selMunicipio.selectOption('Campo Maior');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('filtro "Campo Maior" mostra as 3 pessoas com seção nesse município', itens.length === 3, JSON.stringify(itens));

  await selMunicipio.selectOption('Jatobá do Piauí');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('filtro "Jatobá do Piauí" mostra só a coordenadora de lá', itens.length === 1 && /COORDENADORA JATOBA/.test(itens[0]), JSON.stringify(itens));

  // Combina função + município — só quem bate nos dois ao mesmo tempo.
  await selMunicipio.selectOption('Campo Maior');
  await selFuncao.selectOption('coord_acessibilidade');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('função + município combinados mostram só quem bate nos dois (COORDENADORA BEATRIZ)', itens.length === 1 && /COORDENADORA BEATRIZ/.test(itens[0]), JSON.stringify(itens));

  await selMunicipio.selectOption('');
  await selFuncao.selectOption('');
  await p.waitForTimeout(200);
  itens = (await p.locator('#ra-controle-unificado .m-hist-item b').allTextContents());
  check('voltando os dois pra "Todos"/"Todas as funções", a lista completa (8) volta', itens.length === 8, JSON.stringify(itens));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 15. Normalização da chave PIX pro formato que o DICT reconhece
// (30/09/2026, achado real reportado pelo cartório: escaneou um QR de
// produção com telefone digitado sem "+55" e o banco devolveu "chave não
// encontrada") — `raPixChaveNormalizada()` só toca o valor usado pra
// montar o payload do QR, nunca o `sime_atores.pix` salvo. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);

  // Telefone de 11 dígitos (DDD+9) sem "+55" — o caso real reportado —
  // vira E.164 completo; CPF com pontuação vira só dígitos; o resto (CPF
  // já limpo, CNPJ, e-mail, UUID, já em "+") nunca é tocado.
  const casos = await p.evaluate(() => ([
    window.raPixChaveNormalizada('86981083472'),           // telefone sem "+55" (caso real)
    window.raPixChaveNormalizada('072.580.733-45'),        // CPF com pontuação
    window.raPixChaveNormalizada('07258073345'),           // o mesmo CPF, já limpo — não muda
    window.raPixChaveNormalizada('11144477735'),           // outro CPF válido, sem pontuação — não muda
    window.raPixChaveNormalizada('12.345.678/0001-95'),    // CNPJ com pontuação — vira só dígitos
    window.raPixChaveNormalizada('fulano@exemplo.com'),    // e-mail — nunca mexe
    window.raPixChaveNormalizada('+5586999998888'),        // já em E.164 — nunca mexe
    window.raPixChaveNormalizada('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), // chave aleatória (UUID) — nunca mexe
    window.raPixChaveNormalizada(''),                      // vazio — devolve vazio
  ]));
  check('telefone sem "+55" (11 dígitos, DDD+9) vira E.164 completo', casos[0] === '+5586981083472', casos[0]);
  check('CPF com pontuação vira só dígitos (a mesma chave real do cartório)', casos[1] === '07258073345', casos[1]);
  check('CPF já limpo não muda', casos[2] === '07258073345', casos[2]);
  check('outro CPF válido (11144477735) não muda', casos[3] === '11144477735', casos[3]);
  check('CNPJ com pontuação vira só dígitos', casos[4] === '12345678000195', casos[4]);
  check('e-mail nunca é tocado', casos[5] === 'fulano@exemplo.com', casos[5]);
  check('chave já em E.164 (+55...) nunca é tocada', casos[6] === '+5586999998888', casos[6]);
  check('chave aleatória (UUID) nunca é tocada', casos[7] === 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', casos[7]);
  check('chave vazia devolve vazio (nunca inventa)', casos[8] === '');

  // O payload do QR usa a chave NORMALIZADA — mesmo caso real, ponta a
  // ponta: telefone cru no campo vira "+55..." dentro do payload.
  const payloadTel = await p.evaluate(() =>
    window.raPixPayload(window.raPixChaveNormalizada('86981083472'), 'CICERO DE PAULO', 'Sigefredo Pacheco', 260, 'teste'));
  check('payload do telefone corrigido contém a chave em E.164, não o valor cru digitado', payloadTel.includes('+5586981083472') && !payloadTel.includes('011186981083472'), payloadTel);

  // No modal, quando a chave normalizada difere da digitada, aparece uma
  // nota explicando o ajuste — nunca em silêncio.
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select >> nth=0', '');
  await p.waitForTimeout(200);
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") b');
  await p.waitForTimeout(300);

  await p.fill('#ra-modal-pix', '86981083472');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(300);
  const legendaTel = await p.locator('#ra-modal-qr-wrap').textContent();
  check('modal avisa a chave ajustada quando digita telefone sem "+55"', /chave usada no QR: \+5586981083472/.test(legendaTel), legendaTel);

  await p.fill('#ra-modal-pix', '072.580.733-45');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(300);
  const legendaCpf = await p.locator('#ra-modal-qr-wrap').textContent();
  check('modal avisa a chave ajustada quando digita CPF com pontuação', /chave usada no QR: 07258073345/.test(legendaCpf), legendaCpf);
  const pessoaSalva = await p.evaluate(() => window.__mock.sime_atores.find(a => a.id === 'm5'));
  check('sime_atores.pix continua salvo EXATAMENTE como digitado (com pontuação), a normalização é só pro QR', pessoaSalva?.pix === '072.580.733-45', pessoaSalva?.pix);

  await p.fill('#ra-modal-pix', 'fulano@exemplo.com');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(300);
  const legendaEmail = await p.locator('#ra-modal-qr-wrap').textContent();
  check('sem ajuste nenhum (e-mail), a nota "chave usada no QR" não aparece', !/chave usada no QR/.test(legendaEmail), legendaEmail);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 16. QR do Coordenador de Acessibilidade usa o PIX do Presidente da
// seção de MENOR número do local (01/10/2026, pedido direto: "o pix dos
// coordenadores de acessibilidade que não foram feitos ainda, deve ser
// feito para o presidente da seção de menor numero do local. na
// informação deve constar eleições 2026 - coordenador de acessibilidade e
// se possivel o nome do local de votação") — nunca o PIX do próprio
// coordenador, mesmo quando ele existe; o campo "Chave PIX" continua
// editável (informativo), só não é o que o QR usa pra este cargo. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Seção nova, MESMO local da COORDENADORA BEATRIZ (s1, "Escola A",
  // numero 5) mas com número MENOR (2) — o Presidente daqui é quem deve
  // "ganhar" como destino, não o Presidente da seção 5 (m1).
  m.sime_secoes.push({ id: 's5', numero: 2, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'z7' });
  m.sime_atores.push({ id: 'm9', nome_completo: 'PRESIDENTE MENOR SECAO', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's5', inscricao_eleitoral: '131313131313', zona_id: 'z7', ativo: true, pix: '22233344455' });
  // Coordenadora em local SEM nenhum Presidente ativo (s2/"Escola B" só
  // tem m3, que é "2º Mesário" — nunca Presidente).
  m.sime_atores.push({ id: 'c5', nome_completo: 'COORDENADORA SEM PRESIDENTE', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's2', inscricao_eleitoral: '141414141414', zona_id: 'z7', ativo: true });

  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select >> nth=0', '');
  await p.waitForTimeout(200);

  await p.click('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA BEATRIZ") b');
  await p.waitForTimeout(300);

  check('campo "Chave PIX" avisa que é só informativo pra este cargo', /do próprio coordenador — informativo/.test(await p.locator('.form-group label').first().textContent()));
  check('nota explica que o pagamento vai pro Presidente de Mesa', /PIX do Presidente de Mesa da seção de menor número/.test(await p.locator('#modal-body').textContent()));

  check('QR já aparece mesmo sem a coordenadora ter PIX próprio (usa o do Presidente)', await p.locator('#ra-modal-qr canvas').count() === 1);
  const legendaBeatriz = await p.locator('#ra-modal-qr-wrap').textContent();
  check('legenda cita "Eleições 2026 - Coordenador de Acessibilidade"', /Eleições 2026 - Coordenador de Acessibilidade/.test(legendaBeatriz), legendaBeatriz);
  check('legenda inclui o nome do local de votação', /Escola A/.test(legendaBeatriz), legendaBeatriz);
  check('legenda mostra o Presidente da seção de MENOR número (2), não o da seção 5', /PRESIDENTE MENOR SECAO/.test(legendaBeatriz) && /Seção 2/.test(legendaBeatriz), legendaBeatriz);
  check('legenda NUNCA cita o Presidente da seção maior (5) como destinatário', !/PRESIDENTE MARIA(?! DA SILVA)/.test(legendaBeatriz), legendaBeatriz);

  // Overlay fica por cima da lista enquanto o modal está aberto (mesmo
  // `#modal-body` compartilhado de sempre) — fecha pelo botão antes de
  // clicar no próximo nome, não dá pra clicar "através" do overlay.
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);

  // Coordenador sem local nenhum (c2) — mensagem própria, nunca um QR
  // inventado.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("COORDENADOR CARLOS SEM LOCAL") b');
  await p.waitForTimeout(300);
  check('coordenador sem local: nenhum canvas desenhado', await p.locator('#ra-modal-qr canvas').count() === 0);
  check('coordenador sem local: mensagem explica que a regra não se aplica', /Sem local de votação definido/.test(await p.locator('#ra-modal-qr-wrap').textContent()));
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);

  // Coordenadora com local, mas SEM nenhum Presidente ativo lá — mensagem
  // distinta (não confunde "sem local" com "local sem Presidente").
  await p.click('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA SEM PRESIDENTE") b');
  await p.waitForTimeout(300);
  check('coordenadora sem Presidente no local: nenhum canvas desenhado', await p.locator('#ra-modal-qr canvas').count() === 0);
  check('coordenadora sem Presidente no local: mensagem própria, distinta de "sem local"', /Nenhum Presidente ativo encontrado/.test(await p.locator('#ra-modal-qr-wrap').textContent()));
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);

  // Mesário (Presidente) continua pago na PRÓPRIA chave, sem passar pela
  // regra do coordenador — nenhuma regressão no fluxo de sempre.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA DA SILVA") b');
  await p.waitForTimeout(300);
  check('campo "Chave PIX" do Presidente NÃO mostra o aviso "informativo" (só vale pra coordenador)', !/do próprio coordenador — informativo/.test(await p.locator('.form-group label').first().textContent()));
  await p.fill('#ra-modal-pix', '99988877766');
  await p.locator('#ra-modal-pix').blur();
  await p.waitForTimeout(300);
  const legendaPresidente = await p.locator('#ra-modal-qr-wrap').textContent();
  check('Presidente continua pago na própria chave (sem "via Presidente")', !/Destinatário:/.test(legendaPresidente), legendaPresidente);
  check('Presidente continua com a descrição de sempre (não vira "Coordenador de Acessibilidade")', /Auxílio Alimentação Eleições 2026/.test(legendaPresidente) && !/Coordenador de Acessibilidade/.test(legendaPresidente), legendaPresidente);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 17. Relatório de pagamentos (01/10/2026, pedido direto: "gere um
// relatorio no sime para a impressão dos valores pagos e os documentos
// atribuidos") — botão novo na sub-aba "💰 Controle de pagamento", imprime
// só quem já está pago, com valor + nº do documento (nº do Pix no
// extrato), respeitando os filtros de função/município/busca já aplicados
// na tela mas ignorando o de status (senão filtrar "Pendentes" faria o
// relatório sair sempre vazio). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_pago = true;
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_valor_pago = 260;
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_pago_em = '2026-09-24T18:00:00.000Z';
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_documento = '100147';
  m.sime_atores.find(a => a.id === 'c1').auxilio_alimentacao_pago = true;
  m.sime_atores.find(a => a.id === 'c1').auxilio_alimentacao_valor_pago = 65;
  m.sime_atores.find(a => a.id === 'c1').auxilio_alimentacao_documento = '100193';
  // a1 (AUXILIAR PEDRO) fica pendente, de propósito — nunca deve aparecer.
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);

  // Deixa a tela filtrada em "Pendentes" (padrão) de propósito — o
  // relatório precisa sair com os pagos mesmo assim, ignorando esse filtro.
  await p.click('button:has-text("🖨️ Imprimir relatório")');
  await p.waitForTimeout(300);

  check('window.print() foi chamado', await p.evaluate(() => window.__printCalls) === 1);
  const paginas = await p.locator('#print-area .ra-pagina').count();
  check('uma única página (lista contínua, não uma por pessoa)', paginas === 1, String(paginas));
  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('título do relatório presente', /Relatório de Pagamentos — Auxílio Alimentação/.test(txt));
  check('os 2 pagos aparecem, com valor e documento', /PRESIDENTE MARIA\b.*R\$ 260,00.*100147/.test(txt) && /COORDENADORA BEATRIZ.*R\$ 65,00.*100193/.test(txt), txt);
  check('quem está pendente (AUXILIAR PEDRO) nunca aparece, mesmo com a tela filtrada em "Pendentes"', !/AUXILIAR PEDRO/.test(txt), txt);
  check('rodapé mostra o total pago (325,00) e a contagem (2 pagamentos)', /Total pago:\s*R\$ 325,00.*2 pagamentos/.test(txt), txt);

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const log = escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'recibo_alimentacao_relatorio_pagamentos_impresso');
  check('log de auditoria gravado com quantidade 2', !!log && log.payload.payload.quantidade === 2, JSON.stringify(log));

  // Filtro por função (já existente na tela) é respeitado pelo relatório —
  // só o Presidente, a coordenadora some.
  const selects = p.locator('#ra-controle-unificado select');
  const selStatus = selects.nth(0);
  const selFuncao = selects.nth(1);
  await selFuncao.selectOption('mesario');
  await p.waitForTimeout(200);
  await p.click('button:has-text("🖨️ Imprimir relatório")');
  await p.waitForTimeout(300);
  const txt2 = (await p.locator('#print-area').innerHTML()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('filtro de função aplicado: só o Presidente aparece, a coordenadora some', /PRESIDENTE MARIA\b/.test(txt2) && !/COORDENADORA BEATRIZ/.test(txt2), txt2);

  // Nenhum pago nenhum (depois de desmarcar os dois) — avisa em vez de
  // imprimir um documento vazio.
  await selFuncao.selectOption('');
  await selStatus.selectOption('pago');
  await p.waitForTimeout(200);
  // click() (não uncheck()), mesmo cuidado já documentado no bloco 8: com o
  // filtro em "Pagos", desmarcar faz a própria linha sumir da tela — uncheck()
  // ficaria esperando pra sempre por um estado "desmarcado e visível" que
  // nunca chega a existir.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —") input[type=checkbox]');
  await p.waitForTimeout(200);
  await p.click('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA BEATRIZ") input[type=checkbox]');
  await p.waitForTimeout(200);
  const chamadasAntes = await p.evaluate(() => window.__printCalls);
  await p.click('button:has-text("🖨️ Imprimir relatório")');
  await p.waitForTimeout(300);
  check('sem nenhum pagamento, avisa em vez de chamar window.print()', await p.evaluate(() => window.__printCalls) === chamadasAntes);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18. Frequência e Devolução da mesa — modal "❌ Faltou" (06/10/2026,
// pedido direto: "quando marcar em faltou, deve abrir um modal para
// indicar qual membro da mesa faltou e não foi substituido" + "tambem
// pode acontecer de faltar o recibo e a mesa funcionar completa").
// Usa a seção 63 (mock, mesa completa — Presidente m5/1º Mesário m6/2º
// Mesário m7/1º Secretário m8), com o Presidente já pago R$260. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const pres = m.sime_atores.find(a => a.id === 'm5');
  pres.auxilio_alimentacao_pago = true;
  pres.auxilio_alimentacao_valor_pago = 260;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  // Presidente já está pago — sem isso, o filtro de pagamento (default
  // "Pendentes") esconderia a própria linha que o teste precisa manipular.
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  const linhaPresidente = p.locator('.m-hist-item:has-text("PRESIDENTE MARIA DA SILVA")');
  check('linha do Presidente tem botão ❌ Faltou (abre modal, não marca direto)', await linhaPresidente.locator('button:has-text("❌ Faltou")').count() === 1);
  check('linha do Presidente tem botão 👥 Todos presentes', await linhaPresidente.locator('button:has-text("👥 Todos presentes")').count() === 1);

  // Abre o modal e marca 2 dos 4 como faltou (1º Mesário e 1º Secretário).
  await linhaPresidente.locator('button:has-text("❌ Faltou")').click();
  await p.waitForTimeout(250);
  check('modal abre com os 4 cargos da mesa', await p.locator('#modal-body label:has-text("Presidente — PRESIDENTE MARIA")').count() === 1
    && await p.locator('#modal-body label:has-text("1º Mesário — JOAO PEDRO")').count() === 1
    && await p.locator('#modal-body label:has-text("2º Mesário — ANA CAROLINA")').count() === 1
    && await p.locator('#modal-body label:has-text("1º Secretário — FRANCISCO")').count() === 1);
  check('checkbox de recibo ausente também está no modal, desmarcado', await p.locator('#modal-body label:has-text("Recibo não foi assinado")').locator('input[type=checkbox]').isChecked() === false);

  await p.locator('#modal-body label:has-text("1º Mesário — JOAO PEDRO")').locator('input[type=checkbox]').check();
  await p.locator('#modal-body label:has-text("1º Secretário — FRANCISCO")').locator('input[type=checkbox]').check();
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(300);

  const escritas1 = await p.evaluate(() => window.__mock.escritas);
  const updFreq = escritas1.filter(e => e.op === 'update' && e.tabela === 'sime_atores' && 'auxilio_alimentacao_frequencia' in e.payload);
  check('grava faltou pro 1º Mesário (m6) e pro 1º Secretário (m8)',
    updFreq.some(u => u.filtro.id === 'm6' && u.payload.auxilio_alimentacao_frequencia === 'faltou') &&
    updFreq.some(u => u.filtro.id === 'm8' && u.payload.auxilio_alimentacao_frequencia === 'faltou'), JSON.stringify(updFreq));
  check('grava presente pro Presidente (m5) e pro 2º Mesário (m7) — quem não foi marcado no modal',
    updFreq.some(u => u.filtro.id === 'm5' && u.payload.auxilio_alimentacao_frequencia === 'presente') &&
    updFreq.some(u => u.filtro.id === 'm7' && u.payload.auxilio_alimentacao_frequencia === 'presente'), JSON.stringify(updFreq));

  const txtApos = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('resumo da linha mostra 2 de 4 membro(s) faltou(aram), devolver R$ 130,00 (260÷4×2)', /2 de 4 membro\(s\) da mesa faltou\(aram\).*deve devolver R\$ 130,00/.test(txtApos), txtApos);
  check('resumo cita R$ 65,00 por membro', /R\$ 65,00 por membro/.test(txtApos), txtApos);
  const resumoLeitura = p.locator('.m-hist-item:has-text("PRESIDENTE MARIA DA SILVA")');
  check('resumo só-leitura abaixo da linha mostra quem faltou, com "não substituído"', /1º Mesário.*JOAO PEDRO.*faltou, não substituído/.test((await resumoLeitura.textContent()).replace(/\s+/g, ' ')));

  check('botão "✅ Marcar devolvido" aparece (deve devolver > 0)', await linhaPresidente.locator('button:has-text("✅ Marcar devolvido")').count() === 1);
  await linhaPresidente.locator('button:has-text("✅ Marcar devolvido")').click();
  await p.waitForTimeout(300);
  const escritasDev = await p.evaluate(() => window.__mock.escritas);
  const logDev = escritasDev.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'mesario_auxilio_alimentacao_devolvido');
  check('log de devolução grava o valor PROPORCIONAL (130), não o pago inteiro (260)', !!logDev && logDev.payload.payload.valor === 130, JSON.stringify(logDev));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18b. Reabrir o modal mostra o que já foi marcado; "👥 Todos presentes"
// não passa pelo modal e zera a devolução ──
{
  const ctx = await b.newContext();
  const m = mock();
  const pres = m.sime_atores.find(a => a.id === 'm5');
  pres.auxilio_alimentacao_pago = true;
  pres.auxilio_alimentacao_valor_pago = 260;
  m.sime_atores.find(a => a.id === 'm6').auxilio_alimentacao_frequencia = 'faltou';
  m.sime_atores.find(a => a.id === 'm7').auxilio_alimentacao_frequencia = 'presente';
  m.sime_atores.find(a => a.id === 'm8').auxilio_alimentacao_frequencia = 'presente';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  const linhaPresidente = p.locator('.m-hist-item:has-text("PRESIDENTE MARIA DA SILVA")');
  await linhaPresidente.locator('button:has-text("❌ Faltou")').click();
  await p.waitForTimeout(250);
  check('reabrir o modal já mostra o 1º Mesário marcado como faltou', await p.locator('#modal-body label:has-text("1º Mesário — JOAO PEDRO")').locator('input[type=checkbox]').isChecked() === true);
  check('e os outros 3 desmarcados', await p.locator('#modal-body label:has-text("Presidente — PRESIDENTE MARIA")').locator('input[type=checkbox]').isChecked() === false);
  await p.click('#modal-body button:has-text("Cancelar")');
  await p.waitForTimeout(200);
  check('cancelar fecha sem gravar nada', await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_atores').length) === 0);

  await linhaPresidente.locator('button:has-text("👥 Todos presentes")').click();
  await p.waitForTimeout(300);
  // "Cancelar" só esconde o overlay (classe "open") — igual a todo outro modal
  // da página, nunca limpa #modal-body no fechamento — então checar o overlay
  // em si é o jeito certo de confirmar que "Todos presentes" não reabriu nada,
  // não contar <label> (que ficariam do modal anterior, só visualmente ocultos).
  check('"Todos presentes" nunca abre o modal', await p.evaluate(() => !document.getElementById('overlay').classList.contains('open')));
  const txtDepois = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('depois de "Todos presentes", some o aviso de deve devolver', !/deve devolver/.test(txtDepois), txtDepois);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18c. Recibo ausente — mesa completa, mas a folha não foi recolhida:
// nunca gera devolução, entra no resumo/filtro próprio ──
{
  const ctx = await b.newContext();
  const m = mock();
  const pres = m.sime_atores.find(a => a.id === 'm5');
  pres.auxilio_alimentacao_pago = true;
  pres.auxilio_alimentacao_valor_pago = 260;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  const linhaPresidente = p.locator('.m-hist-item:has-text("PRESIDENTE MARIA DA SILVA")');
  await linhaPresidente.locator('button:has-text("❌ Faltou")').click();
  await p.waitForTimeout(250);
  // Marca só o recibo — ninguém faltou.
  await p.locator('#modal-body label:has-text("Recibo não foi assinado")').locator('input[type=checkbox]').check();
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(300);

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const updRecibo = escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && 'auxilio_alimentacao_recibo_ausente' in e.payload);
  check('grava recibo ausente=true na linha do Presidente', updRecibo?.payload.auxilio_alimentacao_recibo_ausente === true, JSON.stringify(updRecibo));
  const updFreqNinguem = escritas.filter(e => e.op === 'update' && e.tabela === 'sime_atores' && 'auxilio_alimentacao_frequencia' in e.payload);
  check('mesa completa: todos os 4 gravados como presente (não "faltou")', updFreqNinguem.every(u => u.payload.auxilio_alimentacao_frequencia === 'presente') && updFreqNinguem.length === 4, JSON.stringify(updFreqNinguem));

  const txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('nunca mostra "deve devolver" — ninguém faltou', !/deve devolver/.test(txt), txt);
  check('resumo geral cita "1 com recibo ausente"', /1 com recibo ausente/.test(txt), txt);
  check('card da seção mostra a nota de recibo ausente', /Recibo não foi assinado\/recolhido — mesa funcionou completa/.test(txt), txt);

  // Filtro "📄 Recibo ausente" mostra só esta seção.
  await p.locator('#ra-controle-unificado select').nth(3).selectOption('recibo_ausente');
  await p.waitForTimeout(250);
  const txtFiltro = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  check('filtro "recibo ausente" mostra o Presidente da seção 63', /PRESIDENTE MARIA DA SILVA/.test(txtFiltro));
  check('e não mostra quem não tem recibo ausente marcado', !/COORDENADORA BEATRIZ/.test(txtFiltro), txtFiltro);

  // Desmarcar de volta.
  await p.locator('#ra-controle-unificado select').nth(3).selectOption('');
  await p.waitForTimeout(200);
  await linhaPresidente.locator('button:has-text("❌ Faltou")').click();
  await p.waitForTimeout(250);
  check('reabrir o modal mostra o recibo ainda marcado como ausente', await p.locator('#modal-body label:has-text("Recibo não foi assinado")').locator('input[type=checkbox]').isChecked() === true);
  await p.locator('#modal-body label:has-text("Recibo não foi assinado")').locator('input[type=checkbox]').uncheck();
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(300);
  const escritas2 = await p.evaluate(() => window.__mock.escritas);
  const updDesmarca = escritas2.filter(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'm5' && 'auxilio_alimentacao_recibo_ausente' in e.payload).pop();
  check('desmarcar grava recibo ausente=false', updDesmarca?.payload.auxilio_alimentacao_recibo_ausente === false, JSON.stringify(updDesmarca));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 19. Janela unificada: agrupamento, documento de envio, frequência/
// devolução dentro do modal da pessoa, e QR de devolução no modal e nos 4
// recibos impressos (06/10/2026, pedidos diretos: "uma pagina unificada...
// agrupado por cidade, local de votação e seção... cada modal ao abrir
// poderá ver... data de envio do pix, documento de envio... frequencia da
// mesa receptora... o valor a ser devolvido... se ja foi devolvido o
// documento da devolução... não esqueça de incluir o qrcode" / "ter o
// qrcode, controlar as frequencias e verificar as devoluções... um qrcode
// para a devolução do valor pago"). ──

// 19a. Destino do PIX de devolução — campo próprio na config, opcional,
// persiste em sime_eleicoes.
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  check('campo de chave PIX de devolução nasce vazio', await p.locator('#ra-pix-dev-chave').inputValue() === '');
  check('campo de nome do destinatário nasce vazio', await p.locator('#ra-pix-dev-nome').inputValue() === '');

  await p.fill('#ra-pix-dev-chave', '86999990000');
  await p.fill('#ra-pix-dev-nome', 'Cartório da 7ª Zona');
  // Há DOIS botões "💾 Salvar" na tela (valor/forma + destino da
  // devolução) — alvo preciso pelo onclick, não pelo texto ambíguo.
  await p.click('button[onclick="raSalvarConfigDevolucao()"]');
  await p.waitForTimeout(300);

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const upd = escritas.find(e => e.op === 'update' && e.tabela === 'sime_eleicoes' && 'pix_devolucao_chave' in e.payload);
  check('grava chave e nome do destino da devolução em sime_eleicoes', upd?.payload.pix_devolucao_chave === '86999990000' && upd?.payload.pix_devolucao_nome === 'Cartório da 7ª Zona', JSON.stringify(upd));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// 19b. Agrupamento por cidade/local de votação nas duas listas interativas
// (Controle de pagamento e Frequência e Devolução) — m1 (Presidente, Escola
// A) e c1 (coordenadora, mesma Escola A) caem no MESMO grupo; m5 (Escola
// Municipal Grande do Centro) em outro; quem não resolveu seção (c2/a1/a2/
// j1) vai pro grupo "Sem local definido", sempre por último.
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);

  const cabecalhosPag = await p.locator('#ra-controle-unificado .ra-grupo-cabecalho').allTextContents();
  check('3 grupos no Controle de pagamento (2 com local + "sem local")', cabecalhosPag.length === 3, JSON.stringify(cabecalhosPag));
  check('1º grupo é Campo Maior — Escola A', cabecalhosPag[0] === 'Campo Maior — Escola A', JSON.stringify(cabecalhosPag));
  check('2º grupo é Campo Maior — Escola Municipal Grande do Centro', cabecalhosPag[1] === 'Campo Maior — Escola Municipal Grande do Centro', JSON.stringify(cabecalhosPag));
  check('último grupo é "Sem local definido"', cabecalhosPag[2] === '⚠ Sem local definido', JSON.stringify(cabecalhosPag));
  const txtPag = (await p.locator('#ra-controle-unificado').textContent()).replace(/\s+/g, ' ');
  const posCab = txtPag.indexOf('Campo Maior — Escola A');
  const posCoord = txtPag.indexOf('COORDENADORA BEATRIZ');
  const posPres = txtPag.indexOf('PRESIDENTE MARIA ');
  check('dentro do grupo, COORDENADORA BEATRIZ vem antes de PRESIDENTE MARIA (ordem alfabética)', posCab < posCoord && posCoord < posPres, `${posCab} ${posCoord} ${posPres}`);

  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  const cabecalhosDev = await p.locator('#ra-controle-unificado .ra-grupo-cabecalho').allTextContents();
  check('mesmo agrupamento em Frequência e Devolução', JSON.stringify(cabecalhosDev) === JSON.stringify(cabecalhosPag), JSON.stringify(cabecalhosDev));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// 19c-e. Modal da pessoa: documento de envio, frequência/devolução (mesa ×
// não-mesa), valor a devolver, "já devolveu", documento da devolução, e o
// QR de devolução (só quando o destino está configurado).
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_eleicoes[0].pix_devolucao_chave = '86999990000';
  m.sime_eleicoes[0].pix_devolucao_nome = 'Cartório da 7ª Zona';
  const a1 = m.sime_atores.find(a => a.id === 'a1');
  a1.auxilio_alimentacao_pago = true;
  a1.auxilio_alimentacao_valor_pago = 65;
  a1.auxilio_alimentacao_frequencia = 'faltou';
  a1.auxilio_alimentacao_documento = 'DOC123';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.selectOption('#ra-controle-unificado select >> nth=0', '');
  await p.waitForTimeout(250);

  // c1 (coordenadora, não-mesa, ainda sem pagamento) — botões inline de
  // Presente/Faltou, sem nenhuma seção de devolução (ainda não deve nada).
  await p.locator('.m-hist-item:has-text("COORDENADORA BEATRIZ") b').click();
  await p.waitForTimeout(300);
  check('não-mesa mostra os botões inline ✅ Presente / ❌ Faltou', await p.locator('#modal-body button:has-text("✅ Presente")').count() === 1 && await p.locator('#modal-body button:has-text("❌ Faltou")').count() === 1);
  check('ainda sem pagamento: nenhum aviso de "deve devolver"', !/deve devolver/.test(await p.locator('#modal-body').textContent()));
  check('ainda sem pagamento: nenhuma seção de devolução (checkbox "Já devolveu")', await p.locator('#modal-body:has-text("Já devolveu")').count() === 0);
  await p.click('#modal-body button:has-text("❌ Faltou")');
  await p.waitForTimeout(300);
  const escritasFreq = await p.evaluate(() => window.__mock.escritas);
  const updFreqC1 = escritasFreq.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'c1' && 'auxilio_alimentacao_frequencia' in e.payload);
  check('clicar "❌ Faltou" grava a frequência da própria pessoa (não-mesa)', updFreqC1?.payload.auxilio_alimentacao_frequencia === 'faltou', JSON.stringify(updFreqC1));
  check('botão "❌ Faltou" fica destacado depois do clique', await p.locator('#modal-body button:has-text("❌ Faltou")').evaluate(el => el.className.includes('btn-dark')));
  check('sem pagamento, marcar "faltou" ainda não abre a seção de devolução', await p.locator('#modal-body:has-text("Já devolveu")').count() === 0);
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);

  // m1 (Presidente de mesa) — nunca os botões inline; resumo da mesa +
  // botão que pivota pro modal batch "❌ Faltou" já existente.
  // "PRESIDENTE MARIA" é prefixo de m5 ("PRESIDENTE MARIA DA SILVA..."),
  // por isso o match precisa ser exato aqui.
  await p.locator('.m-hist-item b:text-is("PRESIDENTE MARIA")').click();
  await p.waitForTimeout(300);
  check('mesa (Presidente) nunca mostra o par de botões inline', await p.locator('#modal-body button:has-text("✅ Presente")').count() === 0 && await p.locator('#modal-body button:has-text("❌ Faltou")').count() === 0);
  check('mesa mostra o botão que pivota pro modal de falta por cargo', await p.locator('#modal-body button:has-text("❌ Marcar quem faltou / recibo ausente")').count() === 1);
  check('mesa mostra o resumo dos 4 cargos (📋 Frequência e devolução)', /📋 Frequência e devolução/.test(await p.locator('#modal-body').textContent()));
  await p.click('#modal-body button:has-text("Fechar")');
  await p.waitForTimeout(200);

  // a1 (auxiliar, pago=true, frequencia='faltou') — documento de envio já
  // preenchido, aviso de valor a devolver, checkbox "Já devolveu",
  // documento da devolução, e o QR de devolução (destino já configurado).
  await p.locator('.m-hist-item:has-text("AUXILIAR PEDRO") b').click();
  await p.waitForTimeout(300);
  check('"Documento de envio" vem pré-preenchido com o que já estava salvo', await p.locator('#ra-modal-doc-envio').inputValue() === 'DOC123');
  await p.fill('#ra-modal-doc-envio', 'DOC456');
  await p.locator('#ra-modal-doc-envio').blur();
  await p.waitForTimeout(300);
  const escritasDoc = await p.evaluate(() => window.__mock.escritas);
  const updDoc = escritasDoc.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && 'auxilio_alimentacao_documento' in e.payload);
  check('editar "Documento de envio" salva sozinho (onblur)', updDoc?.payload.auxilio_alimentacao_documento === 'DOC456', JSON.stringify(updDoc));

  const txtModalA1 = await p.locator('#modal-body').textContent();
  check('não-mesa, faltou e já pago: avisa que deve devolver (sem "por membro")', /Faltou e já recebeu.*deve devolver R\$\s*65,00/.test(txtModalA1.replace(/\s+/g, ' ')), txtModalA1);
  check('checkbox "Já devolveu" presente e desmarcado', await p.locator('#modal-body label:has-text("Já devolveu") input[type=checkbox]').isChecked() === false);
  check('campo "Documento da devolução" presente, vazio', await p.locator('#ra-modal-doc-devolucao').inputValue() === '');
  check('QR de devolução desenhado (destino já configurado)', await p.locator('#ra-modal-qr-dev canvas').count() === 1);

  await p.fill('#ra-modal-doc-devolucao', 'DEVOC1');
  await p.locator('#ra-modal-doc-devolucao').blur();
  await p.waitForTimeout(300);
  const escritasDevDoc = await p.evaluate(() => window.__mock.escritas);
  const updDevDoc = escritasDevDoc.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && 'auxilio_alimentacao_devolucao_documento' in e.payload);
  check('editar "Documento da devolução" salva sozinho (onblur)', updDevDoc?.payload.auxilio_alimentacao_devolucao_documento === 'DEVOC1', JSON.stringify(updDevDoc));

  await p.locator('#modal-body label:has-text("Já devolveu") input[type=checkbox]').check();
  await p.waitForTimeout(300);
  const escritasDevolvido = await p.evaluate(() => window.__mock.escritas);
  const updDevolvido = escritasDevolvido.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'a1' && 'auxilio_alimentacao_devolvido' in e.payload);
  check('marcar "Já devolveu" grava auxilio_alimentacao_devolvido=true', updDevolvido?.payload.auxilio_alimentacao_devolvido === true, JSON.stringify(updDevolvido));
  const txtDepoisDevolvido = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('depois de devolvido, o aviso de "deve devolver" some (já resolvido)', !/deve devolver/.test(txtDepoisDevolvido), txtDepoisDevolvido);
  check('mas a seção de devolução continua visível (documento + QR, é histórico)', await p.locator('#modal-body label:has-text("Já devolveu") input[type=checkbox]').isChecked() === true && await p.locator('#ra-modal-qr-dev canvas').count() === 1);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// 19f. Sem destino de devolução configurado — nenhum dos quatro recibos
// ganha o bloco de QR (confirmação explícita de retrocompatibilidade, além
// dos 202 checks pré-existentes que já passavam sem regressão).
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Mesa Receptora")');
  await p.waitForTimeout(250);
  check('sem destino configurado: Mesa Receptora não tem nenhum bloco de QR de devolução', await p.locator('#print-area .ra-qr-dev-impresso').count() === 0);
  check('nem menção a "PIX para devolução" no HTML', !/PIX para devolução/.test(await p.locator('#print-area').innerHTML()));

  await p.click('button:has-text("Imprimir recibos — Coordenadores")');
  await p.waitForTimeout(250);
  check('sem destino configurado: Coordenadores também não tem o bloco', await p.locator('#print-area .ra-qr-dev-impresso').count() === 0);

  await p.click('button:has-text("Imprimir recibos — Sábado e Domingo")');
  await p.waitForTimeout(250);
  check('sem destino configurado: Auxiliares (2 páginas) também não tem o bloco', await p.locator('#print-area .ra-qr-dev-impresso').count() === 0);

  await p.click('button:has-text("Imprimir recibo — Junta Eleitoral")');
  await p.waitForTimeout(250);
  check('sem destino configurado: Junta também não tem o bloco', await p.locator('#print-area .ra-qr-dev-impresso').count() === 0);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// 19g. Com destino configurado — os 4 recibos ganham o QR de devolução,
// cada canvas com id próprio (nunca colide) e a legenda certa por
// seção/local/zona.
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_eleicoes[0].pix_devolucao_chave = '86999990000';
  m.sime_eleicoes[0].pix_devolucao_nome = 'Cartório da 7ª Zona';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Mesa Receptora")');
  await p.waitForTimeout(250);
  check('Mesa Receptora: 3 blocos de QR de devolução (1 por seção)', await p.locator('#print-area .ra-qr-dev-impresso').count() === 3);
  for (let i = 0; i < 3; i++) {
    check(`Mesa Receptora: canvas próprio #ra-qr-dev-canvas-${i} com o QR desenhado`, await p.locator(`#ra-qr-dev-canvas-${i} canvas`).count() === 1);
  }
  const txtMesa = (await p.locator('#print-area').innerHTML());
  check('legenda cita "Devolução - Seção 5"', /Devolução - Seção 5\b/.test(txtMesa));
  check('legenda cita "Devolução - Seção 12"', /Devolução - Seção 12\b/.test(txtMesa));
  check('legenda cita "Devolução - Seção 63"', /Devolução - Seção 63\b/.test(txtMesa));

  await p.click('button:has-text("Imprimir recibos — Coordenadores")');
  await p.waitForTimeout(250);
  check('Coordenadores: 2 blocos de QR (Escola A + Sem local definido)', await p.locator('#print-area .ra-qr-dev-impresso').count() === 2);
  const txtCoord = (await p.locator('#print-area').innerHTML());
  check('legenda cita "Devolução - Escola A"', /Devolução - Escola A\b/.test(txtCoord));
  check('legenda cita "Devolução - ⚠ Sem local definido"', /Devolução - ⚠ Sem local definido/.test(txtCoord));

  await p.click('button:has-text("Imprimir recibos — Sábado e Domingo")');
  await p.waitForTimeout(250);
  check('Auxiliares: 2 blocos de QR (um por página — Sábado e Domingo)', await p.locator('#print-area .ra-qr-dev-impresso').count() === 2);
  check('cada página tem o próprio canvas (0 e 1), sem colisão', await p.locator('#ra-qr-dev-canvas-0 canvas').count() === 1 && await p.locator('#ra-qr-dev-canvas-1 canvas').count() === 1);
  const txtAux = (await p.locator('#print-area').innerHTML());
  check('as duas páginas citam a zona (7ª Zona Eleitoral — Campo Maior)', (txtAux.match(/Devolução - 7ª Zona Eleitoral — Campo Maior/g) || []).length === 2, txtAux.slice(0, 200));

  await p.click('button:has-text("Imprimir recibo — Junta Eleitoral")');
  await p.waitForTimeout(250);
  check('Junta: 1 bloco de QR', await p.locator('#print-area .ra-qr-dev-impresso').count() === 1);
  check('canvas #ra-qr-dev-canvas-0 desenhado pra Junta também', await p.locator('#ra-qr-dev-canvas-0 canvas').count() === 1);

  // Payload da devolução — sempre valor em aberto (nunca a fração calculada
  // na hora de imprimir, que varia por pessoa) e descrição em ASCII.
  const payloadDev = await p.evaluate(() =>
    window.raPayloadDevolucao({ pixDevolucaoChave: '86999990000', pixDevolucaoNome: 'Cartório da 7ª Zona' }, 'Eleições 2026 - Devolução - Seção 5'));
  check('payload de devolução nunca inclui o campo de valor (54) — fica em aberto', !payloadDev.includes('5402') && !/54\d{2}\d+\.\d{2}/.test(payloadDev), payloadDev);
  check('payload de devolução contém a descrição em ASCII', payloadDev.includes('ELEICOES 2026 - DEVOLUCAO - SECAO 5'), payloadDev);
  const semDestino = await p.evaluate(() => window.raPayloadDevolucao({ pixDevolucaoChave: '' }, 'teste'));
  check('sem chave de devolução configurada, raPayloadDevolucao devolve null', semDestino === null);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 20. "Quantos e quais PIX já foram realizados" por pessoa, no mesmo
// aviso de papel duplicado (08/10/2026, pedido direto: "por mesario tem
// como informar quantos e quais pix foram realizados para ele"). Só tem
// valor informativo quando há papel duplicado (Presidente + Coordenador,
// mesmo caso do bloco 9/11) — cada papel listado mostra o próprio status
// (✅ pago/⏳ ainda não pago), e uma linha de resumo soma quantos dos
// papéis da MESMA pessoa já têm PIX pago. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_atores.push({ id: 'c3', nome_completo: 'COORDENADORA DUPLICADA MARIA', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's2', inscricao_eleitoral: '111111111111', zona_id: 'z7', ativo: true });
  // PRESIDENTE MARIA (m1) já pago — a Coordenadora duplicada (c3) ainda não.
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_pago = true;
  m.sime_atores.find(a => a.id === 'm1').auxilio_alimentacao_valor_pago = 260;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Controle de pagamento e frequência")');
  await p.waitForTimeout(300);
  await p.selectOption('#ra-controle-unificado select', '');
  await p.waitForTimeout(200);

  const linhaPresidente = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —")').textContent()).replace(/\s+/g, ' ');
  check('linha do Presidente mostra que a Coordenadora duplicada ainda não foi paga', /Coordenador de Acessibilidade \(Seção 12\) \(⏳ ainda não pago\)/.test(linhaPresidente), linhaPresidente);
  check('linha do Presidente resume 1 de 2 papéis já pagos, com o total', /💰 1 de 2 papel\(éis\) desta pessoa já com PIX pago — total R\$ 260,00/.test(linhaPresidente), linhaPresidente);

  const linhaCoord = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA")').textContent()).replace(/\s+/g, ' ');
  check('linha da Coordenadora mostra que o Presidente duplicado já foi pago, com o valor', /Presidente \(Seção 5\) \(✅ pago R\$ 260,00\)/.test(linhaCoord), linhaCoord);
  check('o mesmo resumo (1 de 2) aparece na linha da Coordenadora', /💰 1 de 2 papel\(éis\) desta pessoa já com PIX pago — total R\$ 260,00/.test(linhaCoord), linhaCoord);

  const linhaSemConflito = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA BEATRIZ")').textContent()).replace(/\s+/g, ' ');
  check('quem não tem papel duplicado não mostra o resumo de PIX', !/papel\(éis\) desta pessoa já com PIX pago/.test(linhaSemConflito), linhaSemConflito);

  // Mesmo resumo, dentro do modal de detalhe da Coordenadora.
  await p.click('#ra-controle-unificado .m-hist-item:has-text("COORDENADORA DUPLICADA MARIA") b');
  await p.waitForTimeout(300);
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('modal da Coordenadora mostra o Presidente duplicado já pago e o resumo 1 de 2', /Presidente \(Seção 5\) \(✅ pago R\$ 260,00\)/.test(modalTxt) && /💰 1 de 2 papel\(éis\) desta pessoa já com PIX pago — total R\$ 260,00/.test(modalTxt), modalTxt.slice(0, 500));

  // Marcar o 2º papel (Coordenadora) como pago atualiza o resumo pra 2 de 2.
  await p.click('#modal-body input[type=checkbox]');
  await p.waitForTimeout(200);
  const linhaPresidenteDepois = (await p.locator('#ra-controle-unificado .m-hist-item:has-text("PRESIDENTE MARIA —")').textContent()).replace(/\s+/g, ' ');
  check('depois de pagar os dois papéis, o resumo vira 2 de 2 (somando os dois valores — 260 do Presidente + 65 sugerido da Coordenadora)', /💰 2 de 2 papel\(éis\) desta pessoa já com PIX pago — total R\$ 325,00/.test(linhaPresidenteDepois), linhaPresidenteDepois);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
