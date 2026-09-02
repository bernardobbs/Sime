// Testa a transmissão DIGITAL (JE-Connect) em SIME_midias.html — distinta da
// entrega física da mídia (já coberta por test_midias.mjs). O técnico marca
// "transmitido"/"falhou" por seção na aba 📡 Transmissão; a RPC é
// sime_midia_transmissao_upsert, separada de sime_acao_midia (não mexe na
// fila de coleta física).
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
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'coletor_midias',
    }) });
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

// ── 1. Marcar transmitido chama sime_midia_transmissao_upsert corretamente ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx, baseMockConfig());
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await login(p);
  await p.waitForTimeout(300);

  await p.click('#tab-trans-btn');
  await p.waitForTimeout(200);
  // SECOES é a lista local completa do arquivo (não filtrada pelo token de
  // sessão, mesmo padrão já usado nas outras abas) — a seção 0001 do mock é
  // uma das muitas que aparecem; a asserção mira nela especificamente.
  check('aba Transmissão renderiza a lista por seção', await p.locator('#tx-list .section-card').count() > 1);
  check('seção 0001 aparece na lista', await p.locator('button[onclick*="marcarTransmissao(\'0001\'"]').count() === 2);

  await p.click('button[onclick="marcarTransmissao(\'0001\',\'transmitido\')"]');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_midia_transmissao_upsert'));
  const call = (await p.evaluate(() => window.__mockConfig.rpcCalls)).find(c => c.name === 'sime_midia_transmissao_upsert');
  check('rpc chamada com p_transmissao_status=transmitido', call?.params?.p_transmissao_status === 'transmitido', JSON.stringify(call));
  check('payload usa secao_id/eleicao_id reais', call.params.p_secao_id === 'sec-uuid-1' && call.params.p_eleicao_id === 'ele-uuid-1');

  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1') || '{}')['0001']);
  check('estado local reflete transmissao_status=transmitido', local?.transmissao_status === 'transmitido');
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Marcar falhou funciona e não mexe no status físico ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx, baseMockConfig());
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await login(p);
  await p.waitForTimeout(300);
  await p.click('#tab-trans-btn');
  await p.waitForTimeout(200);

  await p.click('button[onclick="marcarTransmissao(\'0001\',\'falhou\')"]');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_midia_transmissao_upsert'));
  const call = (await p.evaluate(() => window.__mockConfig.rpcCalls)).find(c => c.name === 'sime_midia_transmissao_upsert');
  check('rpc chamada com p_transmissao_status=falhou', call?.params?.p_transmissao_status === 'falhou');

  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1') || '{}')['0001']);
  check('status físico continua no default (não mexeu na coleta)', local?.status === 'aguardando_encerramento', JSON.stringify(local));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Falha de rede: aplica local mesmo assim, enfileira na fila offline ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_midias.html');
  await login(p);
  await p.waitForTimeout(300);
  await p.click('#tab-trans-btn');
  await p.waitForTimeout(200);

  await p.click('button[onclick="marcarTransmissao(\'0001\',\'transmitido\')"]');
  await p.waitForTimeout(300);

  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1') || '{}')['0001']);
  check('aplica localmente mesmo com rpc falhando (offline-first)', local?.transmissao_status === 'transmitido');
  const pendentes = await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('sime_offline', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('queue', 'readonly');
      const getAllReq = tx.objectStore('queue').index('status').getAll('pendente');
      getAllReq.onsuccess = () => resolve(getAllReq.result.filter(i => i.acao === 'midia_transmissao').length);
      getAllReq.onerror = () => resolve(-1);
    };
    req.onerror = () => resolve(-1);
  }));
  check('rpc falhando enfileira midia_transmissao na fila offline', pendentes >= 1, 'pendentes=' + pendentes);
  check('zero erros JS não tratados com rpc falhando', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
