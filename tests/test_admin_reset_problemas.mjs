// Testa "🗑 Resetar dados de teste (Problemas + Dia D)" em SIME_admin.html: o
// botão antigo ("Resetar dados de teste") virou no-op depois da migração pro
// Supabase, e isso deixava ocorrências e estado de Dia D (chegada, votação,
// urna, pânico) de teste presos na tela pra sempre — reimplementado cobrindo
// sime_ocorrencias E sime_mesa_estado da zona do usuário, com confirmação
// mostrando a contagem de cada tabela antes de apagar.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ ocorrencias, secoes, mesaEstado }) {
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }];
  const SECOES = ${JSON.stringify(secoes)};
  let OCORRENCIAS = ${JSON.stringify(ocorrencias)};
  let MESA_ESTADO = ${JSON.stringify(mesaEstado)};
  let LOGS = [];
  window.__logs = LOGS;
  window.__ocorrenciasRestantes = () => OCORRENCIAS.length;
  window.__mesaEstadoRestantes = () => MESA_ESTADO.length;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = { _op: null, _filters: {}, _in: {}, _count: null };
      qb.select = (col, opts) => { if (opts && opts.count === 'exact' && opts.head === true) qb._count = true; return qb; };
      qb.eq = (c, v) => { qb._filters[c] = v; return qb; };
      qb.in = (c, vals) => { qb._in[c] = new Set(vals); return qb; };
      qb.order = () => qb; qb.not = () => qb; qb.limit = () => qb;
      qb.delete = () => { qb._op = 'delete'; return qb; };
      qb.insert = (o) => { if (t === 'sime_logs') LOGS.push(o); return Promise.resolve({ error: null }); };
      qb.maybeSingle = () => {
        if (t === 'sime_usuarios') return Promise.resolve({ data: { id: 'u1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      const matches = (row) => Object.entries(qb._filters).every(([k, v]) => row[k] === v)
        && Object.entries(qb._in).every(([k, set]) => set.has(row[k]));
      qb.then = (resolve) => {
        if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
        if (t === 'sime_usuarios') return resolve({ data: [], error: null });
        if (t === 'sime_secoes') return resolve({ data: SECOES.filter(matches), error: null });
        if (t === 'sime_ocorrencias') {
          if (qb._op === 'delete') { OCORRENCIAS = OCORRENCIAS.filter((o) => !matches(o)); return resolve({ error: null }); }
          if (qb._count) return resolve({ data: null, count: OCORRENCIAS.filter(matches).length, error: null });
          return resolve({ data: OCORRENCIAS.filter(matches), error: null });
        }
        if (t === 'sime_mesa_estado') {
          if (qb._op === 'delete') { MESA_ESTADO = MESA_ESTADO.filter((m) => !matches(m)); return resolve({ error: null }); }
          if (qb._count) return resolve({ data: null, count: MESA_ESTADO.filter(matches).length, error: null });
          return resolve({ data: MESA_ESTADO.filter(matches), error: null });
        }
        return resolve({ data: [], error: null });
      };
      return qb;
    },
    rpc(name) { if (name === 'sime_now') return Promise.resolve({ data: '2026-08-06T12:00:00.000Z', error: null }); return Promise.resolve({ data: null, error: null }); },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
}
`;
}

async function fazerLogin(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// resetarProblemas() usa o modal customizado (pedirConfirmacao), não mais o
// confirm() nativo — accept=true clica em "Apagar permanentemente", false
// clica em "Cancelar", null não espera nenhum modal (fluxo "nada pra apagar"
// nem chega a abrir confirmação).
async function clicarResetar(p, accept) {
  await p.click("button.nav-tab:has-text('Config')");
  await p.waitForTimeout(150);
  await p.click("button:has-text('Resetar dados de teste')");
  await p.waitForTimeout(200);
  if (accept === true) await p.click('#confirmacao-ok-btn');
  else if (accept === false) await p.click('.modal-footer button:has-text("Cancelar")');
  await p.waitForTimeout(300);
}

// ── Caso 1: confirma e apaga ocorrências E estado de Dia D só da própria zona ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      secoes: [
        { id: 'sec-1', zona_id: 'zona-7', numero: 1 },
        { id: 'sec-3', zona_id: 'zona-7', numero: 3 },
        { id: 'sec-90', zona_id: 'zona-94', numero: 900 },
      ],
      ocorrencias: [
        { id: 'o1', zona_id: 'zona-7', status: 'aberta' },
        { id: 'o2', zona_id: 'zona-7', status: 'resolvida' },
        { id: 'o3', zona_id: 'zona-94', status: 'aberta' },
      ],
      mesaEstado: [
        { secao_id: 'sec-1', votacao: false },
        { secao_id: 'sec-3', panico_energia: true },
        { secao_id: 'sec-90', votacao: true }, // outra zona — não pode ser tocada
      ],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await clicarResetar(p, true);

  check('caso1: zero erros JS', erros.length === 0, erros.join('; '));
  const restantesOcor = await p.evaluate(() => window.__ocorrenciasRestantes());
  check('caso1: apagou as 2 ocorrências da própria zona, preservou a de outra', restantesOcor === 1, 'restantes=' + restantesOcor);
  const restantesMesa = await p.evaluate(() => window.__mesaEstadoRestantes());
  check('caso1: apagou as 2 seções de mesa_estado da própria zona, preservou a de outra', restantesMesa === 1, 'restantes=' + restantesMesa);
  const logs = await p.evaluate(() => window.__logs);
  const logReset = logs.find(l => l.acao === 'reset_dados_teste');
  check('caso1: registrou log de auditoria com as duas quantidades', logReset && logReset.payload.problemas === 2 && logReset.payload.mesa_estado === 2, JSON.stringify(logReset));
  await ctx.close();
}

// ── Caso 2: zona sem nada pra apagar — não pede confirmação, avisa e não quebra ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      secoes: [{ id: 'sec-1', zona_id: 'zona-7', numero: 1 }],
      ocorrencias: [], mesaEstado: [],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await clicarResetar(p, null);

  check('caso2: zero erros JS', erros.length === 0, erros.join('; '));
  check('caso2: nem chega a perguntar se não há nada pra apagar', !(await p.locator('#overlay.open').count()));
  await ctx.close();
}

// ── Caso 3: cancelar a confirmação não apaga nada em nenhuma das duas tabelas ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      secoes: [{ id: 'sec-1', zona_id: 'zona-7', numero: 1 }],
      ocorrencias: [{ id: 'o1', zona_id: 'zona-7', status: 'aberta' }],
      mesaEstado: [{ secao_id: 'sec-1', votacao: false }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await clicarResetar(p, false);

  check('caso3: zero erros JS', erros.length === 0, erros.join('; '));
  const restantesOcor = await p.evaluate(() => window.__ocorrenciasRestantes());
  const restantesMesa = await p.evaluate(() => window.__mesaEstadoRestantes());
  check('caso3: cancelar não apaga ocorrências', restantesOcor === 1, 'restantes=' + restantesOcor);
  check('caso3: cancelar não apaga mesa_estado', restantesMesa === 1, 'restantes=' + restantesMesa);
  await ctx.close();
}

// ── Caso 4: só tem mesa_estado de teste (sem ocorrências) — apaga só o que existe ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      secoes: [{ id: 'sec-1', zona_id: 'zona-7', numero: 1 }],
      ocorrencias: [],
      mesaEstado: [{ secao_id: 'sec-1', votacao: false }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await clicarResetar(p, true);

  check('caso4: zero erros JS', erros.length === 0, erros.join('; '));
  const restantesMesa = await p.evaluate(() => window.__mesaEstadoRestantes());
  check('caso4: apaga mesa_estado mesmo sem ocorrências', restantesMesa === 0, 'restantes=' + restantesMesa);
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_reset_problemas.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
