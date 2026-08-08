// Testa a integração da Fase 4 em SIME_instalador.html: login token+PIN
// (novo) + sincronização de chegada/posicionamento/instalação/problema via
// sime_acao_mesa (reaproveitando a mesma RPC do mesário).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// Estas suítes exercitam o fluxo COM PIN. A operação suprimiu o PIN por ora
// (SIME_CONFIG.exigirPin=false), mas o caminho continua no código e volta
// quando o cartório quiser — então aqui a configuração é fixada, em vez de
// deixar a suíte seguir um flag de produção que muda debaixo dela.
const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;


const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return resolve({ data: rows, error: null }); }
}
export function createClient(url, key, opts) {
  return {
    __authHeader: opts?.global?.headers?.Authorization || null,
    from(table) { return new QB(table); },
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      if (window.__mockConfig.rpcShouldFail) return Promise.resolve({ data: null, error: { message: 'mock rpc fail' } });
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

async function newPage(ctx, mockConfig) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-17', numero: 17, local_nome: 'Col. Est. Profª Raimundinho Andrade', municipio: 'Campo Maior', eleitores: 118, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

async function login(p) {
  await p.fill('#login-token', 'INST001');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
}

// ── 1. Login + toggle "chegou" (s1) sincroniza via sime_acao_mesa ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'instalador',
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_instalador.html');
  await login(p);
  await p.waitForTimeout(300);

  await p.click('.ck.s1'); // marca "chegou" da 1ª seção (0017)
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_urna_chegou === true));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const chegouCall = calls.find(c => c.params?.p_urna_chegou === true);
  check('toggle "chegou" chama sime_acao_mesa com p_urna_chegou=true', !!chegouCall);
  check('payload usa secao_id/eleicao_id reais e origem instalador', chegouCall.params.p_secao_id === 'sec-uuid-17' && chegouCall.params.p_eleicao_id === 'ele-uuid-1' && chegouCall.params.p_origem === 'instalador');
  check('badge de sync visível após login', await p.evaluate(() => document.getElementById('sync-badge').style.display !== 'none'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Toggle de problema ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'instalador',
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_instalador.html');
  await login(p);
  await p.waitForTimeout(300);
  await p.click('.prob-btn');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_problema_instalacao === true));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('registrar problema propaga p_problema_instalacao=true', calls.some(c => c.params?.p_problema_instalacao === true));
  await ctx.close();
}

// ── 3. Falha de rede → enfileira no IndexedDB, sem travar ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'instalador',
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_instalador.html');
  await login(p);
  await p.waitForTimeout(300);
  await p.click('.ck.s2');
  await p.waitForTimeout(300);
  const pendentes = await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('sime_offline', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('queue', 'readonly');
      const getAllReq = tx.objectStore('queue').index('status').getAll('pendente');
      getAllReq.onsuccess = () => resolve(getAllReq.result.length);
      getAllReq.onerror = () => resolve(-1);
    };
    req.onerror = () => resolve(-1);
  }));
  check('rpc falhando enfileira no IndexedDB', pendentes >= 1, 'pendentes=' + pendentes);
  check('zero erros JS não tratados com rpc falhando', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Continuar offline: nenhuma chamada rpc, UI continua funcionando ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => { await route.abort('failed'); });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_instalador.html');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.click('.ck.s1');
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('continuar offline: nenhuma chamada rpc (sem sessão)', calls.length === 0, 'calls=' + calls.length);
  check('continuar offline: checkbox ainda marca localmente', await p.evaluate(() => document.querySelector('.ck.s1').classList.contains('on')));
  check('continuar offline: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 5. Token com escopo real (secoes) substitui a lista de exemplo ──
// Achado crítico da auditoria: SECOES era hardcoded e nunca era trocada pela
// rota de verdade — todo instalador via os mesmos dados de exemplo. A sessão
// (sime-login) devolve `secoes` (comentário em sime_campo_auth.js confirma
// que mesário/instalador/mídias usam esse campo); resolverEscopo() precisa
// filtrar getSecoes() por ele e chamar window.aplicarSecoesReais().
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  // Duas seções reais da rota deste instalador — nenhuma delas é a '0017' do
  // exemplo hardcoded, então só aparecerem na tela prova que a troca ocorreu.
  cfg.sime_secoes = [
    { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 300, ativo: true, parada: null, sime_rotas: null },
    { id: 'sec-uuid-64', numero: 64, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 280, ativo: true, parada: null, sime_rotas: null },
    // Seção real da zona que NÃO pertence à rota deste instalador — não pode aparecer.
    { id: 'sec-uuid-99', numero: 99, local_nome: 'Fora da rota', municipio: 'Campo Maior', eleitores: 50, ativo: true, parada: null, sime_rotas: null },
  ];
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'instalador',
      secoes: ['0063', '0064'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_instalador.html');
  await login(p);
  await p.waitForTimeout(300);

  const cards = await p.evaluate(() => [...document.querySelectorAll('.sec-card')].map(c => c.dataset.sec));
  check('troca pra rota real: mostra só as seções do token (0063, 0064)', JSON.stringify(cards.sort()) === JSON.stringify(['0063', '0064']), JSON.stringify(cards));
  check('não mostra a seção de exemplo (0017)', !cards.includes('0017'), JSON.stringify(cards));
  check('não mostra seção real fora da rota deste instalador (0099)', !cards.includes('0099'), JSON.stringify(cards));

  await p.click('.ck.s1'); // marca "chegou" da 1ª seção real da lista (0063)
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_urna_chegou === true));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const chegouCall = calls.find(c => c.params?.p_urna_chegou === true);
  check('sincroniza com o UUID real da seção 0063 (não a de exemplo)', chegouCall?.params?.p_secao_id === 'sec-uuid-63', JSON.stringify(chegouCall));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
