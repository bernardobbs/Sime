// Testa a "Atribuir transmissão" (matriz nominal técnico↔seção) na aba
// Mídias de SIME_admin.html: filtro por município, seleção múltipla de
// seções, atribuição em massa a um técnico via sime_midia_transmissao_upsert
// (uma chamada por seção), e a lista "quem transmite o quê" resultante.
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
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return resolve({ data: rows, error: null }); }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    auth: {
      async signInWithPassword({ email, password }) { return { error: null }; },
      async getSession() { return { data: { session: null } }; },
      async getUser() { return { data: { user: null } }; },
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
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
    rpcCalls: [],
    sime_secoes: [
      { id: 'sec-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null },
      { id: 'sec-64', numero: 64, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 140, ativo: true, parada: null },
      { id: 'sec-101', numero: 101, local_nome: 'U.E. Tertuliano Pereira', municipio: 'Jatobá do Piauí', eleitores: 90, ativo: true, parada: null },
    ],
    sime_eleicoes: [{ id: 'ele-1', turno: 1, zona_id: 'z7', ativa: true, data_d: null, data_d1: null, horario_ab: null, horario_enc: null, created_at: '2026-01-01' }],
    sime_atores: [
      { id: 'tec-1', nome_completo: 'Carlos Técnico', telefone_whatsapp: '86988887777', funcao: 'tecnico', funcao_mesa: '', secao_id: null, confirmacao: 'pendente', ativo: true },
      { id: 'tec-2', nome_completo: 'Denise Técnica', telefone_whatsapp: '86988886666', funcao: 'tecnico', funcao_mesa: '', secao_id: null, confirmacao: 'pendente', ativo: true },
      { id: 'mes-1', nome_completo: 'Ana Mesária', telefone_whatsapp: '86988885555', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 'sec-63', confirmacao: 'pendente', ativo: true },
    ],
    sime_midias: [],
    sime_usuarios: [{ id: 'u1', nome: 'Rafa Coord', email: 'admin@sime.gov.br', perfil: 'coordenador', empresa_id: null, local_id: null, ativo: true }],
  };
}

async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForTimeout(400);
}

// ── 1. Filtro por município, dropdown de técnicos, atribuição em massa ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx, baseMockConfig());
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);

  await p.click('button.nav-tab[onclick*="midias"]');
  await p.waitForTimeout(300);

  const opcoesTecnico = await p.locator('#tx-tecnico option').allTextContents();
  check('dropdown de técnico lista só funcao=tecnico (2, sem a mesária)',
    opcoesTecnico.filter(t => t.includes('Técnic')).length === 2, opcoesTecnico.join(' | '));

  check('sem filtro: mostra as 3 seções', await p.locator('#tx-secoes .tx-check').count() === 3);

  await p.selectOption('#tx-mun', 'Campo Maior');
  await p.waitForTimeout(150);
  check('filtro por município: só as 2 de Campo Maior', await p.locator('#tx-secoes .tx-check').count() === 2);

  // seleciona as 2 seções filtradas e atribui ao primeiro técnico
  const checks = p.locator('#tx-secoes .tx-check');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await p.selectOption('#tx-tecnico', 'tec-1');
  await p.click('button[onclick="atribuirTransmissao()"]');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_midia_transmissao_upsert').length === 2);

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_midia_transmissao_upsert'));
  check('2 chamadas RPC, uma por seção selecionada', chamadas.length === 2, JSON.stringify(chamadas));
  check('todas atribuem ao técnico selecionado', chamadas.every(c => c.params.p_tecnico_id === 'tec-1'), JSON.stringify(chamadas));
  check('secao_id/eleicao_id reais no payload',
    chamadas.every(c => ['sec-63', 'sec-64'].includes(c.params.p_secao_id) && c.params.p_eleicao_id === 'ele-1'),
    JSON.stringify(chamadas));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 2. Sem técnico selecionado: avisa e não chama a RPC ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx, baseMockConfig());
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await login(p);
  await p.click('button.nav-tab[onclick*="midias"]');
  await p.waitForTimeout(300);

  await p.locator('#tx-secoes .tx-check').first().check();
  await p.click('button[onclick="atribuirTransmissao()"]');
  await p.waitForTimeout(200);
  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_midia_transmissao_upsert'));
  check('sem técnico: nenhuma chamada RPC', chamadas.length === 0, JSON.stringify(chamadas));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
