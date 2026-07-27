// Testa a integração da Fase 4 em SIME_motorista.html: login token+PIN (novo),
// preservando o fluxo existente por ?rota= na URL, e sincronização das ações
// de entrega/recolhimento/chegada ao cartório via sime_acao_mesa.
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
  // getFase() em SIME_motorista.html cai no relógio de parede (antes das 12h
  // = entrega) só quando sime_eleicao_v1 não tem a data do turno — força
  // "hoje" como d1 (entrega) pra não depender da hora real do container.
  await p.addInitScript((hoje) => {
    localStorage.setItem('sime_eleicao_v1', JSON.stringify({ turno_ativo: 1, turno1: { d1: hoje } }));
  }, new Date().toISOString().slice(0, 10));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-135', numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, parada: 1, sime_rotas: null },
      { id: 'sec-uuid-144', numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, parada: 1, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

// ── 1. Login token+PIN sem ?rota= na URL → aplica a rota do escopo do token ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    const body = route.request().postDataJSON();
    check('sime-login recebeu token+pin do formulário', body.token === 'MOTO001' && body.pin === '4321');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'motorista', rotas: ['001'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_motorista.html');
  await p.fill('#login-token', 'MOTO001');
  await p.fill('#login-pin', '4321');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForFunction(() => document.getElementById('view-main').style.display !== 'none');
  const titulo = await p.textContent('#h-title');
  check('rota do token (001) foi aplicada automaticamente', titulo.includes('Rota 001'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Confirmar entrega sincroniza via sime_acao_mesa (p_urna_entregue) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'motorista', rotas: ['001'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_motorista.html');
  await p.fill('#login-token', 'MOTO001');
  await p.fill('#login-pin', '4321');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('view-main').style.display !== 'none');
  await p.waitForTimeout(300);

  await p.click('.btn-entregar'); // primeira seção da 1ª parada
  await p.click('#sh-ok');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_urna_entregue === true));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const entregaCall = calls.find(c => c.params?.p_urna_entregue === true);
  check('confirmar entrega chama sime_acao_mesa com p_urna_entregue=true', !!entregaCall);
  check('payload usa secao_id/eleicao_id reais e origem motorista', entregaCall.params.p_secao_id === 'sec-uuid-135' && entregaCall.params.p_eleicao_id === 'ele-uuid-1' && entregaCall.params.p_origem === 'motorista');
  await ctx.close();
}

// ── 3. ?rota= explícito na URL NÃO é sobreposto pelo escopo do token ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'motorista', rotas: ['001'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_motorista.html?rota=004');
  await p.waitForFunction(() => document.getElementById('view-main').style.display !== 'none');
  await p.fill('#login-token', 'MOTO001');
  await p.fill('#login-pin', '4321');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForTimeout(300);
  const titulo = await p.textContent('#h-title');
  check('?rota=004 da URL tem prioridade sobre o escopo do token (001)', titulo.includes('Rota 004'));
  await ctx.close();
}

// ── 4. "Continuar offline": ?rota= continua funcionando 100% sem sync ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  let loginCalled = false;
  await ctx.route('**/functions/v1/sime-login', async (route) => { loginCalled = true; await route.abort('failed'); });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_motorista.html?rota=001');
  await p.waitForFunction(() => document.getElementById('view-main').style.display !== 'none');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.click('.btn-entregar');
  await p.click('#sh-ok');
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('continuar offline: nenhuma chamada rpc (sem sessão)', calls.length === 0, 'calls=' + calls.length);
  check('continuar offline: fluxo ?rota= continua funcionando', await p.textContent('#h-title').then(t => t.includes('Rota 001')));
  check('continuar offline: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
