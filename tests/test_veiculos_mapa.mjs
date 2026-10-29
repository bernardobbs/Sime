// Testa "posição estimada de cada veículo no mapa" (08/09/2026) — pedido
// direto: "conseguiríamos ter uma visão estimada do local no mapa em que
// esta cada veiculo?", esclarecido via AskUserQuestion: a posição atualiza
// "a cada informe" do motorista (não é rastreamento contínuo em segundo
// plano), aparece na TV Dia, e cobre D-1 (distribuição) também, não só Dia D
// (recolhimento).
//
// Duas pontas:
//  - SIME_motorista.html: cada confirmação (entrega/recolhimento/chegada ao
//    cartório) captura navigator.geolocation e chama sime_rota_estado_upsert
//    com p_lat/p_lng — melhor-esforço, nunca bloqueia a confirmação em si.
//  - SIME_tv_dia.html: aba 🗺️ Rotas mostra um mapa Leaflet com a última
//    posição conhecida de cada rota (getRotasPosicaoMap() + Realtime em
//    sime_rotas_estado) — rota sem nenhum informe não aparece, nunca inventa
//    posição.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// ══════════════════════════════════════════════
// PARTE 1 — SIME_motorista.html
// ══════════════════════════════════════════════
const STUB_CONFIG_MOTORISTA = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_MOTORISTA = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return resolve({ data: rows, error: null }); }
}
export function createClient(url, key, opts) {
  return {
    __authHeader: opts?.global?.headers?.Authorization || null,
    from(table) { return new QB(table); },
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      if (window.__mockConfig.rpcShouldFail) return Promise.resolve({ data: null, error: { message: 'mock rpc fail' } });
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

async function newPageMotorista(ctx, mockConfig, { geoOk = true } = {}) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.addInitScript((hoje) => {
    localStorage.setItem('sime_eleicao_v1', JSON.stringify({ turno_ativo: 1, turno1: { d1: hoje } }));
  }, new Date().toISOString().slice(0, 10));
  // Stub de navigator.geolocation — o navegador real nunca teria permissão
  // concedida num teste headless, e sem stub getCurrentPosition ficaria
  // pendurado esperando um diálogo que nunca aparece.
  await p.addInitScript((ok) => {
    window.__geoCalls = 0;
    Object.defineProperty(window.navigator, 'geolocation', {
      value: {
        getCurrentPosition(success, error) {
          window.__geoCalls++;
          if (ok) success({ coords: { latitude: -4.8123, longitude: -42.1456 } });
          else error({ code: 1, message: 'Permissão negada' });
        },
      },
    });
  }, geoOk);
  await p.route('**/vendor/supabase-js.esm.js**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_MOTORISTA }));
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG_MOTORISTA }));
  return p;
}

function baseMockConfigMotorista() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-135', numero: 135, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 178, ativo: true, parada: 1, sime_rotas: null },
      { id: 'sec-uuid-144', numero: 144, local_nome: 'G.E. Profª Maroquinha', municipio: 'Campo Maior', eleitores: 165, ativo: true, parada: 1, sime_rotas: null },
    ],
    sime_rotas: [
      { id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], itinerario: null, urnas_estimadas: null, ativo: true },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
    rpcCalls: [], rpcShouldFail: false,
  };
}

async function loginMotorista(p) {
  await p.fill('#login-token', 'MOTO001');
  await p.fill('#login-pin', '4321');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('view-main').style.display !== 'none');
  await p.waitForTimeout(300);
}

