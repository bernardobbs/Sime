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
              { numero: 501, local_nome: 'Escola Teste Um', municipio: 'Zona De Teste', eleitores: 100, parada: null, sime_rotas: null },
              { numero: 502, local_nome: 'Escola Teste Um', municipio: 'Zona De Teste', eleitores: 90,  parada: null, sime_rotas: null },
              { numero: 601, local_nome: 'Escola Teste Dois', municipio: 'Outra Zona', eleitores: 80,  parada: null, sime_rotas: null },
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

function setupRoutes(p) {
  return Promise.all([
    p.route('**/functions/v1/sime-login', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
    }),
    p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
    }),
  ]);
}

// ── Caso 1: sem tv_token → usa CITIES_FALLBACK original (3 municípios) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html');
  await p.waitForTimeout(400);
  const nCities = await p.evaluate(() => typeof CITIES !== 'undefined' ? CITIES.length : -1);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: CITIES = fallback original (3 municípios)', nCities === 3, 'nCities=' + nCities);
  await ctx.close();
}

// ── Caso 2: com tv_token (1ª vez) → busca dado real, grava cache, recarrega,
//    e no reload o script já monta CITIES com o dado real (2 municípios de teste) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await setupRoutes(p);

  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  // aguarda o reload automático (1ª vez sem cache) — waitForNavigation
  await p.waitForTimeout(1500); // tempo pro fetch + reload automático acontecerem

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const cities = await p.evaluate(() => CITIES);
  check('após reload: CITIES tem os 2 municípios reais (não os 3 do fallback)', cities.length === 2, 'len=' + cities?.length);
  const zonaTeste = cities.find((c) => c.city === 'Zona De Teste');
  check('município real "Zona De Teste" presente', !!zonaTeste);
  check('local agrupa as 2 seções (501,502) sob 1 local', zonaTeste?.locs?.[0]?.s?.length === 2);
  check('id do local é estável (município::nome, não CM-01)', zonaTeste?.locs?.[0]?.id === 'Zona De Teste::Escola Teste Um');

  const cache = await p.evaluate(() => localStorage.getItem('sime_tv_cities_v1'));
  check('cache de cidades persistido em localStorage', !!cache);

  await ctx.close();
}

// ── Caso 3: reload subsequente NÃO deve recarregar de novo em loop ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await setupRoutes(p);
  let navCount = 0;
  p.on('framenavigated', () => navCount++);

  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500); // tempo de sobra pro reload automático (1ª vez) acontecer
  const navAposPrimeiraCarga = navCount;
  await p.waitForTimeout(1500); // se houvesse loop, teria recarregado de novo aqui
  check('não entra em loop de reload (navegações param após a 1ª troca)', navCount === navAposPrimeiraCarga, `antes=${navAposPrimeiraCarga} depois=${navCount}`);

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
