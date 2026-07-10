import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ signInOk }) {
  return `
export function createClient(url, key) {
  let session = null;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session?.user || null } }),
      signInWithPassword: async ({ email, password }) => {
        if (${signInOk ? 'true' : 'false'}) { session = { user: { email } }; return { data: { session }, error: null }; }
        return { data: { session: null }, error: { message: 'Invalid login credentials' } };
      },
    },
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; },
        maybeSingle(){ return Promise.resolve({ data: null, error: null }); },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { numero: 901, local_nome: 'Escola Real', municipio: 'Municipio Real', eleitores: 40, parada: null, sime_rotas: null },
            ], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
  };
}
`;
}

// ── Caso 1: overlay de login aparece por padrão (sem sessão) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ signInOk: true }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(400);
  check('sem sessão: zero erros JS', erros.length === 0, erros.join('; '));
  const overlayVisible = await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none');
  check('sem sessão: overlay de login visível', overlayVisible);
  await ctx.close();
}

// ── Caso 2: credenciais erradas → mostra erro, mantém overlay ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ signInOk: false }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(400);
  await p.fill('#login-email', 'errado@x.com');
  await p.fill('#login-pass', 'senhaerrada');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(300);
  const erroTxt = await p.locator('#login-erro').textContent();
  const overlayVisible = await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none');
  check('credenciais erradas: mostra mensagem de erro', erroTxt.trim().length > 0);
  check('credenciais erradas: overlay continua visível', overlayVisible);
  await ctx.close();
}

// ── Caso 3: login OK → some o overlay, SECTIONS vira dado real, dropdown atualiza ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ signInOk: true }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(400);
  await p.fill('#login-email', 'coord@sime.gov.br');
  await p.fill('#login-pass', 'senhacerta');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);

  check('login OK: zero erros JS', erros.length === 0, erros.join('; '));
  const overlayVisible = await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none');
  check('login OK: overlay escondido', !overlayVisible);
  const nSections = await p.evaluate(() => SECTIONS.length);
  check('login OK: SECTIONS vira o dado real (1 seção mockada)', nSections === 1, 'n=' + nSections);
  const dropdownOpts = await p.evaluate(() => [...document.getElementById('sec-filter-cidade').options].map(o => o.value));
  check('login OK: dropdown de município atualizado com o município real', dropdownOpts.includes('Municipio Real') && !dropdownOpts.includes('Campo Maior'), JSON.stringify(dropdownOpts));

  await ctx.close();
}

// ── Caso 4: "continuar offline" libera a UI sem sessão nenhuma (contingência) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ signInOk: true }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(400);
  await p.click('#login-offline');
  await p.waitForTimeout(200);
  check('offline: zero erros JS', erros.length === 0, erros.join('; '));
  const overlayVisible = await p.evaluate(() => getComputedStyle(document.getElementById('login-overlay')).display !== 'none');
  check('offline: overlay escondido sem precisar de login', !overlayVisible);
  const nSections = await p.evaluate(() => SECTIONS.length);
  check('offline: SECTIONS continua no fallback original (175 — inclui a seção órfã 0146 já conhecida)', nSections === 175, 'n=' + nSections);
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
