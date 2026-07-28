// Testa a integração da Fase 4 em SIME_acessibilidade.html: login local (PIN
// contra sime_tokens_v1, já existente) + sessão real do Supabase em paralelo,
// sincronizando fila/pânico via sime_acao_acessibilidade.
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

async function newPage(ctx, mockConfig, tokens) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.addInitScript((toks) => { localStorage.setItem('sime_tokens_v1', JSON.stringify(toks)); }, tokens);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

const TOKENS = { ACES001: { id: 'ACES001', nome: 'Bia Acessibilidade', pin: '9876', local: 'G.E. Treze de Março' } };

async function loginPIN(p) {
  for (let i = 0; i < 4; i++) await p.fill(`#pin-${i}`, '9876'[i]);
}

// ── 1. Login local (PIN) + sessão real em paralelo; ajustar fila sincroniza ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  let loginBody = null;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    loginBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coord_acessibilidade',
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_acessibilidade.html');
  await loginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-app').classList.contains('active'));
  check('login local continua funcionando (entra no app)', true);
  await p.waitForTimeout(300);
  check('sime-login foi chamado com token+pin do token local', loginBody?.token === 'ACES001' && loginBody?.pin === '9876');

  await p.click('.fbtn.plus'); // +1 na fila da 1ª seção (0063)
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_fila === 1));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const filaCall = calls.find(c => c.params?.p_fila === 1);
  check('ajustar fila chama sime_acao_acessibilidade com p_fila=1', !!filaCall);
  check('payload usa secao_id/eleicao_id reais', filaCall.params.p_secao_id === 'sec-uuid-63' && filaCall.params.p_eleicao_id === 'ele-uuid-1');
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Pânico energia: aciona e depois resolve ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coord_acessibilidade',
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  await p.goto('http://localhost:8917/modules/SIME_acessibilidade.html');
  await loginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-app').classList.contains('active'));
  await p.waitForTimeout(300);

  await p.click('.pbtn.idle'); // aciona pânico energia (1º botão)
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_panico_energia === true));
  let calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('acionar pânico energia propaga p_panico_energia=true', calls.some(c => c.params?.p_panico_energia === true && c.params?.p_panico_energia_resolvido === false));

  await p.click('.pbtn.active'); // resolve
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_panico_energia_resolvido === true));
  calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('resolver pânico energia propaga p_panico_energia=false/resolvido=true', calls.some(c => c.params?.p_panico_energia === false && c.params?.p_panico_energia_resolvido === true));
  await ctx.close();
}

// ── 3. Falha de rede → enfileira no IndexedDB ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coord_acessibilidade',
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_acessibilidade.html');
  await loginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-app').classList.contains('active'));
  await p.waitForTimeout(300);
  await p.click('.fbtn.plus');
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

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
