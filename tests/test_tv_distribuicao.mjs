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
          if (t === 'sime_rotas') {
            return resolve({ data: [ { id: 'r1', codigo: '999', nome: 'Rota 999', municipios: ['Zona De Teste'] } ], error: null });
          }
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { numero: 1, local_nome: 'A', rota_id: 'r1', parada: 1 },
              { numero: 2, local_nome: 'A', rota_id: 'r1', parada: 1 },
              { numero: 3, local_nome: 'B', rota_id: 'r1', parada: 2 },
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

// ── Caso 1: sem tv_token → mantém ROTAS_FALLBACK (12 rotas da 7ª Zona) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html');
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => getRotasInfo());
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: usa ROTAS_FALLBACK (12 rotas)', Object.keys(info).length === 12, 'n=' + Object.keys(info).length);
  check('sem tv_token: Rota 001 = Campo Maior/4 (dado hardcoded original)', info['Rota 001']?.mun === 'Campo Maior' && info['Rota 001']?.total === 4);
  await ctx.close();
}

// ── Caso 2: com tv_token → busca rotas reais do Supabase, getRotasInfo() usa elas ──
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

  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(700);

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const info = await p.evaluate(() => getRotasInfo());
  check('com tv_token: usa a rota real (Rota 999), não as 12 hardcoded', Object.keys(info).length === 1 && !!info['Rota 999']);
  check('com tv_token: total real = 3 seções (1+2 na parada 1, 3 na parada 2)', info['Rota 999']?.total === 3);
  check('com tv_token: município real preservado', info['Rota 999']?.mun === 'Zona De Teste');

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
