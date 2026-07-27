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
        maybeSingle(){
          if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { id: 'sec-uuid-801', numero: 801, local_nome: 'Escola Dia Um', municipio: 'Cidade Teste', eleitores: 60, parada: null, sime_rotas: null },
            ], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    channel(name) {
      const chan = { on() { return chan; }, subscribe() { return chan; } };
      return chan;
    },
    removeChannel() {},
  };
}
`;

// ── Caso 1: sem tv_token → CITIES = fallback (3 municípios), clima aponta pra Campo Maior ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const reqs = [];
  await p.route('**api.open-meteo.com/**', async (route) => { reqs.push(route.request().url()); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 30, apparent_temperature: 32, precipitation_probability: 10, weathercode: 1 }, hourly: { precipitation_probability: [10,10,10] } }) }); });
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html');
  await p.waitForTimeout(500);
  const nCities = await p.evaluate(() => CITIES.length);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: CITIES = fallback (3 municípios)', nCities === 3, 'n=' + nCities);
  check('sem tv_token: clima usa coordenadas de Campo Maior (fallback)', reqs.some((u) => u.includes('latitude=-4.8252')));
  await ctx.close();
}

// ── Caso 2: com tv_token → CITIES real (reload), clima aponta pra zona real ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const reqs = [];
  await p.route('**api.open-meteo.com/**', async (route) => { reqs.push(route.request().url()); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 25, apparent_temperature: 26, precipitation_probability: 5, weathercode: 0 }, hourly: { precipitation_probability: [5,5,5] } }) }); });
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500); // fetch + reload automático (CITIES)

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const cities = await p.evaluate(() => CITIES);
  check('após reload: CITIES = 1 município real (não os 3 do fallback)', cities.length === 1, 'len=' + cities?.length);
  check('clima usa lat/lon reais da zona (-10.5/-50.5)', reqs.some((u) => u.includes('latitude=-10.5') && u.includes('longitude=-50.5')));
  const hdr = await p.locator('.wc-hdr').textContent();
  check('cabeçalho do clima vira dinâmico (CIDADE TESTE)', hdr.includes('CIDADE TESTE'));

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
