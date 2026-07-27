// Testa a integração da Fase 4 em SIME_midias.html: login token+PIN (novo);
// a fila offline própria do arquivo (IndexedDB) continua sendo a autoridade
// local — syncAction() agora também tenta propagar pro Supabase via
// sime_acao_midia quando há sessão.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

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
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-1', numero: 1, local_nome: 'Centro Ed. JA Mulata Lima', municipio: 'Campo Maior', eleitores: 100, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

async function login(p) {
  await p.fill('#login-token', 'MID001');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
}

// ── 1. Login + confirmar coleta sincroniza via sime_acao_midia ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coletor_midias',
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await login(p);
  await p.waitForTimeout(300);

  // A seção 0001 está em "aguardando_encerramento" por padrão — sem botão de
  // coleta na aba "rota". Simula o status "pronta_para_coleta" já existente
  // localmente antes de coletar, via localStorage direto (o que já é feito
  // por outro módulo — o mesário — em produção).
  await p.evaluate(() => {
    localStorage.setItem('sime_midias_v1', JSON.stringify({ '0001': { status: 'pronta_para_coleta', pronta_ts: Date.now() } }));
  });
  await p.evaluate(() => window.render());
  await p.click('.btn-coletar');
  await p.click('.sbtn.yellow');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_acao_midia'));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const call = calls.find(c => c.name === 'sime_acao_midia');
  check('confirmar coleta chama sime_acao_midia com p_status=coletada', call?.params?.p_status === 'coletada');
  check('payload usa secao_id/eleicao_id reais', call.params.p_secao_id === 'sec-uuid-1' && call.params.p_eleicao_id === 'ele-uuid-1');
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Falha de rede: aplica local mesmo assim, mas enfileira (fila própria do arquivo) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coletor_midias',
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await login(p);
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    localStorage.setItem('sime_midias_v1', JSON.stringify({ '0001': { status: 'pronta_para_coleta', pronta_ts: Date.now() } }));
  });
  await p.evaluate(() => window.render());
  await p.click('.btn-coletar');
  await p.click('.sbtn.yellow');
  await p.waitForTimeout(300);

  const midiaState = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1') || '{}')['0001']);
  check('aplica localmente mesmo com rpc falhando (offline-first)', midiaState?.status === 'coletada');
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
  check('rpc falhando enfileira na fila própria do arquivo', pendentes >= 1, 'pendentes=' + pendentes);
  check('zero erros JS não tratados com rpc falhando', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Continuar offline: sem sessão, aplica local e não chama rpc ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => { await route.abort('failed'); });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.evaluate(() => {
    localStorage.setItem('sime_midias_v1', JSON.stringify({ '0001': { status: 'pronta_para_coleta', pronta_ts: Date.now() } }));
  });
  await p.evaluate(() => window.render());
  await p.click('.btn-coletar');
  await p.click('.sbtn.yellow');
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('continuar offline: nenhuma chamada rpc (sem sessão)', calls.length === 0, 'calls=' + calls.length);
  const midiaState = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1') || '{}')['0001']);
  check('continuar offline: aplica localmente mesmo assim', midiaState?.status === 'coletada');
  check('continuar offline: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
