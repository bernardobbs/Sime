// Testa a integração da Fase 4 em SIME_conferente.html: o login local (PIN
// contra sime_tokens_v1, já existente) continua igual; o que é novo é a
// tentativa de sessão real via sime-login e a sincronização do embarque de
// urnas via sime_rota_estado_upsert/sime_rota_urna_toggle.
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
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
function notNullFilter(rows, col) { return rows.filter(r => r[col] != null); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._notNull = []; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not(col, op, val) { if (op === 'is' && val === null) this._notNull.push(col); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    let rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  then(resolve) {
    let rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    for (const c of this._notNull) rows = notNullFilter(rows, c);
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    __authHeader: opts?.global?.headers?.Authorization || null,
    from(table) { return new QB(table); },
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      if (window.__mockConfig.rpcShouldFail) return Promise.resolve({ data: null, error: { message: 'mock rpc fail' } });
      const fakeRow = { id: 'rota-estado-' + (params.p_rota_id || params.p_rota_estado_id || 'x'), ...params };
      return Promise.resolve({ data: fakeRow, error: null });
    },
  };
}
`;

async function newPage(ctx, mockConfig, tokens) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.addInitScript((toks) => { localStorage.setItem('sime_tokens_v1', JSON.stringify(toks)); }, tokens);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  return p;
}

function baseMockConfig() {
  return {
    sime_rotas: [{ id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true }],
    sime_secoes: [
      { id: 'sec-uuid-135', numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
      { id: 'sec-uuid-144', numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, rota_id: 'rota-uuid-001', parada: 1 },
      { id: 'sec-uuid-180', numero: 180, local_nome: 'U.E. José Gomes Oliveira', municipio: 'Campo Maior', eleitores: 200, ativo: true, rota_id: 'rota-uuid-001', parada: 2 },
      { id: 'sec-uuid-163', numero: 163, local_nome: "Salão Com. Mario Cazuza", municipio: 'Campo Maior', eleitores: 140, ativo: true, rota_id: 'rota-uuid-001', parada: 3 },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

const TOKENS = { CONF001: { id: 'CONF001', nome: 'Ana Conferente', pin: '4321', rotas: ['Rota 001'], turno: 1, zona: '7' } };

async function fazerLoginPIN(p) {
  for (let i = 0; i < 4; i++) await p.fill(`#pin-${i}`, '4321'[i]);
}

// ── 1. Login local (PIN) + sessão real do Supabase em paralelo ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  let loginBody = null;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    loginBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'conferente', rotas: ['Rota 001'],
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_conferente.html');
  await fazerLoginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-rotas').classList.contains('active'));
  check('login local continua funcionando (entra na lista de rotas)', true);
  await p.waitForTimeout(300);
  check('sime-login foi chamado com token+pin do token local', loginBody?.token === 'CONF001' && loginBody?.pin === '4321');
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Abrir rota + marcar urna → sincroniza via RPCs reais ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'conferente', rotas: ['Rota 001'],
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  await p.goto('http://localhost:8917/modules/SIME_conferente.html');
  await fazerLoginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-rotas').classList.contains('active'));
  await p.waitForTimeout(300); // sessão de campo resolvida em paralelo

  await p.click('.route-card'); // abre a 1ª rota (Rota 001)
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_rota_estado_upsert'));
  const abrirCalls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const abrirCall = abrirCalls.find(c => c.name === 'sime_rota_estado_upsert');
  check('abrir rota chama sime_rota_estado_upsert (status=embarcando)', abrirCall?.params?.p_status === 'embarcando' && abrirCall.params.p_ts_aberta === true);
  check('payload usa rota_id/eleicao_id reais', abrirCall.params.p_rota_id === 'rota-uuid-001' && abrirCall.params.p_eleicao_id === 'ele-uuid-1');

  await p.click('.urna-item'); // marca a 1ª urna da lista de embarque
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.name === 'sime_rota_urna_toggle'));
  const urnaCalls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const urnaCall = urnaCalls.find(c => c.name === 'sime_rota_urna_toggle');
  check('toggle de urna chama sime_rota_urna_toggle com embarcada=true', urnaCall?.params?.p_embarcada === true);
  check('payload da urna usa secao_id real (não hardcoded)', ['sec-uuid-135','sec-uuid-144','sec-uuid-180','sec-uuid-163'].includes(urnaCall.params.p_secao_id));
  await ctx.close();
}

// ── 3. Marcar todas urnas + confirmar pronta → status=pronta, ts_pronta=true ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'conferente', rotas: ['Rota 001'],
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  await p.goto('http://localhost:8917/modules/SIME_conferente.html');
  // PIN usava type=number (achado "baixo") — troca pro mesmo padrão do Mesário.
  check('PIN usa type=tel (não number)', await p.getAttribute('#pin-0', 'type') === 'tel');
  check('PIN mantém teclado numérico via inputmode', await p.getAttribute('#pin-0', 'inputmode') === 'numeric');
  await fazerLoginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-rotas').classList.contains('active'));
  await p.waitForTimeout(300);
  await p.click('.route-card');
  await p.waitForTimeout(200);

  // renderUrnas() reconstrói o DOM (list.innerHTML='') a cada clique — precisa
  // re-consultar os elementos não-embarcados a cada volta, senão os handles
  // ficam presos a nós já removidos (detached) depois do 1º clique.
  while (await p.locator('.urna-item:not(.embarcada)').count() > 0) {
    await p.locator('.urna-item:not(.embarcada)').first().click();
    await p.waitForTimeout(50);
  }

  // Confirmar "pronta" era um modal em cima de uma ação que já tem desfazer
  // de um toque (achado "baixo") — agora é toque único, sem sheet nenhuma.
  check('nenhuma folha aberta antes do toque em "pronta"', await p.locator('.overlay.show').count() === 0);
  await p.click('#btn-pronta');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some(c => c.params?.p_status === 'pronta'));
  check('toque único já confirma "pronta" (sem abrir folha)', await p.locator('.overlay.show').count() === 0);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const prontaCall = calls.reverse().find(c => c.params?.p_status === 'pronta');
  check('confirmar pronta propaga p_ts_pronta=true', prontaCall?.params?.p_ts_pronta === true);

  // Desfazer: alvo de toque ≥44px, não mais colado ao botão crítico ao lado.
  const desfazerBox = await p.locator('.btn-desfazer').evaluate(el => el.getBoundingClientRect());
  check('botão "Desfazer" tem alvo de toque ≥44px', desfazerBox.height >= 44, String(desfazerBox.height));
  await ctx.close();
}

// ── 4. Falha de rede → enfileira no IndexedDB, sem travar ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.rpcShouldFail = true;
  await ctx.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'conferente', rotas: ['Rota 001'],
    }) });
  });
  const p = await newPage(ctx, cfg, TOKENS);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_conferente.html');
  await fazerLoginPIN(p);
  await p.waitForFunction(() => document.getElementById('view-rotas').classList.contains('active'));
  await p.waitForTimeout(300);
  await p.click('.route-card');
  await p.waitForTimeout(300);

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
  check('rpc falhando enfileira no IndexedDB', pendentes >= 1, 'pendentes=' + pendentes);
  check('zero erros JS não tratados com rpc falhando', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
