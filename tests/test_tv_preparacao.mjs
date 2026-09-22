import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

// stub do módulo ESM @supabase/supabase-js (createClient) — devolve um client
// falso cujo .from() sabe responder sime_secoes/sime_zonas com dado de teste.
const STUB_SUPABASE_JS = `
export function createClient(url, key, opts) {
  const auth = opts?.global?.headers?.Authorization || '';
  return {
    __authHeader: auth,
    from(t) {
      const self = this;
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; },
        maybeSingle(){
          if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Zona De Teste', lat: -1, lon: -1 }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: Array.from({length: 42}, (_,i)=>({numero:i+1, local_nome:'Local '+i, municipio:'Zona De Teste', eleitores:100, parada:null, sime_rotas:null})), error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    channel(name) { const chan = { on() { return chan; }, subscribe() { return chan; } }; return chan; },
    removeChannel() {},
  };
}
`;

// ── Caso 1: sem tv_token nenhum → segue no fallback local (174), sem travar ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html');
  await p.waitForTimeout(400);
  const total = await p.locator('#fc-total').textContent();
  check('sem tv_token: não trava a página (zero erros JS)', erros.length === 0, erros.join('; '));
  check('sem tv_token: mantém o fallback 174', total.trim() === '174');
  await ctx.close();
}

// ── Caso 2: com tv_token na URL → troca por sessão, busca dados reais, atualiza total e branding ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));

  await p.route('**/functions/v1/sime-login', async (route) => {
    const body = route.request().postDataJSON();
    check('sime-login recebeu o token certo', body.token === 'TVTOKEN96');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'fake.jwt.aqui', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-96' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKEN96');
  await p.waitForTimeout(600);

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const total = await p.locator('#fc-total').textContent();
  check('com tv_token: total real (42, não 174)', total.trim() === '174' ? false : true, 'total=' + total);
  const totalReal = await p.evaluate(() => window.SIME_TOTAL_REAL);
  check('window.SIME_TOTAL_REAL = 42 (42 seções mockadas)', totalReal === 42);
  const brand = await p.locator('.f-brand').textContent();
  check('branding vira dinâmico (zona/município mockados)', brand.includes('96ª Zona') && brand.includes('Zona De Teste'));

  const storage = await p.evaluate(() => localStorage.getItem('sime_tv_session_v1'));
  check('sessão persistida em localStorage', !!storage && JSON.parse(storage).jwt === 'fake.jwt.aqui');

  await ctx.close();
}

// ── Caso 3: reload SEM tv_token na URL, mas com sessão já salva → reusa sem novo POST ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  let chamadasLogin = 0;
  await p.route('**/functions/v1/sime-login', async (route) => {
    chamadasLogin++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'fake.jwt.aqui', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-96' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });

  // primeira visita: com tv_token, pra popular localStorage
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKEN96');
  await p.waitForTimeout(500);
  check('1ª visita chamou sime-login 1x', chamadasLogin === 1);

  // segunda "visita" (reload sem querystring) na MESMA aba reaproveita localStorage
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html');
  await p.waitForTimeout(500);
  check('reload sem tv_token NÃO rechama sime-login (sessão ainda válida)', chamadasLogin === 1);
  const totalReal = await p.evaluate(() => window.SIME_TOTAL_REAL);
  check('reload sem tv_token ainda busca dados reais (sessão reaproveitada)', totalReal === 42);

  await ctx.close();
}

// ── Caso 4 (22/09/2026, pedido direto: "serão preparadas 147 urnas de
// seções, 27 contigencias, 174 urnas ao todo") — com urnas_secoes/
// urnas_contingencia configurados em sime_eleicoes, o Total passa a ser a
// SOMA dos dois (não mais a contagem de seções nem o fallback 174 — os
// valores de teste, 100+20=120, são deliberadamente diferentes dos dois
// pra não dar falso positivo por coincidência numérica). ──
{
  const STUB_COM_ELEICAO = STUB_SUPABASE_JS.replace(
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Zona De Teste', lat: -1, lon: -1 }, error: null });",
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Zona De Teste', lat: -1, lon: -1 }, error: null });\n          if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'el-1', turno: 1, zona_id: 'zona-96', horario_ab: '08:00:00', horario_enc: '17:00:00', urnas_secoes: 100, urnas_contingencia: 20 }, error: null });"
  );
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'fake.jwt.aqui', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-96' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COM_ELEICAO });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKEN96');
  await p.waitForTimeout(600);

  check('com urnas configuradas: zero erros JS', erros.length === 0, erros.join('; '));
  const eleicaoAtiva = await p.evaluate(() => window.ELEICAO_ATIVA);
  check('window.ELEICAO_ATIVA populado a partir do Supabase', eleicaoAtiva?.urnas_secoes === 100 && eleicaoAtiva?.urnas_contingencia === 20, JSON.stringify(eleicaoAtiva));
  const total = await p.locator('#fc-total').textContent();
  check('Total = urnas_secoes + urnas_contingencia (120), não SECOES.length (42) nem o fallback (174)', total.trim() === '120', 'total=' + total);

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
