import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
export function createClient(url, key, opts) {
  return { __authHeader: opts?.global?.headers?.Authorization || null, __url: url };
}
`;

async function newPage(ctx) {
  const p = await ctx.newPage();
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.goto('http://localhost:8917/modules/_test_campo_shared.html');
  await p.waitForFunction(() => window.__testReady === true);
  return p;
}

// ── bootstrapCampoSession: sucesso ──
{
  const ctx = await b.newContext();
  let loginCalls = 0;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    loginCalls++;
    const body = route.request().postDataJSON();
    check('sime-login recebeu token+pin corretos', body.token === 'CONF0001' && body.pin === '1234');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'jwt.aqui.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'conferente', rotas: ['001'], local_id: null, secoes: null }) });
  });
  const p = await newPage(ctx);
  const r = await p.evaluate(async () => window.__testApi.bootstrapCampoSession({
    supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', token: 'CONF0001', pin: '1234',
  }));
  check('bootstrapCampoSession retorna client', r.client !== null);
  check('bootstrapCampoSession retorna zonaId', r.zonaId === 'zona-7');
  check('client tem o header de Authorization certo', r.client.__authHeader === 'Bearer jwt.aqui.x');
  check('bootstrapCampoSession retorna o escopo de rotas do token', JSON.stringify(r.rotas) === JSON.stringify(['001']));
  check('bootstrapCampoSession retorna localId/secoes null quando não usados', r.localId === null && r.secoes === null);

  // 2ª chamada com o MESMO token não deve rechamar sime-login (sessão em sessionStorage ainda válida)
  await p.evaluate(async () => window.__testApi.bootstrapCampoSession({
    supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', token: 'CONF0001', pin: '1234',
  }));
  check('reuso de sessão: não rechama sime-login pro mesmo token', loginCalls === 1, 'loginCalls=' + loginCalls);

  await ctx.close();
}

// ── bootstrapCampoSession: token diferente força nova troca ──
{
  const ctx = await b.newContext();
  let loginCalls = 0;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    loginCalls++;
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'jwt-' + body.token, exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x', tipo: 'conferente' }) });
  });
  const p = await newPage(ctx);
  await p.evaluate(async () => window.__testApi.bootstrapCampoSession({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', token: 'TOKEN_A', pin: '1111' }));
  const r2 = await p.evaluate(async () => window.__testApi.bootstrapCampoSession({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', token: 'TOKEN_B', pin: '2222' }));
  check('token diferente força nova troca (2 chamadas a sime-login)', loginCalls === 2, 'loginCalls=' + loginCalls);
  check('sessão nova reflete o token novo', r2.client.__authHeader === 'Bearer jwt-TOKEN_B');
  await ctx.close();
}

// ── bootstrapCampoSession: falha de rede → client null, sem travar ──
{
  const ctx = await b.newContext();
  await ctx.route('**/functions/v1/sime-login', async (route) => { await route.abort('failed'); });
  const p = await newPage(ctx);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const r = await p.evaluate(async () => window.__testApi.bootstrapCampoSession({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', token: 'X', pin: '0000' }));
  check('falha de rede: client null (não trava)', r.client === null);
  check('falha de rede: retorna erro descritivo', !!r.erro);
  check('falha de rede: zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── fila offline: enqueue/countPending/processQueue com retry ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx);

  await p.evaluate(async () => { await window.__testApi.enqueue('acao_teste', { foo: 'bar' }); });
  const pendentes1 = await p.evaluate(async () => window.__testApi.countPending());
  check('enqueue: 1 item pendente', pendentes1 === 1);

  // processQueue com sync que sempre falha → tentativas incrementa, continua pendente
  const restantesFalha = await p.evaluate(async () => {
    return window.__testApi.processQueue(async () => { throw new Error('rede indisponível'); });
  });
  check('processQueue (falha): item continua pendente', restantesFalha === 1);

  // processQueue com sync que funciona → item é removido
  const restantesOk = await p.evaluate(async () => {
    return window.__testApi.processQueue(async (acao, dados) => { /* sucesso */ });
  });
  check('processQueue (sucesso): fila esvazia', restantesOk === 0);
  const pendentes2 = await p.evaluate(async () => window.__testApi.countPending());
  check('countPending após sucesso: 0', pendentes2 === 0);

  await ctx.close();
}

// ── fila offline: 5 falhas seguidas marca como erro e para de contar como pendente ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx);
  await p.evaluate(async () => { await window.__testApi.enqueue('acao_persistente', { x: 1 }); });
  for (let i = 0; i < 5; i++) {
    await p.evaluate(async () => window.__testApi.processQueue(async () => { throw new Error('falha'); }));
  }
  const pendentesFinal = await p.evaluate(async () => window.__testApi.countPending());
  check('após 5 falhas: item vira "erro", some da contagem de pendentes', pendentesFinal === 0, 'pendentes=' + pendentesFinal);
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
