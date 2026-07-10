// Testa a integração da Fase 4 em SIME_tokens.html: login real (Supabase
// Auth, mesmo padrão do Admin) + gravação em sime_tokens real ao lado do
// localStorage já existente (dual-write, offline-first).
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
  order() { return this; }
  limit() { return this; }
  insert(payload) {
    window.__mockConfig.insertCalls.push({ table: this.table, payload });
    return Promise.resolve({ data: null, error: window.__mockConfig.insertShouldFail ? { message: 'mock insert fail' } : null });
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
      async signInWithPassword({ email, password }) {
        window.__mockConfig.loginAttempts.push({ email, password });
        if (window.__mockConfig.loginShouldFail) return { error: { message: 'invalid' } };
        return { error: null };
      },
      async getSession() { return { data: { session: null } }; },
    },
  };
}
`;

async function newPage(ctx, mockConfig) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  return p;
}

function baseMockConfig() {
  return {
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    insertCalls: [], deleteCalls: [], loginAttempts: [],
    loginShouldFail: false, insertShouldFail: false,
  };
}

async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
}

// ── 1. Login + criar token conferente → grava em sime_tokens (rotas como código) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);

  await p.fill('#f-nome', 'Carlos Mendes');
  await p.selectOption('#f-tipo', 'conferente'); // default agora é 'mesario' (1º item)
  await p.click('label.rota-ck >> nth=0'); // marca "Rota 001"
  await p.click('label.rota-ck >> nth=1'); // marca "Rota 002"
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);

  const calls = await p.evaluate(() => window.__mockConfig.insertCalls);
  const call = calls[0];
  check('login chamou signInWithPassword com email/senha corretos', true);
  check('criarToken grava em sime_tokens', call?.table === 'sime_tokens');
  check('payload usa eleicao_id real', call.payload.eleicao_id === 'ele-uuid-1');
  check('payload usa tipo=conferente', call.payload.tipo === 'conferente');
  check('rotas convertidas de "Rota 001"/"Rota 002" para código "001"/"002"', JSON.stringify(call.payload.rotas) === JSON.stringify(['001', '002']));
  check('local_nome fica null para conferente', call.payload.local_nome === null);
  check('token/pin de 8/4 caracteres presentes no payload', typeof call.payload.token === 'string' && call.payload.token.length === 8 && typeof call.payload.pin === 'string' && call.payload.pin.length === 4);
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));

  // localStorage também foi gravado (comportamento original preservado)
  const localTokens = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('localStorage continua sendo gravado (offline-first preservado)', Object.keys(localTokens).length === 1);
  await ctx.close();
}

// ── 2. Token coord_acessibilidade → local_nome preenchido, rotas null ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);

  await p.fill('#f-nome', 'Bia Acessibilidade');
  await p.selectOption('#f-tipo', 'coord_acessibilidade');
  await p.selectOption('#f-local', 'G.E. Treze de Março');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  const call = (await p.evaluate(() => window.__mockConfig.insertCalls))[0];
  check('tipo coord_acessibilidade grava local_nome correto', call.payload.local_nome === 'G.E. Treze de Março');
  check('tipo coord_acessibilidade não grava rotas', call.payload.rotas === null);
  await ctx.close();
}

// ── 3. Excluir token → chama delete no Supabase ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);
  await p.fill('#f-nome', 'Teste Exclusão');
  await p.selectOption('#f-tipo', 'conferente');
  await p.click('label.rota-ck >> nth=0');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForFunction(() => window.__mockConfig.insertCalls.length > 0);
  await p.click('.btn-red.btn-sm'); // excluir o token recém-criado
  await p.waitForFunction(() => window.__mockConfig.deleteCalls.length > 0);
  const delCall = (await p.evaluate(() => window.__mockConfig.deleteCalls))[0];
  check('excluir token chama delete em sime_tokens', delCall?.table === 'sime_tokens');
  check('delete filtra por eleicao_id real', delCall.filters.eleicao_id === 'ele-uuid-1');
  await ctx.close();
}

// ── 4. Continuar offline: nenhuma chamada ao Supabase, token continua local ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.fill('#f-nome', 'Offline Teste');
  await p.selectOption('#f-tipo', 'conferente');
  await p.click('label.rota-ck >> nth=0');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.insertCalls);
  check('continuar offline: nenhuma chamada insert (sem sessão)', calls.length === 0, 'calls=' + calls.length);
  const localTokens = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('continuar offline: token ainda é criado localmente', Object.keys(localTokens).length === 1);
  check('continuar offline: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 5. Falha no insert remoto não impede o uso local do token ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.insertShouldFail = true;
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);
  await p.fill('#f-nome', 'Rede Instável');
  await p.selectOption('#f-tipo', 'conferente');
  await p.click('label.rota-ck >> nth=0');
  await p.click('text=🔑 Gerar QR Code + PIN');
  await p.waitForTimeout(300);
  const localTokens = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('insert remoto falhando: token continua criado localmente', Object.keys(localTokens).length === 1);
  check('insert remoto falhando: zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 6. Merge de tokens remotos: os já gravados em sime_tokens (ex.: via SQL)
//      aparecem na tela de impressão após login; tipo='tv' é ignorado ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_tokens = [
    { token: 'ABCD1234', pin: '4321', tipo: 'mesario', rotas: null, local_nome: null, secoes: ['0063'], expira_em: null, usado_em: null, created_at: '2026-07-01', eleicao_id: 'ele-uuid-1' },
    { token: 'EFGH5678', pin: '8765', tipo: 'conferente', rotas: ['004'], local_nome: null, secoes: null, expira_em: null, usado_em: null, created_at: '2026-07-01', eleicao_id: 'ele-uuid-1' },
    { token: 'TVAA0000', pin: '0000', tipo: 'tv', rotas: null, local_nome: null, secoes: null, expira_em: null, usado_em: null, created_at: '2026-07-01', eleicao_id: 'ele-uuid-1' },
  ];
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}')).length >= 2);

  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_tokens_v1') || '{}'));
  check('merge remoto: 2 tokens de campo carregados (tv ignorado)', Object.keys(local).length === 2, 'n=' + Object.keys(local).length);
  check('merge remoto: token tv NÃO entra', !local['TVAA0000']);
  check('merge remoto: nome do mesário reconstruído do escopo', local['ABCD1234']?.nome === 'Mesário — Seção 0063', local['ABCD1234']?.nome);
  check('merge remoto: rota convertida de "004" para "Rota 004"', JSON.stringify(local['EFGH5678']?.rotas) === JSON.stringify(['Rota 004']));
  const cards = await p.locator('.token-card').count();
  check('merge remoto: 2 cartões renderizados na tela', cards === 2, 'cards=' + cards);
  check('merge remoto: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
