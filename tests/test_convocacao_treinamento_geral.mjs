// Testa o painel "📊 Visão geral — presencial + online" da aba "🎓
// Treinamento" (sime_turmas.js, 15/09/2026, pedido direto: "quero uma
// visão só, quem faltou, quem foi presencial, quem fez online") — cruza a
// presença nas turmas presenciais com o status do treinamento online numa
// lista só, puramente leitura sobre o mesmo `tuDados` já carregado (nada
// escreve aqui — mudar status continua sendo pelas ações da turma ou do
// painel "🖥️ Treinamento Online").
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
    sime_turmas: [
      { id: 't1', zona_id: 'z7', numero: '001', nome: 'TURMA 1', data_treinamento: '2026-09-14', ativo: true },
    ],
    sime_turma_pessoas: [
      // ANA foi presencial de verdade
      { id: 'tp1', turma_id: 't1', papel: 'aluno', inscricao: '111111111111', nome: 'ANA PRESENCIAL', presenca: 'presente', ator_id: 'p1' },
      // BETO faltou na presencial — mas fez o online depois (2 canais, o online conta como treinado)
      { id: 'tp2', turma_id: 't1', papel: 'aluno', inscricao: '222222222222', nome: 'BETO FALTOU', presenca: 'ausente', ator_id: 'p2' },
      // CAIO ainda está pendente na turma (data não passou / não marcado) — nenhum sinal conclusivo ainda
      { id: 'tp3', turma_id: 't1', papel: 'aluno', inscricao: '333333333333', nome: 'CAIO PENDENTE', presenca: 'pendente', ator_id: 'p3' },
    ],
    sime_logs: [],
    sime_atores: [
      { id: 'p1', nome_completo: 'ANA PRESENCIAL', inscricao_eleitoral: '111111111111', telefone_whatsapp: '5586999990001', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: null, confirmacao: 'confirmado', zona_id: 'z7', ativo: true, treinamento_online_status: 'nao_iniciado', treinamento_online_concluido_em: null },
      { id: 'p2', nome_completo: 'BETO FALTOU', inscricao_eleitoral: '222222222222', telefone_whatsapp: '5586999990002', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: null, confirmacao: 'pendente', zona_id: 'z7', ativo: true, treinamento_online_status: 'concluido', treinamento_online_concluido_em: '2026-09-13T10:00:00.000Z' },
      { id: 'p3', nome_completo: 'CAIO PENDENTE', inscricao_eleitoral: '333333333333', telefone_whatsapp: '5586999990003', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: null, confirmacao: 'pendente', zona_id: 'z7', ativo: true, treinamento_online_status: 'nao_iniciado', treinamento_online_concluido_em: null },
      // DORA nunca apareceu em turma nenhuma e nunca fez o online — sem nenhum treinamento
      { id: 'p4', nome_completo: 'DORA SEM NADA', inscricao_eleitoral: '444444444444', telefone_whatsapp: '5586999990004', funcao: 'mesario', funcao_mesa: '2º Mesário', secao_id: null, confirmacao: 'pendente', zona_id: 'z7', ativo: true, treinamento_online_status: 'em_andamento', treinamento_online_concluido_em: null },
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
async function abrirTreinamento(p) {
  await p.click('#tab-turmas-btn');
  await p.waitForTimeout(400);
}

// ── 1. Nasce aberto, mostra as 4 pessoas com os dois sinais cruzados ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  check('painel "Visão geral" nasce aberto (botão de fechar visível)', await p.locator('button:has-text("▾ 📊 Visão geral")').isVisible());

  const txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('lista mostra as 4 pessoas', /ANA PRESENCIAL/.test(txt) && /BETO FALTOU/.test(txt) && /CAIO PENDENTE/.test(txt) && /DORA SEM NADA/.test(txt), txt.slice(0, 800));

  const cardAna = p.locator('.tu-geral-pessoas .import-card', { hasText: 'ANA PRESENCIAL' });
  const txtAna = (await cardAna.textContent()).replace(/\s+/g, ' ');
  check('Ana: presencial "Presente" + situação geral "Treinado(a)"', /✅ Presente/.test(txtAna) && /Treinado\(a\)/.test(txtAna), txtAna);
  check('Ana: turma e data aparecem', /Turma 001/.test(txtAna) && /14\/09\/2026/.test(txtAna), txtAna);

  const cardBeto = p.locator('.tu-geral-pessoas .import-card', { hasText: 'BETO FALTOU' });
  const txtBeto = (await cardBeto.textContent()).replace(/\s+/g, ' ');
  check('Beto: presencial "Faltou" MAS online "Concluído" conta como Treinado — os dois canais aparecem', /❌ Faltou/.test(txtBeto) && /✅ Concluído/.test(txtBeto) && /Treinado\(a\)/.test(txtBeto), txtBeto);

  const cardCaio = p.locator('.tu-geral-pessoas .import-card', { hasText: 'CAIO PENDENTE' });
  const txtCaio = (await cardCaio.textContent()).replace(/\s+/g, ' ');
  check('Caio: presencial "Pendente", online "Não iniciado" → situação "Em andamento" (turma agendada, ainda sem confirmação)', /⏳ Pendente/.test(txtCaio) && /Em andamento/.test(txtCaio), txtCaio);

  const cardDora = p.locator('.tu-geral-pessoas .import-card', { hasText: 'DORA SEM NADA' });
  const txtDora = (await cardDora.textContent()).replace(/\s+/g, ' ');
  check('Dora: não é aluno de nenhuma turma + online "fazendo" → "Em andamento", nunca "sem nenhum" enquanto o online está em curso', /Não é aluno de nenhuma turma/.test(txtDora) && /🖥️ Fazendo/.test(txtDora) && /Em andamento/.test(txtDora), txtDora);

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Filtro por situação: presencial confirmado / faltou / online / sem nenhum ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  const selectSituacao = p.locator('select').filter({ has: p.locator('option[value="sem_nenhum"]') }).first();

  await selectSituacao.selectOption('presente');
  await p.waitForTimeout(150);
  let txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "Foi presencial": só ANA (única com presenca=presente)', /ANA/.test(txt) && !/BETO/.test(txt) && !/CAIO/.test(txt) && !/DORA/.test(txt), txt.slice(0, 500));

  await selectSituacao.selectOption('faltou');
  await p.waitForTimeout(150);
  txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "Faltou na presencial": só BETO (mesmo já tendo concluído o online)', /BETO/.test(txt) && !/ANA/.test(txt) && !/CAIO/.test(txt) && !/DORA/.test(txt), txt.slice(0, 500));

  await selectSituacao.selectOption('online');
  await p.waitForTimeout(150);
  txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "Fez o online": só BETO (único treinamento_online_status=concluido)', /BETO/.test(txt) && !/ANA/.test(txt) && !/CAIO/.test(txt) && !/DORA/.test(txt), txt.slice(0, 500));

  await selectSituacao.selectOption('sem_nenhum');
  await p.waitForTimeout(150);
  txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "Sem nenhum treinamento": CAIO e DORA (nenhum concluiu nada ainda) — nunca ANA/BETO', /CAIO/.test(txt) && /DORA/.test(txt) && !/ANA/.test(txt) && !/BETO/.test(txt), txt.slice(0, 500));

  await selectSituacao.selectOption('');
  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Busca por nome e por título de eleitor + filtro por função ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  const busca = p.locator('.tu-geral-pessoas').locator('xpath=preceding::input[@type="text"][1]');
  // campo de busca é o input imediatamente acima da lista, dentro do card de filtros do painel Geral
  const inputBusca = p.locator('input[placeholder="Buscar por nome ou título de eleitor…"]').first();
  await inputBusca.fill('caio');
  await p.waitForTimeout(300);
  let txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por nome', /CAIO/.test(txt) && !/ANA/.test(txt) && !/BETO/.test(txt) && !/DORA/.test(txt), txt.slice(0, 500));
  await inputBusca.fill('');

  await inputBusca.fill('444444444444');
  await p.waitForTimeout(300);
  txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por título de eleitor', /DORA/.test(txt) && !/ANA/.test(txt) && !/BETO/.test(txt) && !/CAIO/.test(txt), txt.slice(0, 500));
  await inputBusca.fill('');
  await p.waitForTimeout(200);

  const selectFuncao = p.locator('select').filter({ has: p.locator('option', { hasText: 'Coordenador' }) }).first();
  await selectFuncao.selectOption('coord_acessibilidade');
  await p.waitForTimeout(150);
  txt = (await p.locator('.tu-geral-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro por função: só CAIO (coord_acessibilidade)', /CAIO/.test(txt) && !/ANA/.test(txt) && !/BETO/.test(txt) && !/DORA/.test(txt), txt.slice(0, 500));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Nome clicável abre o modal compartilhado de "Contatar mesários" ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  await p.locator('.tu-geral-pessoas').locator('text=ANA PRESENCIAL').click();
  await p.waitForTimeout(300);
  check('clicar no nome abre o modal de pessoa (mesmo modal de Contatar mesários)', await p.locator('.m-title, .modal').first().isVisible().catch(() => false));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Fechar/reabrir o painel; e o botão fechado mostra as 4 contagens ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  await p.click('button:has-text("▾ 📊 Visão geral")');
  await p.waitForTimeout(200);
  let txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('fechado: contagem no botão (1 presencial, 1 online, 2 sem nenhum)', /✅ 1 presencial.*🖥️ 1 online.*❌ 2 sem nenhum treinamento/.test(txt), txt.slice(0, 600));

  await p.click('button:has-text("▸ 📊 Visão geral")');
  await p.waitForTimeout(200);
  check('reabre e mostra a lista de novo', await p.locator('.tu-geral-pessoas').isVisible());

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Exportar CSV não quebra (gera um download) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await abrirTreinamento(p);

  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.click('button:has-text("⬇️ Exportar CSV")'),
  ]);
  check('exportar CSV gera um download com nome sime_treinamento_geral_*', /sime_treinamento_geral_/.test(download.suggestedFilename()), download.suggestedFilename());

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
