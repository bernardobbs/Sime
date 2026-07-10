// Testa a integração Realtime em SIME_tv_distribuicao.html: snapshot inicial
// do embarque de urnas (sime_rotas_estado + sime_rotas_urnas) + assinatura
// nas 2 tabelas atualizando a tela quase instantaneamente.
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
  await p.route('**esm.sh/@supabase/supabase-js@2**', async (route) => {
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
  return {
    sime_rotas: [{ id: 'rota-uuid-001', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], ativo: true }],
    sime_secoes: [
      { numero: 135, local_nome: 'G.E. Profª Maroquinha', rota_id: 'rota-uuid-001', parada: 1, id: 'sec-uuid-135', ativo: true },
    ],
    sime_rotas_estado: [
      { id: 'estado-uuid-1', rota_id: 'rota-uuid-001', status: 'embarcando', conferente_nome: 'Ana',
        ts_aberta: new Date().toISOString(), ts_pronta: null, ts_saiu: null, alerta: false },
    ],
    sime_rotas_urnas: [
      { rota_estado_id: 'estado-uuid-1', secao_id: 'sec-uuid-135', embarcada: true },
    ],
  };
}

// ── 1. Snapshot inicial: embarque real substitui o "aguardando" default ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  const rotasDist = await p.evaluate(() => window.ROTAS_DIST_SUPABASE);
  check('window.ROTAS_DIST_SUPABASE populado com Rota 001', !!rotasDist && !!rotasDist['Rota 001']);
  check('snapshot inicial: status=embarcando', rotasDist['Rota 001']?.status === 'embarcando');
  check('snapshot inicial: urna 0135 embarcada=true', rotasDist['Rota 001']?.urnas?.['0135'] === true);
  check('snapshot inicial: conferente propagado', rotasDist['Rota 001']?.conferente === 'Ana');

  const dist = await p.evaluate(() => loadDist());
  check('loadDist() mescla .rotas remoto', dist.rotas?.['Rota 001']?.status === 'embarcando');

  const statusTxt = await p.locator('.rc-status').first().textContent();
  check('DOM renderizado mostra "Embarcando 1/1"', statusTxt.includes('Embarcando') && statusTxt.includes('1/1'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Evento Realtime em sime_rotas_estado (status vira "pronta") ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1200);

  check('callback de sime_rotas_estado registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallbacks?.sime_rotas_estado === 'function'));
  check('callback de sime_rotas_urnas registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallbacks?.sime_rotas_urnas === 'function'));

  // Atualiza o mock config (o refresh vai reconsultar a "tabela" inteira) e
  // dispara o callback — simulando o conferente confirmando "pronta".
  await p.evaluate(() => {
    window.__mockConfig.sime_rotas_estado[0].status = 'pronta';
    window.__mockConfig.sime_rotas_estado[0].ts_pronta = new Date().toISOString();
    window.__mockConfig.realtimeCallbacks.sime_rotas_estado({
      new: window.__mockConfig.sime_rotas_estado[0], eventType: 'UPDATE',
    });
  });
  await p.waitForTimeout(600); // debounce de 300ms do refresh + re-render

  const rotasDist = await p.evaluate(() => window.ROTAS_DIST_SUPABASE);
  check('evento Realtime atualiza status=pronta no cache', rotasDist['Rota 001']?.status === 'pronta');
  check('evento Realtime propaga ts_pronta', rotasDist['Rota 001']?.ts_pronta != null);

  const statusTxt = await p.locator('.rc-status').first().textContent();
  check('DOM re-renderizou: mostra "Pronta p/ sair"', statusTxt.includes('Pronta'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Sem tv_token: fallback local intacto ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_distribuicao.html');
  await p.waitForTimeout(500);
  const rotasDist = await p.evaluate(() => window.ROTAS_DIST_SUPABASE);
  check('sem tv_token: ROTAS_DIST_SUPABASE nunca é populado', rotasDist === undefined);
  check('sem tv_token: loadDist() cai no localStorage sem travar', (await p.evaluate(() => loadDist())) !== undefined);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
