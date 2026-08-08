import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ eleicao, cargaLacreExistente } = {}) {
  return `
export function createClient(url, key) {
  let session = null;
  window.__ops = [];
  let CARGA_LACRE = ${JSON.stringify(cargaLacreExistente || [])};
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = { _filters: {} };
      qb.select = function(){ return qb; };
      qb.eq = function(c, v){ qb._filters[c] = v; return qb; };
      qb.order = function(){ return qb; }; qb.not = function(){ return qb; }; qb.limit = function(){ return qb; };
      qb.upsert = function(payload){
        window.__ops.push({ t, op: 'upsert', payload });
        const i = CARGA_LACRE.findIndex(r => r.secao_id === payload.secao_id && r.eleicao_id === payload.eleicao_id);
        if (i > -1) CARGA_LACRE[i] = { ...CARGA_LACRE[i], ...payload }; else CARGA_LACRE.push(payload);
        return Promise.resolve({ error: null });
      };
      qb.maybeSingle = function(){
        if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade X', estado: 'CE' }, error: null });
        if (t === 'sime_eleicoes') return Promise.resolve({ data: ${JSON.stringify(eleicao || null)}, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      qb.then = function(resolve){
        if (t === 'sime_secoes') {
          return resolve({ data: [
            { id: 'sec-uuid-1', numero: 1, local_nome: 'Escola A', municipio: 'Cidade X', eleitores: 100, parada: null, sime_rotas: { codigo: '001' } },
            { id: 'sec-uuid-2', numero: 2, local_nome: 'Escola A', municipio: 'Cidade X', eleitores: 80,  parada: null, sime_rotas: { codigo: '001' } },
            { id: 'sec-uuid-3', numero: 3, local_nome: 'Escola B', municipio: 'Cidade Y', eleitores: 50,  parada: null, sime_rotas: null },
          ], error: null });
        }
        if (t === 'sime_carga_lacre') return resolve({ data: CARGA_LACRE.filter(r => !qb._filters.eleicao_id || r.eleicao_id === qb._filters.eleicao_id), error: null });
        return resolve({ data: [], error: null });
      };
      return qb;
    },
  };
}
`;
}
const STUB_SUPABASE_JS = stubSupabaseJs();

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

// ── Caso 3: com eleição ativa — toggle grava em sime_carga_lacre (não só
// localStorage) e o badge de sincronização aparece. Achado crítico da
// auditoria: toggle()/save() gravavam só em localStorage, sem Supabase, sem
// fila offline, sem badge — regra 5 do CLAUDE.md. ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const stub = stubSupabaseJs({ eleicao: { id: 'ele-uuid-1', turno: 1, zona_id: 'zona-96', data_d: '2026-10-04' } });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });
  await p.goto('http://localhost:8917/modules/SIME_coordenador_preparacao.html');
  await p.waitForTimeout(400);
  await p.fill('#login-email', 'coord@sime.gov.br');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);

  check('badge de sync aparece depois do login (estava escondido antes)', await p.evaluate(() => document.getElementById('sync-badge').style.display !== 'none'));

  await p.click('.sec-card[data-sec="0001"] .ck.carga');
  await p.waitForTimeout(300);

  const ops = await p.evaluate(() => window.__ops.filter(o => o.t === 'sime_carga_lacre'));
  check('toggle "carga" grava em sime_carga_lacre (não só localStorage)', ops.length === 1, JSON.stringify(ops));
  check('upsert usa o UUID real da seção e da eleição', ops[0]?.payload?.secao_id === 'sec-uuid-1' && ops[0]?.payload?.eleicao_id === 'ele-uuid-1', JSON.stringify(ops[0]));
  check('upsert grava carga=true, preparação/lacre em falso', ops[0]?.payload?.carga === true && ops[0]?.payload?.preparacao === false && ops[0]?.payload?.lacre === false, JSON.stringify(ops[0]));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 4: progresso já gravado por outro coordenador/aparelho aparece ao
// entrar — antes ficava sempre zerado, mesmo já marcado no banco. ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const stub = stubSupabaseJs({
    eleicao: { id: 'ele-uuid-1', turno: 1, zona_id: 'zona-96', data_d: '2026-10-04' },
    cargaLacreExistente: [{ eleicao_id: 'ele-uuid-1', secao_id: 'sec-uuid-2', carga: true, preparacao: true, lacre: false }],
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });
  await p.goto('http://localhost:8917/modules/SIME_coordenador_preparacao.html');
  await p.waitForTimeout(400);
  await p.fill('#login-email', 'coord@sime.gov.br');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);

  const stateSec2 = await p.evaluate(() => state['0002']);
  check('progresso de outro aparelho (secão 0002) aparece ao entrar', stateSec2?.carga === true && stateSec2?.prep === true && stateSec2?.lacre === false, JSON.stringify(stateSec2));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 5: marcar fora de ordem (lacre sem carga/preparação antes) — mesmo
// padrão do Instalador, tela idêntica (achado "médio": inconsistência entre
// os dois módulos). ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const stub = stubSupabaseJs({ eleicao: { id: 'ele-uuid-1', turno: 1, zona_id: 'zona-96', data_d: '2026-10-04' } });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stub });
  });
  await p.goto('http://localhost:8917/modules/SIME_coordenador_preparacao.html');
  await p.waitForTimeout(400);
  await p.fill('#login-email', 'coord@sime.gov.br');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);

  await p.click('.sec-card[data-sec="0001"] .ck.lacre'); // pula carga e preparação
  await p.waitForTimeout(200);
  const stateSec1 = await p.evaluate(() => state['0001']);
  check('marcar "lacre" direto, sem carga/preparação antes, não é bloqueado', stateSec1?.lacre === true, JSON.stringify(stateSec1));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
