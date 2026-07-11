import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
export function createClient(url, key) {
  let session = null;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; },
        maybeSingle(){
          if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade X', estado: 'CE' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { numero: 1, local_nome: 'Escola A', municipio: 'Cidade X', eleitores: 100, parada: null, sime_rotas: { codigo: '001' } },
              { numero: 2, local_nome: 'Escola A', municipio: 'Cidade X', eleitores: 80,  parada: null, sime_rotas: { codigo: '001' } },
              { numero: 3, local_nome: 'Escola B', municipio: 'Cidade Y', eleitores: 50,  parada: null, sime_rotas: null },
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

// ── Caso 1: offline → mantém os 175 do fallback (com a seção órfã 0146 já conhecida) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.goto('http://localhost:8917/modules/SIME_coordenador_preparacao.html');
  await p.waitForTimeout(400);
  await p.click('#login-offline');
  await p.waitForTimeout(200);
  check('offline: zero erros JS', erros.length === 0, erros.join('; '));
  const n = await p.evaluate(() => SECOES.length);
  check('offline: SECOES = fallback (174)', n === 174, 'n=' + n);
  const footTotal = await p.locator('.f-count.total .f-val').textContent();
  check('offline: rodapé mantém 174 (texto estático original)', footTotal.trim() === '174');
  await ctx.close();
}

// ── Caso 2: login real → SECOES real, cabeçalho/rodapé dinâmicos, state preservado ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.goto('http://localhost:8917/modules/SIME_coordenador_preparacao.html');
  await p.waitForTimeout(400);

  // marca uma seção do FALLBACK como "carga" antes do login, pra provar que o
  // rebuild do state não descarta progresso de seções que também existem no dado real
  await p.evaluate(() => { state['0001'] = { carga: true, prep: false, lacre: false }; });

  await p.fill('#login-email', 'coord@sime.gov.br');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);

  check('login: zero erros JS', erros.length === 0, erros.join('; '));
  const secoes = await p.evaluate(() => SECOES);
  check('login: SECOES vira o dado real (3 seções)', secoes.length === 3, 'n=' + secoes.length);
  const s1 = secoes.find((s) => s.n === '0001');
  check('login: seção 1 tem rota real (Rota 001)', s1?.rota === 'Rota 001');
  check('login: seção 1 tem local/município reais', s1?.local === 'Escola A' && s1?.mun === 'Cidade X');
  const s3 = secoes.find((s) => s.n === '0003');
  check('login: seção sem rota vira "—"', s3?.rota === '—');

  const stateAposLogin = await p.evaluate(() => state['0001']);
  check('login: progresso da seção 0001 preservado após rebuild do state (carga=true)', stateAposLogin?.carga === true);

  const subTxt = await p.locator('.h-sub').textContent();
  check('login: cabeçalho vira dinâmico (96ª Zona/CE, 3 seções, 2 locais, 230 eleitores)', subTxt.includes('96ª Zona/CE') && subTxt.includes('3 seções') && subTxt.includes('2 locais') && subTxt.includes('230'));
  const footTotal = await p.locator('.f-count.total .f-val').textContent();
  check('login: rodapé vira dinâmico (3, não mais 174)', footTotal.trim() === '3');

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
