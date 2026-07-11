// Testa o fechamento da dívida técnica em SIME_admin.html: escopo do Coord.
// de Motoristas passa a vir de sime_empresas.rotas de verdade (dropdown +
// seções auto-derivadas), em vez de uma lista digitada à mão. Coletor de
// Mídias continua manual por design (sem regressão esperada ali).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._notNull = []; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not(col, op, val) { if (op === 'is' && val === null) this._notNull.push(col); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) {
    let rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    for (const c of this._notNull) rows = rows.filter((r) => r[c] != null);
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    auth: {
      async signInWithPassword({ email, password }) { return { error: null }; },
      async getSession() { return { data: { session: null } }; },
      async getUser() { return { data: { user: null } }; },
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
    sime_rotas: [{ id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true }],
    sime_secoes: [
      { numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
      { numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
    ],
    sime_empresas: [{ id: 'empresa-uuid-1', nome: 'Transporte Piauí Ltda', rotas: ['rota-uuid-001'], ativo: true }],
  };
}

async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForTimeout(300);
}

// ── 1. Com empresas reais: dropdown aparece, seções derivadas automaticamente ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);

  await p.evaluate(() => window.openNewMember());
  await p.selectOption('#m-perfil', 'coord_motoristas');
  check('dropdown real de empresa aparece (não mais texto livre)', await p.locator('#m-empresa-sel').count() === 1);
  check('campo de seções manual fica oculto (derivado automaticamente)', await p.evaluate(() => document.getElementById('grp-secoes').style.display === 'none'));

  await p.fill('#m-nome', 'João Motorista');
  await p.selectOption('#m-empresa-sel', 'empresa-uuid-1');
  const preview = await p.locator('#m-empresa-secoes-preview').textContent();
  check('preview mostra 2 seções (rota da empresa)', preview.includes('2 seç'));

  await p.evaluate(() => window.saveMember(''));
  await p.waitForTimeout(200);
  const team = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_equipe_v1') || '[]'));
  const novo = team.find(m => m.nome === 'João Motorista');
  check('membro salvo com empresa_id real', novo?.empresa_id === 'empresa-uuid-1');
  check('membro salvo com nome da empresa resolvido', novo?.empresa === 'Transporte Piauí Ltda');
  check('membro salvo com seções auto-derivadas (0135, 0144)', JSON.stringify(novo?.secoes?.sort()) === JSON.stringify(['0135', '0144']));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Sem empresa selecionada: bloqueia salvar com toast, não deixa criar membro incompleto ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);
  await p.evaluate(() => window.openNewMember());
  await p.selectOption('#m-perfil', 'coord_motoristas');
  await p.fill('#m-nome', 'Sem Empresa');
  await p.evaluate(() => window.saveMember(''));
  await p.waitForTimeout(200);
  const team = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_equipe_v1') || '[]'));
  check('sem empresa selecionada: membro NÃO é criado', !team.some(m => m.nome === 'Sem Empresa'));
  await ctx.close();
}

// ── 3. Coletor de Mídias continua manual (sem regressão) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);
  await p.evaluate(() => window.openNewMember());
  await p.selectOption('#m-perfil', 'coletor_midias');
  check('coletor de mídias: campo de seções manual continua visível', await p.evaluate(() => document.getElementById('grp-secoes').style.display !== 'none'));
  await p.fill('#m-nome', 'Maria Coletora');
  await p.fill('#m-secoes', '135, 144');
  await p.evaluate(() => window.saveMember(''));
  await p.waitForTimeout(200);
  const team = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_equipe_v1') || '[]'));
  const novo = team.find(m => m.nome === 'Maria Coletora');
  check('coletor de mídias: seções digitadas à mão continuam funcionando', JSON.stringify(novo?.secoes?.sort()) === JSON.stringify(['0135', '0144']));
  await ctx.close();
}

// ── 4. Sem empresas cadastradas (offline/dado vazio): cai no texto livre como antes ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_empresas = []; // nenhuma empresa cadastrada ainda
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);
  await p.evaluate(() => window.openNewMember());
  await p.selectOption('#m-perfil', 'coord_motoristas');
  check('sem empresas cadastradas: cai no campo de texto livre (fallback)', await p.locator('#m-empresa').count() === 1);
  check('sem empresas cadastradas: campo de seções manual visível', await p.evaluate(() => document.getElementById('grp-secoes').style.display !== 'none'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
