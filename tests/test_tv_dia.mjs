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

// ── Caso 1: sem tv_token → CITIES = fallback (3 municípios) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html');
  await p.waitForTimeout(500);
  const nCities = await p.evaluate(() => CITIES.length);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: CITIES = fallback (3 municípios)', nCities === 3, 'n=' + nCities);
  await ctx.close();
}

// ── Caso 2: com tv_token → CITIES real (reload) ──
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

  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500); // fetch + reload automático (CITIES)

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const cities = await p.evaluate(() => CITIES);
  check('após reload: CITIES = 1 município real (não os 3 do fallback)', cities.length === 1, 'len=' + cities?.length);

  await ctx.close();
}

// ── Caso 3 (03/09/2026, achado real): horário de encerramento vem de
// sime_eleicoes (Supabase) via window.ELEICAO_ATIVA, não só de
// localStorage['sime_eleicao_v1'] — essa chave só existe na TV se alguém já
// tiver aberto o Painel Principal NO MESMO aparelho (nunca acontece na
// prática), então antes o campo de auto-troca sempre caía no "17:00"
// chumbado, mesmo a zona tendo um horário de encerramento diferente
// configurado de verdade. ──
{
  const STUB_COM_ELEICAO = STUB_SUPABASE_JS.replace(
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });",
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });\n          if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'el-1', turno: 1, zona_id: 'zona-x', data_d: '2026-10-04', data_d1: '2026-10-03', horario_ab: '08:00:00', horario_enc: '16:30:00', nome: 'Eleição Teste' }, error: null });"
  );
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COM_ELEICAO });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500);

  check('com eleição real: zero erros JS', erros.length === 0, erros.join('; '));
  const eleicaoAtiva = await p.evaluate(() => window.ELEICAO_ATIVA);
  check('window.ELEICAO_ATIVA populado a partir do Supabase', eleicaoAtiva?.horario_enc === '16:30:00', JSON.stringify(eleicaoAtiva));
  const hor = await p.evaluate(() => window.getHor());
  check('getHor() usa o horário real (16:30), não o fallback chumbado (17:00)', hor.enc === '16:30' && hor.ab === '08:00', JSON.stringify(hor));
  const autoSwitchVal = await p.evaluate(() => document.getElementById('auto-switch')?.value);
  check('campo #auto-switch é pré-preenchido com o horário real de encerramento', autoSwitchVal === '16:30', autoSwitchVal);

  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
