// Testa a geração em massa de tokens (item 3) em SIME_tokens.html: mesário
// por seção, conferente/motorista/instalador por rota, acessibilidade por
// local — idempotente (não duplica em cliques repetidos). Coletor de Mídias
// fica de fora (papel fixo, sem agrupamento real).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._op = 'select'; this._notNull = []; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not(col, op, val) { if (op === 'is' && val === null) this._notNull.push(col); return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload) {
    window.__mockConfig.insertCalls.push({ table: this.table, payload });
    return Promise.resolve({ data: null, error: null });
  }
  delete() { this._op = 'delete'; return this; }
  then(resolve) {
    if (this._op === 'delete') {
      window.__mockConfig.deleteCalls.push({ table: this.table, filters: { ...this.filters } });
      return resolve({ data: null, error: null });
    }
    let rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    for (const c of this._notNull) rows = rows.filter((r) => r[c] != null);
    return resolve({ data: rows, error: null });
  }
  maybeSingle() {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    auth: {
      async signInWithPassword({ email, password }) { return { error: null }; },
      async getSession() { return { data: { session: null } }; },
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
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    sime_rotas: [
      { id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true },
      { id: 'rota-uuid-002', codigo: '002', nome: 'Rota 002', municipios: ['Campo Maior'], ativo: true },
    ],
    sime_secoes: [
      { id: 'sec-uuid-135', numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
      { id: 'sec-uuid-144', numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
      { id: 'sec-uuid-180', numero: 180, local_nome: 'U.E. José Gomes Oliveira', municipio: 'Campo Maior', eleitores: 200, ativo: true, rota_id: 'rota-uuid-002', parada: 1 },
    ],
    insertCalls: [], deleteCalls: [], insertShouldFail: false,
  };
}

async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForTimeout(300);
}

// ── 1. Criar token de mesário manualmente (por seção, não por rota) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  check('mesário é o tipo padrão (1º item do dropdown)', await p.evaluate(() => document.getElementById('f-tipo').value === 'mesario'));
  check('grupo de seção única visível por padrão (mesário)', await p.evaluate(() => document.getElementById('grp-secao-unica').style.display !== 'none'));
  check('grupo de rotas oculto (mesário não usa rotas)', await p.evaluate(() => document.getElementById('grp-rotas').style.display === 'none'));

  await p.fill('#f-nome', 'Ana Mesária');
  await p.selectOption('#f-secao', '0135');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  const call = (await p.evaluate(() => window.__mockConfig.insertCalls))[0];
  check('token de mesário grava tipo=mesario', call.payload.tipo === 'mesario');
  check('token de mesário grava secoes=["0135"]', JSON.stringify(call.payload.secoes) === JSON.stringify(['0135']));
  check('token de mesário não grava rotas', call.payload.rotas === null);

  const url = await p.locator('.tc-url').first().textContent();
  check('QR aponta pra SIME_mesario.html', url.includes('SIME_mesario.html?token='));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Criar token de motorista/instalador manualmente (por rota) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  await p.fill('#f-nome', 'João Motorista');
  await p.selectOption('#f-tipo', 'motorista');
  check('trocar pra motorista mostra grupo de rotas', await p.evaluate(() => document.getElementById('grp-rotas').style.display !== 'none'));
  await p.click('label.rota-ck >> nth=0');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  const call = (await p.evaluate(() => window.__mockConfig.insertCalls))[0];
  check('token de motorista grava tipo=motorista', call.payload.tipo === 'motorista');
  check('token de motorista grava rotas=["001"]', JSON.stringify(call.payload.rotas) === JSON.stringify(['001']));
  const url = await p.locator('.tc-url').first().textContent();
  check('QR aponta pra SIME_motorista.html', url.includes('SIME_motorista.html?token='));
  await ctx.close();
}

// ── 3. Gerar em massa: cria 1 por seção/rota/local, coletor de mídias não aparece no dropdown ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  const opcoesTipo = await p.evaluate(() => [...document.getElementById('f-tipo').options].map(o => o.value));
  check('coletor_midias não está no dropdown de tipos', !opcoesTipo.includes('coletor_midias'));
  check('os 5 tipos esperados estão no dropdown', JSON.stringify(opcoesTipo.sort()) === JSON.stringify(['coord_acessibilidade','conferente','instalador','mesario','motorista'].sort()));

  await p.evaluate(() => window.gerarEmMassa());
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  await p.waitForTimeout(200);

  const tokens = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  const porTipo = {};
  Object.values(tokens).forEach(t => { porTipo[t.tipo] = (porTipo[t.tipo]||0) + 1; });
  check('gerou 3 tokens de mesário (1 por seção)', porTipo.mesario === 3);
  check('gerou 2 tokens de conferente (1 por rota)', porTipo.conferente === 2);
  check('gerou 2 tokens de motorista (1 por rota)', porTipo.motorista === 2);
  check('gerou 2 tokens de instalador (1 por rota)', porTipo.instalador === 2);
  check('gerou 2 tokens de acessibilidade (1 por local único)', porTipo.coord_acessibilidade === 2);
  check('não gerou nenhum token de coletor_midias', !porTipo.coletor_midias);

  const totalEsperado = 3 + 2 + 2 + 2 + 2;
  check(`total de ${totalEsperado} tokens criados`, Object.keys(tokens).length === totalEsperado);

  // Verifica que usou insert em LOTE (1 chamada com N linhas), não N chamadas
  const insertCalls = await p.evaluate(() => window.__mockConfig.insertCalls);
  check('usou criarEmLote (1 chamada insert com array, não N chamadas)', insertCalls.length === 1 && Array.isArray(insertCalls[0].payload) && insertCalls[0].payload.length === totalEsperado);

  // Idempotência: clicar de novo não duplica
  await p.evaluate(() => window.gerarEmMassa());
  await p.waitForTimeout(300);
  const tokensDepois = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('idempotente: clicar de novo não duplica tokens', Object.keys(tokensDepois).length === totalEsperado);

  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Sem dados reais carregados (offline): bloqueia com toast, não quebra ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.evaluate(() => window.gerarEmMassa());
  await p.waitForTimeout(200);
  const tokens = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('offline: gerar em massa não cria nenhum token (sem dado real)', Object.keys(tokens).length === 0);
  check('offline: zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
