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
  ];
  const atores = [
    { id: 'm1', nome_completo: 'PRESIDENTE MARIA', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's1', inscricao_eleitoral: '111111111111', zona_id: 'z7', ativo: true },
    { id: 'm2', nome_completo: 'MESARIO 1 JOAO', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: 's1', inscricao_eleitoral: '222222222222', zona_id: 'z7', ativo: true },
    { id: 'm3', nome_completo: 'MESARIO 2 ANA', funcao: 'mesario', funcao_mesa: '2º Mesário', secao_id: 's2', inscricao_eleitoral: '333333333333', zona_id: 'z7', ativo: true },
    { id: 'm4', nome_completo: 'MESARIO INATIVO NUNCA APARECE', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's2', inscricao_eleitoral: '999999999999', zona_id: 'z7', ativo: false },
    { id: 'c1', nome_completo: 'COORDENADORA BEATRIZ', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's1', inscricao_eleitoral: '444444444444', zona_id: 'z7', ativo: true },
    { id: 'c2', nome_completo: 'COORDENADOR CARLOS SEM LOCAL', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '555555555555', zona_id: 'z7', ativo: true },
    { id: 'a1', nome_completo: 'AUXILIAR PEDRO', funcao: 'auxiliar_eleicao', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '666666666666', zona_id: 'z7', ativo: true },
    { id: 'a2', nome_completo: 'AUXILIAR LUCIA', funcao: 'auxiliar_eleicao', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '777777777777', zona_id: 'z7', ativo: true },
    { id: 'j1', nome_completo: 'JUNTA FERNANDO', funcao: 'junta_eleitoral', funcao_mesa: null, secao_id: null, inscricao_eleitoral: '888888888888', zona_id: 'z7', ativo: true },
  ];
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições Municipais 2026' }],
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
  check('mesa receptora conta 3 (mesarios ativos, o inativo nunca entra)', /Mesa Receptora \(3\)/.test(txt), txt.slice(0, 400));
  check('coordenadores conta 2', /Coordenador\(a\) de Acessibilidade \(2\)/.test(txt), txt.slice(0, 400));
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

// ── 3. Imprimir recibos — Mesa Receptora: agrupado por local, ordem de
//      cargo, SUBSTITUIÇÕES + Total pago/Suprido, log de auditoria ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-alimentacao-btn');
  await p.waitForTimeout(400);

  await p.click('button:has-text("Imprimir recibos — Mesa Receptora")');
  await p.waitForTimeout(300);

  check('window.print() foi chamado', await p.evaluate(() => window.__printCalls) === 1);
  const html = await p.locator('#print-area').innerHTML();
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('mostra os dois locais (Escola A e Escola B)', /Escola A/.test(txt) && /Escola B/.test(txt), txt.slice(0, 500));
  check('mostra seção/nome/inscrição dos 3 mesários ativos', /5.*111111111111.*PRESIDENTE MARIA/.test(txt) && /MESARIO 1 JOAO/.test(txt) && /12.*333333333333.*MESARIO 2 ANA/.test(txt), txt.slice(0, 800));
  check('mesário inativo nunca aparece no recibo', !/MESARIO INATIVO/.test(txt));
  check('Presidente vem antes de 1º Mesário na mesma mesa (ordem de cargo)', txt.indexOf('PRESIDENTE MARIA') < txt.indexOf('MESARIO 1 JOAO'));
  check('bloco de SUBSTITUIÇÕES presente', /SUBSTITUIÇÕES \(preencher com letra de forma\)/.test(txt));
  check('rodapé Total pago / Local / Data / Suprido presente', /Total pago/.test(txt) && /Suprido \(carimbo e assinatura\)/.test(txt));
  check('mostra forma/valor do auxílio (default)', /DINHEIRO/.test(txt) && /R\$ 65,00/.test(txt));

  const escritas = await p.evaluate(() => window.__mock.escritas);
  const logMesa = escritas.find(e => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'recibo_alimentacao_mesa_impresso');
  check('log de auditoria gravado com quantidade certa', !!logMesa && logMesa.payload.payload.quantidade === 3, JSON.stringify(logMesa));

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
  check('rótulo de função correto', /Coordenador\(a\) de Acessibilidade/.test(txt));

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
  check('rótulo de função "Auxiliar de Eleição"', /Auxiliar de Eleição/.test(txt));
  check('rodapé com Zona (lista geral, sem local de votação)', /Zona/.test(txt) && /7ª Zona Eleitoral/.test(txt));

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

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