// ── 1. Confirmar entrega (D-1) captura geolocalização e chama sime_rota_estado_upsert ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigMotorista();
  await ctx.route('**/functions/v1/sime-login', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'motorista', rotas: ['001'] }),
  }));
  const p = await newPageMotorista(ctx, cfg);
  const erros = []; p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_motorista.html');
  await loginMotorista(p);

  await p.click('.btn-entregar');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some((c) => c.name === 'sime_rota_estado_upsert'));
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  const posCall = calls.find((c) => c.name === 'sime_rota_estado_upsert');
  check('confirmar entrega chama sime_rota_estado_upsert', !!posCall, JSON.stringify(calls));
  check('payload usa a rota certa (rota-uuid-001) e a eleição ativa', posCall && posCall.params.p_rota_id === 'rota-uuid-001' && posCall.params.p_eleicao_id === 'ele-uuid-1', JSON.stringify(posCall));
  check('payload traz lat/lng da geolocalização capturada', posCall && posCall.params.p_lat === -4.8123 && posCall.params.p_lng === -42.1456, JSON.stringify(posCall));
  check('a confirmação de entrega em si continua acontecendo (p_urna_entregue)', calls.some((c) => c.params?.p_urna_entregue === true));
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Geolocalização negada NÃO bloqueia a confirmação da seção ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigMotorista();
  await ctx.route('**/functions/v1/sime-login', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7', tipo: 'motorista', rotas: ['001'] }),
  }));
  const p = await newPageMotorista(ctx, cfg, { geoOk: false });
  const erros = []; p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_motorista.html');
  await loginMotorista(p);

  await p.click('.btn-entregar');
  await p.waitForFunction(() => window.__mockConfig.rpcCalls.some((c) => c.params?.p_urna_entregue === true));
  await p.waitForTimeout(200);
  const calls = await p.evaluate(() => window.__mockConfig.rpcCalls);
  check('mesmo sem permissão de localização, a seção é confirmada normalmente', calls.some((c) => c.params?.p_urna_entregue === true));
  check('sem permissão de localização: nenhuma chamada de posição é gravada', !calls.some((c) => c.name === 'sime_rota_estado_upsert'), JSON.stringify(calls));
  check('geolocation.getCurrentPosition foi de fato chamado (tentou, só falhou)', (await p.evaluate(() => window.__geoCalls)) > 0);
  const btnDesfazer = await p.locator('.btn-desfazer-mini').count();
  check('UI segue funcionando normalmente (botão de desfazer apareceu)', btnDesfazer > 0);
  check('zero erros JS mesmo com geolocalização negada', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ══════════════════════════════════════════════
// PARTE 2 — SIME_tv_dia.html
// ══════════════════════════════════════════════
const STUB_SUPABASE_TV = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not(col) { this.filters['__not_' + col] = true; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    if (this.table === 'sime_zonas') return Promise.resolve({ data: window.__mockConfig.zona, error: null });
    return Promise.resolve({ data: null, error: null });
  }
  then(resolve) {
    let rows = rowsFor(this.table);
    if (this.table === 'sime_rotas_estado' && this.filters.__not_motorista_pos_ts) {
      rows = rows.filter((r) => r.motorista_pos_ts != null);
    }
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = {
        on(event, filter, cb) {
          window.__mockConfig.realtimeCallbacks = window.__mockConfig.realtimeCallbacks || {};
          window.__mockConfig.realtimeCallbacks[filter.table] = cb;
          return chan;
        },
        subscribe() { return chan; },
      };
      return chan;
    },
    removeChannel() {},
  };
}
`;

async function newPageTv(ctx, mockConfig) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_TV }));
  await p.route('**/functions/v1/sime-login', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }),
  }));
  return p;
}

function baseMockConfigTv() {
  return {
    sime_secoes: [{ id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null }],
    sime_zonas: null,
    zona: { numero: 7, municipio: 'Campo Maior', lat: -4.8252, lon: -42.1733 },
    sime_mesa_estado: [],
    sime_rotas: [
      { id: 'rota-uuid-004', codigo: '004', nome: 'Rota 004', municipios: ['Campo Maior'], itinerario: null, urnas_estimadas: null, ativo: true },
    ],
    sime_rotas_estado: [
      { rota_id: 'rota-uuid-004', motorista_lat: -4.81, motorista_lng: -42.14, motorista_pos_ts: '2026-09-08T14:30:00.000Z' },
    ],
  };
}

async function gotoTv(p, url = 'http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVX') {
  const erros = []; p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto(url);
  await p.waitForTimeout(500);
  return erros;
}

// ── 3. Snapshot inicial: rota com posição aparece no mapa/legenda ao abrir o painel ──
{
  const ctx = await b.newContext();
  const p = await newPageTv(ctx, baseMockConfigTv());
  const erros = await gotoTv(p);
  check('botão do mapa está visível no topbar', await p.locator('#mapa-rotas-btn').isVisible());

  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);
  check('painel do mapa abre', await p.evaluate(() => document.getElementById('mapa-overlay').classList.contains('open')));
  const legenda = (await p.locator('#mapa-legenda').textContent()).replace(/\s+/g, ' ');
  check('legenda mostra a Rota 004 com o horário da última posição', legenda.includes('Rota 004') && /\d{2}:\d{2}/.test(legenda), legenda);
  const marcadores = await p.locator('#mapa-rotas .rt-pin').count();
  check('exatamente 1 marcador desenhado no mapa (1 rota com posição)', marcadores === 1, 'n=' + marcadores);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Sem nenhuma posição informada: legenda avisa, sem inventar marcador ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  cfg.sime_rotas_estado = []; // nenhuma rota informou posição ainda
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);

  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);
  const legenda = (await p.locator('#mapa-legenda').textContent()).replace(/\s+/g, ' ');
  check('sem posição nenhuma: avisa em vez de inventar', legenda.includes('Nenhum veículo informou posição ainda'), legenda);
  const marcadores = await p.locator('#mapa-rotas .rt-pin').count();
  check('nenhum marcador desenhado', marcadores === 0, 'n=' + marcadores);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 5. Realtime: nova posição de outra rota aparece sem recarregar a página ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);

  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);
  check('antes do evento: só a Rota 004 no mapa', (await p.locator('#mapa-rotas .rt-pin').count()) === 1);

  await p.evaluate(() => {
    const cb = window.__mockConfig.realtimeCallbacks['sime_rotas_estado'];
    cb({ new: { rota_id: 'rota-uuid-004', motorista_lat: -4.82, motorista_lng: -42.15, motorista_pos_ts: new Date().toISOString() }, eventType: 'UPDATE' });
  });
  await p.waitForTimeout(200);
  const marcadores = await p.locator('#mapa-rotas .rt-pin').count();
  check('depois do evento Realtime: continua com 1 marcador (mesma rota, posição atualizada)', marcadores === 1, 'n=' + marcadores);
  check('zero erros JS após evento Realtime', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 6. Realtime: rota desconhecida (sem meta carregada) é ignorada, sem quebrar ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);
  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);

  await p.evaluate(() => {
    const cb = window.__mockConfig.realtimeCallbacks['sime_rotas_estado'];
    cb({ new: { rota_id: 'rota-fantasma', motorista_lat: -4.9, motorista_lng: -42.2, motorista_pos_ts: new Date().toISOString() }, eventType: 'UPDATE' });
  });
  await p.waitForTimeout(200);
  const marcadores = await p.locator('#mapa-rotas .rt-pin').count();
  check('rota sem metadado conhecido não vira marcador (não inventa rótulo)', marcadores === 1, 'n=' + marcadores);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_veiculos_mapa.mjs`);
falhas.forEach((f) => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
