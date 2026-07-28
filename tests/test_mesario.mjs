// Testa a integração REAL de SIME_mesario.html com a Fase 4 (login token+PIN,
// resolução de seção via sime_dados.js, sincronização via sime_acao_mesa/
// sime_acao_midia, fallback offline). Serve o arquivo de produção direto —
// nenhuma cópia/transformação — via http.server (ES modules são CORS-blocked
// sob file://, mesmo padrão já usado nesta sessão pros outros módulos.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// Estas suítes exercitam o fluxo COM PIN. A operação suprimiu o PIN por ora
// (SIME_CONFIG.exigirPin=false), mas o caminho continua no código e volta
// quando o cartório quiser — então aqui a configuração é fixada, em vez de
// deixar a suíte seguir um flag de produção que muda debaixo dela.
const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;


const STUB_SUPABASE_JS = `
function rowsFor(table) {
  return (window.__mockConfig[table] || []);
}
function matchFilters(row, filters) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  then(resolve) {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    __authHeader: opts?.global?.headers?.Authorization || null,
    from(table) { return new QB(table); },
    // O mesário assina sime_mesa_estado da própria seção pra saber quando a
    // equipe resolve um pânico pelo Admin — sem estes dois o módulo quebra
    // logo depois do login.
    channel(name) {
      const chan = { on(ev, filtro, cb) { window.__mockConfig.realtimeCallback = cb; return chan; }, subscribe() { return chan; } };
      return chan;
    },
    removeChannel() {},
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      if (window.__mockConfig.rpcShouldFail) {
        return Promise.resolve({ data: null, error: { message: 'mock rpc fail' } });
      }
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

async function newPage(ctx, mockConfig) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [
      { id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' },
    ],
    rpcCalls: [],
    rpcShouldFail: false,
  };
}

// ── 1. Login bem-sucedido: resolve seção real do token, mostra no display ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    const body = route.request().postDataJSON();
    check('sime-login recebeu token+pin', body.token === 'MESA0063' && body.pin === '1234');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.mesario.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'mesario',
      rotas: null, local_id: null, secoes: ['0063'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.waitForFunction(() => document.querySelector('.d-sec')?.textContent?.includes('0063'));
  const secText = await p.textContent('.d-sec');
  check('display mostra a seção real do token (0063)', secText.includes('0063'));
  const locText = await p.textContent('.d-local');
  check('display mostra local_nome/município reais', locText.includes('Treze de Março') && locText.includes('Campo Maior'));
  check('zero erros JS não tratados no login', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Ação simples (Zerésima) sincroniza via sime_acao_mesa com payload correto ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  check('login não dispara nenhuma chamada rpc por si só', (await p.evaluate(() => window.__mockConfig.rpcCalls.length)) === 0);

  await p.click('#btn-zero'); // confirm:false — executa direto, sem modal
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_zeresima === true));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const zeroCall = calls.find((c) => c.params?.p_zeresima === true);
  check('sime_acao_mesa chamada com p_zeresima=true', !!zeroCall);
  check('payload inclui secao_id/eleicao_id reais (não hardcoded)', zeroCall.params.p_secao_id === 'sec-uuid-63' && zeroCall.params.p_eleicao_id === 'ele-uuid-1');
  check('payload marca origem mesario', zeroCall.params.p_origem === 'mesario');
  await ctx.close();
}

// ── 3. BUG bu/urna corrigido: doAction realmente marca S.bu/S.urna=true e propaga no payload ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');

  // BU: ação com confirm — abre modal, precisa confirmar
  await p.click('#btn-bu');
  await p.click('#sh-ok');
  await p.waitForFunction((SEC) => JSON.parse(localStorage.getItem('sime_mesa_v1') || '{}')[SEC]?.bu === true, '0063');
  const mesaLS = await p.evaluate((SEC) => JSON.parse(localStorage.getItem('sime_mesa_v1') || '{}')[SEC], '0063');
  check('BUG FIX: S.bu vira true de verdade (via localStorage)', mesaLS?.bu === true);

  // Urna: ação com confirm
  await p.click('#btn-urna');
  await p.click('#sh-ok');
  const mesaLS2 = await p.evaluate((SEC) => JSON.parse(localStorage.getItem('sime_mesa_v1') || '{}')[SEC], '0063');
  check('BUG FIX: S.urna vira true de verdade (via localStorage)', mesaLS2?.urna === true);

  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const urnaCall = calls.reverse().find((c) => c.params && 'p_urna_recolhida' in c.params);
  check('payload sime_acao_mesa propaga p_urna_recolhida=true (não fica preso no bug antigo)', urnaCall?.params?.p_urna_recolhida === true);
  check('payload sime_acao_mesa propaga p_bu_impresso=true', urnaCall?.params?.p_bu_impresso === true);
  await ctx.close();
}

// ── 4. Mídia pronta sincroniza via sime_acao_midia ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');

  // Precisa encerrar antes (guard em marcarMidiaPronta). O botão de mídia só
  // desbloqueia no próximo tick do renderMidiaBtn() (setInterval 3s) — chama
  // manualmente pra não esperar o intervalo real no teste.
  await p.click('#btn-enc');
  await p.click('#sh-ok');
  await p.evaluate(() => window.renderMidiaBtn());
  await p.evaluate(() => window.marcarMidiaPronta());
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_acao_midia'));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const midiaCall = calls.find((c) => c.name === 'sime_acao_midia');
  check('sime_acao_midia chamado com p_status=pronta_para_coleta', midiaCall?.params?.p_status === 'pronta_para_coleta');
  check('payload de mídia usa secao_id/eleicao_id reais', midiaCall.params.p_secao_id === 'sec-uuid-63' && midiaCall.params.p_eleicao_id === 'ele-uuid-1');
  await ctx.close();
}

// ── 5. Falha de rede na sincronização → enfileira no IndexedDB, sem travar a UI ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');

  await p.click('#btn-zero');
  await p.waitForTimeout(300); // dá tempo pro enqueue (IndexedDB) assíncrono terminar

  const pendentes = await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('sime_offline', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('queue', 'readonly');
      const getAllReq = tx.objectStore('queue').index('status').getAll('pendente');
      getAllReq.onsuccess = () => resolve(getAllReq.result.length);
      getAllReq.onerror = () => resolve(-1);
    };
    req.onerror = () => resolve(-1);
  }));
  check('rpc falhando enfileira no IndexedDB (fila offline)', pendentes === 1, 'pendentes=' + pendentes);
  check('zero erros JS não tratados com rpc falhando', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 6. Login com token/PIN inválido: mostra erro, não trava, não chama rpc ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid' }) });
  });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'BAD');
  await p.fill('#login-pin', '0000');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-erro').textContent.length > 0);
  const erroTxt = await p.textContent('#login-erro');
  check('login inválido mostra mensagem de erro', erroTxt.length > 0);
  check('overlay de login continua visível (não esconde silenciosamente)', await p.evaluate(() => document.getElementById('login-overlay').style.display !== 'none'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 7. "Continuar offline": esconde overlay, segue com SECAO_ID padrão, sem chamar rpc ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  let loginCalled = false;
  await ctx.route('**/functions/v1/sime-login', async (route) => { loginCalled = true; await route.abort('failed'); });
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.click('#login-offline');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
  await p.click('#btn-zero');
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('continuar offline: nenhuma chamada rpc (sem sessão)', calls.length === 0, 'calls=' + calls.length);
  check('continuar offline: seção padrão local continua funcionando', await p.textContent('.d-sec').then(t => t.includes('063')));
  check('continuar offline: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
