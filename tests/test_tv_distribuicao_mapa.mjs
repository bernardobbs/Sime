// Testa o mapa de posição estimada dos veículos em SIME_tv_distribuicao.html
// (15/09/2026, pedido direto: "PODEMOS incluir um mapa onde cada veiculo de
// cada rota possa estar?") — mesmo padrão já usado em SIME_tv_dia.html
// (getRotasPosicaoMap/subscribeRotasEstado), mas escopado só a rotas de tipo
// 'distribuicao' (esta TV é sobre embarque/saída de urna, não recolhimento
// de mídia nem instalação — getRotasPosicaoMap() em si não filtra por tipo).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; this._notNull = []; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  not(col, op, val) { if (op === 'is' && val === null) this._notNull.push(col); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) {
    let rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    for (const c of this._notNull) rows = rows.filter((r) => r[c] != null);
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = {
        on(event, filter, cb) {
          if (!window.__mockConfig.realtimeCallbacks) window.__mockConfig.realtimeCallbacks = {};
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

async function newPage(ctx, mockConfig) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x',
    }) });
  });
  return p;
}

function baseMockConfig() {
  const ts = new Date().toISOString();
  return {
    sime_rotas: [
      { id: 'rota-uuid-dist', codigo: 'UR1', nome: 'Rota Urnas 01', tipos: ['distribuicao'], municipios: ['Campo Maior'], ativo: true },
      { id: 'rota-uuid-midia', codigo: '001', nome: 'Rota Mídia 01', tipos: ['recolhimento_midia'], municipios: ['Campo Maior'], ativo: true },
    ],
    sime_secoes: [
      { numero: 135, local_nome: 'G.E. Profª Maroquinha', rota_id: 'rota-uuid-dist', parada: 1, id: 'sec-uuid-135', ativo: true },
    ],
    sime_rotas_estado: [
      { id: 'estado-uuid-dist', rota_id: 'rota-uuid-dist', status: 'embarcando', conferente_nome: 'Ana',
        ts_aberta: ts, ts_pronta: null, ts_saiu: null, alerta: false,
        motorista_lat: -4.8252, motorista_lng: -42.1733, motorista_pos_ts: ts },
      { id: 'estado-uuid-midia', rota_id: 'rota-uuid-midia', status: 'aguardando', conferente_nome: null,
        ts_aberta: null, ts_pronta: null, ts_saiu: null, alerta: false,
        motorista_lat: -4.9, motorista_lng: -42.2, motorista_pos_ts: ts },
    ],
    sime_rotas_urnas: [
      { rota_estado_id: 'estado-uuid-dist', secao_id: 'sec-uuid-135', embarcada: true },
    ],
    sime_zonas: [{ numero: 7, municipio: 'Campo Maior', lat: -4.8252, lon: -42.1733 }],
  };
}

// ── 1. Botão do mapa visível; só a rota de distribuição entra na posição ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  check('botão 🗺️ visível no topbar', await p.locator('#mapa-rotas-btn').isVisible());

  const posicoes = await p.evaluate(() => window.__posicaoRotas);
  check('window.__posicaoRotas populado', !!posicoes);
  check('rota de distribuição (UR1) entra no mapa', posicoes['rota-uuid-dist']?.codigo === 'UR1');
  check('rota de recolhimento de mídia (não-distribuição) NÃO entra no mapa', posicoes['rota-uuid-midia'] === undefined);

  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Abrir o painel desenha o marcador e a legenda da rota filtrada ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);

  check('overlay do mapa abre', await p.locator('#mapa-overlay').evaluate((el) => el.classList.contains('open')));
  const legendaTxt = await p.locator('#mapa-legenda').textContent();
  check('legenda cita a rota UR1', legendaTxt.includes('UR1'));
  check('legenda NÃO cita a rota de mídia (001)', !legendaTxt.includes('Rota 001'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Evento Realtime com posição nova de uma rota de distribuição atualiza
//       o mapa E ainda dispara o refresh de embarque de sempre (mesmo canal) ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  await p.evaluate(() => {
    window.__mockConfig.sime_rotas_estado[0].status = 'pronta';
    window.__mockConfig.sime_rotas_estado[0].motorista_lat = -4.7;
    window.__mockConfig.sime_rotas_estado[0].motorista_lng = -42.05;
    window.__mockConfig.sime_rotas_estado[0].motorista_pos_ts = new Date().toISOString();
    window.__mockConfig.realtimeCallbacks.sime_rotas_estado({
      new: window.__mockConfig.sime_rotas_estado[0], eventType: 'UPDATE',
    });
  });
  await p.waitForTimeout(600); // debounce de 300ms do refresh de embarque

  const posicoes = await p.evaluate(() => window.__posicaoRotas);
  check('posição nova aplicada no cache do mapa', posicoes['rota-uuid-dist']?.lat === -4.7 && posicoes['rota-uuid-dist']?.lng === -42.05);

  const rotasDist = await p.evaluate(() => window.ROTAS_DIST_SUPABASE);
  check('mesmo evento também atualizou o status de embarque (canal único)', rotasDist['Rota UR1']?.status === 'pronta');

  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Rota de distribuição sem posição nenhuma: mapa não inventa marcador ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_rotas_estado[0].motorista_lat = null;
  cfg.sime_rotas_estado[0].motorista_lng = null;
  cfg.sime_rotas_estado[0].motorista_pos_ts = null;
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  const posicoes = await p.evaluate(() => window.__posicaoRotas);
  check('sem posição informada: mapa fica vazio, não inventa marcador', Object.keys(posicoes || {}).length === 0);

  await p.click('#mapa-rotas-btn');
  await p.waitForTimeout(200);
  const legendaTxt = await p.locator('#mapa-legenda').textContent();
  check('legenda avisa "nenhum veículo... informou posição"', legendaTxt.includes('Nenhum veículo'));

  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 5. Sem tv_token: mapa nunca tenta carregar, sem quebrar a TV ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html');
  await p.waitForTimeout(500);
  const posicoes = await p.evaluate(() => window.__posicaoRotas);
  check('sem tv_token: window.__posicaoRotas nunca é populado', posicoes === undefined);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
