// Testa o painel "🖥️ Treinamento Online" da aba "🎓 Treinamento"
// (sime_turmas.js, 15/09/2026, pedido direto: "quero poder indicar quem
// fez e concluiu o treinamento online") — deliberadamente separado das
// turmas presenciais (sem turma/data/local, é um status por pessoa em
// sime_atores).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  contains(c,v){ this.f['__contains_'+c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  upsert(p){
    window.__mock.escritas.push({ op:'upsert', tabela:this.t, payload:p });
    return Promise.resolve({ error:null, data:Array.isArray(p)?p:[p] });
  }
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
      window.__mock.rpcChamadas.push({ name, params });
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-15T15:30:00.000Z', error:null });
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
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
    sime_turmas: [],
    sime_turma_pessoas: [],
    sime_logs: [],
    sime_atores: [
      { id: 'p1', nome_completo: 'PEDRO NAO INICIOU', inscricao_eleitoral: '111111111111', telefone_whatsapp: '5586999990001', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: null, confirmacao: 'pendente', zona_id: 'z7', ativo: true, treinamento_online_status: 'nao_iniciado', treinamento_online_concluido_em: null },
      { id: 'p2', nome_completo: 'JOANA FAZENDO', inscricao_eleitoral: '222222222222', telefone_whatsapp: '5586999990002', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: null, confirmacao: 'pendente', zona_id: 'z7', ativo: true, treinamento_online_status: 'em_andamento', treinamento_online_concluido_em: null },
      { id: 'p3', nome_completo: 'CARLOS CONCLUIU', inscricao_eleitoral: '333333333333', telefone_whatsapp: '5586999990003', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: null, confirmacao: 'confirmado', zona_id: 'z7', ativo: true, treinamento_online_status: 'concluido', treinamento_online_concluido_em: '2026-09-12T10:00:00.000Z' },
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
async function abrirOnline(p) {
  await p.click('#tab-turmas-btn');
  await p.waitForTimeout(400);
  await p.click('button:has-text("🖥️ Treinamento Online")');
  await p.waitForTimeout(200);
}

// ── 1. Contagem no botão fechado + lista com os 3 status corretos ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-turmas-btn');
  await p.waitForTimeout(400);

  let txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('botão fechado mostra contagem (1 concluído, 1 fazendo, 1 não iniciado)', /✅ 1 concluído.*🖥️ 1 fazendo.*⏳ 1 não iniciado/.test(txt), txt.slice(0, 600));

  await abrirOnline(p);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('lista mostra as 3 pessoas', /PEDRO NAO INICIOU/.test(txt) && /JOANA FAZENDO/.test(txt) && /CARLOS CONCLUIU/.test(txt), txt.slice(0, 500));
  check('badge "Não iniciado" pro Pedro / "Fazendo" pra Joana / "Concluído" pro Carlos',
    /⏳ Não iniciado/.test(txt) && /🖥️ Fazendo/.test(txt) && /✅ Concluído/.test(txt));
  check('data de conclusão aparece pro Carlos', /Concluído em 12\/09\/2026/.test(txt), txt.slice(0, 500));
  check('função de apoio logístico rotulada (Carlos, coord_acessibilidade)', /Coordenador\(a\) de Acessibilidade/.test(txt));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Marcar status — grava no banco, loga com ator_id, atualiza a tela ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await abrirOnline(p);

  // Pedro (não iniciado) → marca "Fazendo"
  const cardPedro = p.locator('.cm-lista-pessoas .import-card', { hasText: 'PEDRO NAO INICIOU' });
  await cardPedro.locator('button:has-text("🖥️ Fazendo")').click();
  await p.waitForTimeout(250);

  const escrita = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_atores' && e.filtro.id === 'p1'));
  check('grava update em sime_atores com o status certo', escrita?.payload?.treinamento_online_status === 'em_andamento', JSON.stringify(escrita));
  check('sem data de conclusão ao marcar "fazendo"', escrita?.payload?.treinamento_online_concluido_em === null, JSON.stringify(escrita));

  const logGravado = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'mesario_treinamento_online_status' && l.payload?.ator_id === 'p1'));
  check('log gravado com ator_id, status e autor', logGravado?.payload?.status === 'em_andamento' && !!logGravado?.payload?.autor, JSON.stringify(logGravado));

  const txt = (await cardPedro.textContent()).replace(/\s+/g, ' ');
  check('botão "Fazendo" fica destacado (btn-dark) pro Pedro depois do clique',
    await cardPedro.locator('button:has-text("🖥️ Fazendo")').evaluate(el => el.classList.contains('btn-dark')));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Concluir grava data; desmarcar de volta pra "Não iniciado" limpa a data ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirOnline(p);

  const cardJoana = p.locator('.cm-lista-pessoas .import-card', { hasText: 'JOANA FAZENDO' });
  await cardJoana.locator('button:has-text("✅ Concluído")').click();
  await p.waitForTimeout(250);
  let escrita = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.filtro.id === 'p2').at(-1));
  check('concluir grava treinamento_online_concluido_em (sime_now)', escrita?.payload?.treinamento_online_concluido_em === '2026-09-15T15:30:00.000Z', JSON.stringify(escrita));

  await cardJoana.locator('button:has-text("⏳ Não iniciado")').click();
  await p.waitForTimeout(250);
  escrita = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.filtro.id === 'p2').at(-1));
  check('voltar pra "não iniciado" limpa a data de conclusão — nunca deixa timestamp mentindo', escrita?.payload?.treinamento_online_status === 'nao_iniciado' && escrita?.payload?.treinamento_online_concluido_em === null, JSON.stringify(escrita));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Filtro por status, por função, e busca por nome/título ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirOnline(p);

  await p.selectOption('#tu-online-filtro-status', 'concluido');
  await p.waitForTimeout(150);
  let txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro status=concluído: só Carlos', /CARLOS/.test(txt) && !/PEDRO/.test(txt) && !/JOANA/.test(txt), txt.slice(0, 400));
  await p.selectOption('#tu-online-filtro-status', '');

  await p.selectOption('#tu-online-filtro-funcao', 'coord_acessibilidade');
  await p.waitForTimeout(150);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro função=coordenador de acessibilidade: só Carlos', /CARLOS/.test(txt) && !/PEDRO/.test(txt) && !/JOANA/.test(txt), txt.slice(0, 400));
  await p.selectOption('#tu-online-filtro-funcao', '');

  await p.fill('#tu-online-busca', 'joana');
  await p.waitForTimeout(300);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por nome', /JOANA/.test(txt) && !/PEDRO/.test(txt) && !/CARLOS/.test(txt), txt.slice(0, 400));
  await p.fill('#tu-online-busca', '');

  await p.fill('#tu-online-busca', '333333333333');
  await p.waitForTimeout(300);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por título de eleitor', /CARLOS/.test(txt) && !/PEDRO/.test(txt) && !/JOANA/.test(txt), txt.slice(0, 400));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Nome clicável abre o modal compartilhado de "Contatar mesários" ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirOnline(p);

  await p.click('text=PEDRO NAO INICIOU');
  await p.waitForTimeout(300);
  check('clicar no nome abre o modal de pessoa (mesmo modal de Contatar mesários)', await p.locator('.m-title, .modal').first().isVisible().catch(() => false));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
