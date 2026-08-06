// Testa "🗑 Resetar Problemas (zona)" em SIME_admin.html: o botão antigo
// ("Resetar dados de teste") virou no-op depois da migração pro Supabase, e
// isso deixava ocorrências de teste presas na tela pra sempre — reimplementado
// com escopo estreito (só sime_ocorrencias da zona do usuário, nunca
// sime_mesa_estado) e confirmação mostrando a contagem antes de apagar.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ ocorrencias }) {
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }];
  let OCORRENCIAS = ${JSON.stringify(ocorrencias)};
  let LOGS = [];
  window.__logs = LOGS;
  window.__ocorrenciasRestantes = () => OCORRENCIAS.length;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = { _op: null, _filters: {}, _count: null };
      qb.select = (col, opts) => { if (opts && opts.count === 'exact' && opts.head === true) qb._count = true; return qb; };
      qb.eq = (c, v) => { qb._filters[c] = v; return qb; };
      qb.order = () => qb; qb.not = () => qb; qb.limit = () => qb; qb.in = () => qb;
      qb.delete = () => { qb._op = 'delete'; return qb; };
      qb.insert = (o) => { if (t === 'sime_logs') LOGS.push(o); return Promise.resolve({ error: null }); };
      qb.maybeSingle = () => {
        if (t === 'sime_usuarios') return Promise.resolve({ data: { id: 'u1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      const matches = (row) => Object.entries(qb._filters).every(([k, v]) => row[k] === v);
      qb.then = (resolve) => {
        if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
        if (t === 'sime_secoes') return resolve({ data: [], error: null });
        if (t === 'sime_usuarios') return resolve({ data: [], error: null });
        if (t === 'sime_ocorrencias') {
          if (qb._op === 'delete') {
            OCORRENCIAS = OCORRENCIAS.filter((o) => !matches(o));
            return resolve({ error: null });
          }
          if (qb._count) return resolve({ data: null, count: OCORRENCIAS.filter(matches).length, error: null });
          return resolve({ data: OCORRENCIAS.filter(matches), error: null });
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

// ── Caso 1: confirma e apaga só as ocorrências da própria zona ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('dialog', (d) => d.accept());
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      ocorrencias: [
        { id: 'o1', zona_id: 'zona-7', status: 'aberta' },
        { id: 'o2', zona_id: 'zona-7', status: 'resolvida' },
        { id: 'o3', zona_id: 'zona-94', status: 'aberta' },
      ],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Config')");
  await p.waitForTimeout(150);
  await p.click("button:has-text('Resetar Problemas')");
  await p.waitForTimeout(300);

  check('caso1: zero erros JS', erros.length === 0, erros.join('; '));
  const restantes = await p.evaluate(() => window.__ocorrenciasRestantes());
  check('caso1: apagou as 2 da própria zona, preservou a de outra', restantes === 1, 'restantes=' + restantes);
  const logs = await p.evaluate(() => window.__logs);
  const logReset = logs.find(l => l.acao === 'reset_problemas');
  check('caso1: registrou log de auditoria com a quantidade', logReset && logReset.payload.quantidade === 2, JSON.stringify(logReset));
  await ctx.close();
}

// ── Caso 2: zona sem problemas nenhum — não pede confirmação, avisa e não quebra ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  let dialogApareceu = false;
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('dialog', (d) => { dialogApareceu = true; d.dismiss(); });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ ocorrencias: [] }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Config')");
  await p.waitForTimeout(150);
  await p.click("button:has-text('Resetar Problemas')");
  await p.waitForTimeout(300);

  check('caso2: zero erros JS', erros.length === 0, erros.join('; '));
  check('caso2: nem chega a perguntar se não há nada pra apagar', !dialogApareceu);
  await ctx.close();
}

// ── Caso 3: cancelar a confirmação não apaga nada ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      ocorrencias: [{ id: 'o1', zona_id: 'zona-7', status: 'aberta' }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Config')");
  await p.waitForTimeout(150);
  await p.click("button:has-text('Resetar Problemas')");
  await p.waitForTimeout(300);

  check('caso3: zero erros JS', erros.length === 0, erros.join('; '));
  const restantes = await p.evaluate(() => window.__ocorrenciasRestantes());
  check('caso3: cancelar não apaga nada', restantes === 1, 'restantes=' + restantes);
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_reset_problemas.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
