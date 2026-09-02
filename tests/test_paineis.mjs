import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
export function createClient(url, key, opts) {
  return {
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; },
        maybeSingle(){ return Promise.resolve({ data: null, error: null }); },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { numero: 701, local_nome: 'Escola Painel', municipio: 'Zona Painel', eleitores: 50, parada: null, sime_rotas: null },
            ], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
  };
}
`;

// ── Caso 1: sem tv_token → CITIES/ALL_SECS/SEC_MAP mantêm o fallback original ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_paineis.html');
  await p.waitForTimeout(400);
  const nCities = await p.evaluate(() => CITIES.length);
  const nAllSecs = await p.evaluate(() => ALL_SECS.length);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: CITIES = fallback (3 municípios)', nCities === 3, 'n=' + nCities);
  check('sem tv_token: ALL_SECS consistente com o fallback (>100 seções)', nAllSecs > 100, 'n=' + nAllSecs);
  await ctx.close();
}

// ── Caso 2: com tv_token → CITIES/ALL_SECS/SEC_MAP viram o dado real (sem reload) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });

  await p.goto('http://localhost:8917/modules/SIME_paineis.html?tv_token=TVTOKENX');
  await p.waitForTimeout(700);

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const cities = await p.evaluate(() => CITIES);
  check('com tv_token: CITIES vira 1 município real (sem reload)', cities.length === 1, 'len=' + cities?.length);
  const allSecs = await p.evaluate(() => ALL_SECS);
  check('com tv_token: ALL_SECS recalculado (1 seção real, "0701")', JSON.stringify(allSecs) === JSON.stringify(['0701']));
  const secMap = await p.evaluate(() => SEC_MAP['0701']);
  check('com tv_token: SEC_MAP recalculado com o local real', secMap?.city === 'Zona Painel' && secMap?.loc === 'Escola Painel');

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
