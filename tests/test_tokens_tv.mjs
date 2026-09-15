// Testa a criação de token de TV pela UI de SIME_tokens.html (08/09/2026,
// pedido direto: "Quer que eu traga isso pra dentro de SIME_tokens.html
// (criar token de TV pela UI, escolhendo qual módulo)? sim"). Antes, tipo='tv'
// só existia via SQL Editor manual (ver sql/SIME_schema.sql) e o merge de
// tokens remotos ignorava esse tipo de propósito — os dois lados agora
// funcionam (ver test_tokens.mjs bloco 6 pro merge).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._op = 'select'; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not() { return this; }
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
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
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
    sime_rotas: [],
    sime_secoes: [],
    insertCalls: [], deleteCalls: [],
  };
}

async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForTimeout(300);
}

// ── 1. Tipo "Painel de TV" existe, grupo de módulo aparece só pra ele ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  const tipos = await p.evaluate(() => [...document.querySelectorAll('#f-tipo option')].map(o => o.value));
  check('tipo "tv" está no dropdown', tipos.includes('tv'), tipos.join(','));

  check('grp-tv-modulo oculto por padrão (mesário)', await p.evaluate(() => document.getElementById('grp-tv-modulo').style.display === 'none'));
  await p.selectOption('#f-tipo', 'tv');
  check('grp-tv-modulo aparece ao escolher tv', await p.evaluate(() => document.getElementById('grp-tv-modulo').style.display !== 'none'));
  check('grp-rotas some ao escolher tv', await p.evaluate(() => document.getElementById('grp-rotas').style.display === 'none'));
  check('grp-secao-unica some ao escolher tv', await p.evaluate(() => document.getElementById('grp-secao-unica').style.display === 'none'));
  check('grp-local some ao escolher tv', await p.evaluate(() => document.getElementById('grp-local').style.display === 'none'));

  const opcoesModulo = await p.evaluate(() => [...document.querySelectorAll('#f-tv-modulo option')].map(o => o.value).filter(Boolean));
  check('4 painéis de TV disponíveis no seletor', JSON.stringify(opcoesModulo.sort()) === JSON.stringify(['tv_dia','tv_distribuicao','tv_preparacao','tv_vespera'].sort()), opcoesModulo.join(','));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Sem escolher o painel, o clique é bloqueado com aviso — não grava nada ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  await p.fill('#f-nome', 'TV do Salão');
  await p.selectOption('#f-tipo', 'tv');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForTimeout(200);
  const chamadas = await p.evaluate(() => window.__mockConfig.insertCalls.length);
  check('sem painel escolhido: nenhum insert disparado', chamadas === 0, 'n=' + chamadas);
  await ctx.close();
}

// ── 3. Criar token de TV Dia — grava tipo=tv, local_nome=tv_dia, pin fixo ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  await p.fill('#f-nome', 'TV do Salão Principal');
  await p.selectOption('#f-tipo', 'tv');
  await p.selectOption('#f-tv-modulo', 'tv_dia');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  const call = (await p.evaluate(() => window.__mockConfig.insertCalls))[0];
  check('token de tv grava tipo=tv', call.payload.tipo === 'tv');
  check('token de tv grava local_nome=tv_dia (chave do módulo, não o arquivo)', call.payload.local_nome === 'tv_dia', call.payload.local_nome);
  check('token de tv não grava rotas', call.payload.rotas === null);
  check('token de tv não grava secoes', call.payload.secoes === null);
  check('token de tv nasce com PIN fixo 0000 (sime-login pula essa checagem)', call.payload.pin === '0000', call.payload.pin);

  const url = await p.locator('.tc-url').first().textContent();
  check('QR usa tv_token= (não token=) e aponta pro módulo certo', /SIME_tv_dia\.html\?tv_token=/.test(url), url);

  const badge = await p.locator('.tc-badges').first().textContent();
  check('badge mostra o painel escolhido', badge.includes('TV Dia da Eleição'), badge);
  check('badge NÃO mostra "PIN:" (TV não usa PIN de backup)', !badge.includes('PIN:'), badge);

  const corpo = await p.locator('.token-card').first().textContent();
  check('cartão avisa que TV não tem PIN de backup', corpo.includes('sem PIN de backup') || corpo.includes('só por QR'), corpo);

  // Form limpo depois de criar — mesmo padrão dos demais tipos.
  const moduloDepois = await p.evaluate(() => document.getElementById('f-tv-modulo').value);
  check('seletor de painel volta pro vazio depois de criar', moduloDepois === '', moduloDepois);

  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Cada um dos 4 painéis aponta pro arquivo HTML certo ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);

  const casos = [
    ['tv_preparacao', 'SIME_tv_preparacao.html'],
    ['tv_vespera', 'SIME_tv_vespera.html'],
    ['tv_distribuicao', 'SIME_tv_distribuicao.html'],
    ['tv_dia', 'SIME_tv_dia.html'],
  ];
  for (const [modulo, arquivo] of casos) {
    await p.fill('#f-nome', 'Painel ' + modulo);
    await p.selectOption('#f-tipo', 'tv');
    await p.selectOption('#f-tv-modulo', modulo);
    await p.click('text=🔑 Gerar QR Code + PIN');
    await p.waitForTimeout(150);
  }
  const urls = await p.locator('.tc-url').allTextContents();
  for (const [modulo, arquivo] of casos) {
    check(`${modulo} → ${arquivo}`, urls.some(u => u.includes(arquivo + '?tv_token=')), urls.join(' | '));
  }
  await ctx.close();
}

// ── 5. Gerar em massa continua sem emitir cartão de TV (é registro pontual, não derivável de seção/rota) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_rotas = [{ id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true }];
  cfg.sime_secoes = [{ id: 'sec-uuid-1', numero: 1, local_nome: 'Escola X', municipio: 'Campo Maior', eleitores: 100, ativo: true }];
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.evaluate(() => window.gerarEmMassa());
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  const tipos = await p.evaluate(() => window.__mockConfig.insertCalls.flatMap(c => (c.payload.length ? c.payload : [c.payload]).map(x => x.tipo)));
  check('massa não emite tipo=tv', !tipos.includes('tv'), tipos.join(','));
  await ctx.close();
}

await b.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_tokens_tv.mjs`);
falhas.forEach((f) => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
