// Testa a integração Realtime em SIME_tv_dia.html: snapshot inicial de
// sime_mesa_estado via getMesaEstadoMap() + assinatura via
// subscribeMesaEstado() atualizando a tela quase instantaneamente (sem
// esperar o próximo ciclo de 5s de buildPages()).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    if (this.table === 'sime_zonas') return Promise.resolve({ data: window.__mockConfig.zona, error: null });
    return Promise.resolve({ data: null, error: null });
  }
  then(resolve) { return resolve({ data: rowsFor(this.table), error: null }); }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = {
        on(event, filter, cb) { window.__mockConfig.realtimeCallback = cb; return chan; },
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
  await p.route('**api.open-meteo.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      current: { temperature_2m: 30, apparent_temperature: 32, precipitation_probability: 10, weathercode: 1 },
      hourly: { precipitation_probability: [10, 10, 10] },
    }) });
  });
  return p;
}

function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_zonas: null,
    zona: { numero: 7, municipio: 'Campo Maior', lat: -4.8252, lon: -42.1733 },
    sime_mesa_estado: [
      { secao_id: 'sec-uuid-63', mesa_pres: 1, mesa_m1: 1, mesa_m2: 1, mesa_sec: 1, zeresima: true, votacao: true, encerrada: true,
        bu_impresso: true, material_recolhido: false, urna_recolhida: false, urna_cartorio: false, fila: 3,
        panico_energia: false, panico_urna: false, panico_energia_resolvido: false, panico_urna_resolvido: false,
        updated_at: new Date().toISOString() },
    ],
  };
}

// ── 1. Snapshot inicial: dado real de sime_mesa_estado substitui o demo ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800); // reload automático (CITIES) + fetch da mesa + debounce

  const mesaRemota = await p.evaluate(() => window.__mesaRemota);
  check('window.__mesaRemota populado com a seção 63', !!mesaRemota && !!mesaRemota['0063']);
  check('snapshot inicial: enc=true (real, não demo)', mesaRemota['0063']?.enc === true);
  check('snapshot inicial: fila=3 propagada', mesaRemota['0063']?.fila === 3);
  check('snapshot inicial: bu=true propagado', mesaRemota['0063']?.bu === true);

  const loadMesaResult = await p.evaluate(() => loadMesa());
  check('loadMesa() prefere o cache remoto (não localStorage)', loadMesaResult['0063']?.enc === true);

  const swReal = await p.evaluate(() => {
    const el = [...document.querySelectorAll('.sw')].find(e => e.getAttribute('onclick')?.includes("'0063'"));
    if (!el) return null;
    return JSON.parse(el.dataset.st.replace(/&quot;/g, '"'));
  });
  check('DOM renderizado reflete o dado real (real:true) pra seção 0063', swReal?.real === true);
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Evento Realtime (postgres_changes) atualiza a tela quase instantaneamente ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800);

  check('callback do Realtime foi registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallback === 'function'));

  // Simula um UPDATE vindo do Postgres — mesário confirmou "urna recolhida"
  await p.evaluate(() => {
    window.__mockConfig.realtimeCallback({
      new: {
        secao_id: 'sec-uuid-63', mesa_pres: 1, mesa_m1: 1, mesa_m2: 1, mesa_sec: 1, zeresima: true, votacao: true, encerrada: true,
        bu_impresso: true, material_recolhido: true, urna_recolhida: true, urna_cartorio: false, fila: 0,
        panico_energia: false, panico_urna: false, panico_energia_resolvido: false, panico_urna_resolvido: false,
        updated_at: new Date().toISOString(),
      },
      eventType: 'UPDATE',
    });
  });
  await p.waitForTimeout(600); // debounce de 300ms do re-render

  const mesaRemota = await p.evaluate(() => window.__mesaRemota);
  check('evento Realtime atualiza urna=true no cache', mesaRemota['0063']?.urna === true);
  check('evento Realtime atualiza fila=0 (zerada)', mesaRemota['0063']?.fila === 0);

  const swReal = await p.evaluate(() => {
    const el = [...document.querySelectorAll('.sw')].find(e => e.getAttribute('onclick')?.includes("'0063'"));
    if (!el) return null;
    return JSON.parse(el.dataset.st.replace(/&quot;/g, '"'));
  });
  check('DOM re-renderizou refletindo urna=true (não ficou preso no snapshot antigo)', swReal?.urna === true);
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Sem tv_token: fallback local intacto, zero chamadas Realtime ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html');
  await p.waitForTimeout(500);
  const mesaRemota = await p.evaluate(() => window.__mesaRemota);
  check('sem tv_token: __mesaRemota nunca é populado', mesaRemota === undefined);
  check('sem tv_token: loadMesa() cai no localStorage sem travar', (await p.evaluate(() => loadMesa())) !== undefined);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
