// Testa o botão de pânico "SOS" em SIME_mesario.html — mesmo mecanismo de
// panico_energia/panico_urna (ver test_mesario_panico_realtime.mjs), cobrindo
// os pontos que mudam com uma terceira chave em S.panico/S.panico_resolved:
// toque local, payload da RPC, resolução remota via Realtime e leitura na
// reabertura.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  then(resolve) {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = {
        on(ev, filtro, cb) { window.__mockConfig.realtimeCallback = cb; return chan; },
        subscribe() { return chan; },
      };
      return chan;
    },
    removeChannel() {},
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

function baseMockConfig(mesaEstado) {
  return {
    rpcCalls: [],
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior',
        eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, zona_id: 'zona-7', ativa: true }],
    sime_mesa_estado: mesaEstado ? [mesaEstado] : [],
  };
}

async function abrirLogado(ctx, mockConfig) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7',
      tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(700);
  return { p, erros };
}

// ── 1. Toque aciona local + payload correto ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => { window.__mockConfig.rpcCalls.length = 0; });
  await p.click('#btn-sos');
  await p.waitForTimeout(300);

  check('pânico local: botão fica ATIVO',
    (await p.locator('#btn-sos').getAttribute('class')).includes('c-panic-active'));
  check('pânico local: badge vermelho', (await p.locator('#badge-sos').textContent()) === '🔴');

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa'));
  const params = chamadas[chamadas.length - 1]?.params || {};
  check('acionar SOS envia p_panico_sos=true', params.p_panico_sos === true, JSON.stringify(params));
  check('acionar SOS envia p_panico_sos_resolvido=false', params.p_panico_sos_resolvido === false);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Toque comum NÃO envia campos de SOS ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => { window.__mockConfig.rpcCalls.length = 0; });
  await p.click('#mb-pres');
  await p.waitForTimeout(300);

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa'));
  const params = chamadas[chamadas.length - 1]?.params || {};
  check('toque comum NÃO envia p_panico_sos', !('p_panico_sos' in params), JSON.stringify(params));
  check('toque comum NÃO envia p_panico_sos_resolvido', !('p_panico_sos_resolvido' in params));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Resolução remota via Realtime atualiza a tela ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.click('#btn-sos');
  await p.waitForTimeout(200);

  await p.evaluate(() => window.__mockConfig.realtimeCallback({
    new: { secao_id: 'sec-uuid-63', panico_energia: false, panico_urna: false,
           panico_energia_resolvido: false, panico_urna_resolvido: false,
           panico_sos: false, panico_sos_resolvido: true },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  const cls = await p.locator('#btn-sos').getAttribute('class');
  check('resolvido pelo Admin: botão do mesário vira RESOLVIDO', cls.includes('c-panic-resolved'), cls);
  check('resolvido pelo Admin: badge vira ✓', (await p.locator('#badge-sos').textContent()) === '✓');
  check('estado interno acompanha', await p.evaluate(() => S.panico.sos === false && S.panico_resolved.sos === true));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Reabertura lê panico_sos_resolvido do servidor ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({
    secao_id: 'sec-uuid-63', eleicao_id: 'ele-uuid-1',
    panico_energia: false, panico_urna: false,
    panico_energia_resolvido: false, panico_urna_resolvido: false,
    panico_sos: false, panico_sos_resolvido: true,
  });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((c) => { window.__mockConfig = c; }, cfg);
  await p.addInitScript(() => {
    localStorage.setItem('sime_mesa_v1', JSON.stringify({
      '0063': { mesa: { pres: 0, m1: 0, m2: 0, sec: 0 }, zero: false, vot: false, enc: false,
                bu: false, mat: false, urna: false, fila: null,
                panico: { energia: false, urnaprob: false, sos: true },
                panico_resolved: { energia: false, urnaprob: false, sos: false } },
    }));
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7',
      tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(900);

  const cls = await p.locator('#btn-sos').getAttribute('class');
  check('reabrir com SOS resolvido no servidor: tela NÃO volta vermelha', !cls.includes('c-panic-active'), cls);
  check('reabrir: botão mostra resolvido', cls.includes('c-panic-resolved'), cls);
  check('reabrir: localStorage foi corrigido', await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sime_mesa_v1'))['0063'];
    return d.panico.sos === false && d.panico_resolved.sos === true;
  }));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
