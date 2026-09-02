// Testa a integração Realtime em SIME_tv_vespera.html: snapshot inicial do
// instalador (chegou/posicionada/instalada, via sime_mesa_estado) + assinatura
// via subscribeMesaEstado() atualizando a tela quase instantaneamente.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) { return Object.entries(filters).every(([k, v]) => row[k] === v); }
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return resolve({ data: rows, error: null }); }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = {
        on(event, filter, cb) {
          window.__mockConfig.realtimeCallbacks = window.__mockConfig.realtimeCallbacks || {};
          window.__mockConfig.realtimeCallbacks[filter.table] = cb;
          if (filter.table === 'sime_mesa_estado') window.__mockConfig.realtimeCallback = cb;
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
  return {
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_mesa_estado: [
      { secao_id: 'sec-uuid-63', urna_chegou: true, urna_posicionada: true, urna_instalada: false,
        problema_instalacao: false, problema_instalacao_resolvido: false, updated_at: new Date().toISOString() },
    ],
  };
}

// ── 1. Snapshot inicial: chegou=true/instalada=false refletido na tela ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800); // reload automático (CITIES) + fetch do inst + debounce

  const instRemota = await p.evaluate(() => window.__instRemota);
  check('window.__instRemota populado com a seção 63', !!instRemota && !!instRemota['0063']);
  check('snapshot inicial: s1 (chegou)=true', instRemota['0063']?.s1 === true);
  check('snapshot inicial: s3 (instalada)=false', instRemota['0063']?.s3 === false);

  const loadInstResult = await p.evaluate(() => loadInst());
  check('loadInst() prefere o cache remoto (não localStorage)', loadInstResult['0063']?.s1 === true);

  const cityProg = await p.locator('.city-prog').first().textContent();
  check('progresso da cidade reflete 0/1 instaladas (chegou mas não instalada)', cityProg.includes('0 / 1'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Evento Realtime atualiza a tela (instalada=true) quase instantaneamente ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800);

  check('callback do Realtime foi registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallback === 'function'));

  await p.evaluate(() => {
    window.__mockConfig.realtimeCallback({
      new: {
        secao_id: 'sec-uuid-63', urna_chegou: true, urna_posicionada: true, urna_instalada: true,
        problema_instalacao: false, problema_instalacao_resolvido: false, updated_at: new Date().toISOString(),
      },
      eventType: 'UPDATE',
    });
  });
  await p.waitForTimeout(600); // debounce de 300ms do re-render

  const instRemota = await p.evaluate(() => window.__instRemota);
  check('evento Realtime atualiza s3 (instalada)=true no cache', instRemota['0063']?.s3 === true);

  const cityProg = await p.locator('.city-prog').first().textContent();
  check('DOM re-renderizou: progresso vira 1/1 instaladas', cityProg.includes('1 / 1'));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Lacre vem de sime_carga_lacre (Supabase), não mais só localStorage ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_eleicoes = [{ id: 'ele-uuid-1', turno: 1, zona_id: 'zona-x', ativa: true, created_at: '2026-01-01' }];
  cfg.sime_carga_lacre = [{ eleicao_id: 'ele-uuid-1', secao_id: 'sec-uuid-63', carga: true, preparacao: true, lacre: true }];
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  // localStorage teria dado outra coisa — prova que quem manda é o Supabase.
  await p.addInitScript(() => { localStorage.setItem('sime_lacre_v3', JSON.stringify({ '0063': { lacre: false } })); });
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800);

  const lacreRemota = await p.evaluate(() => window.__lacreRemota);
  check('window.__lacreRemota populado a partir de sime_carga_lacre', lacreRemota?.['0063']?.lacre === true, JSON.stringify(lacreRemota));
  const stSec63 = await p.evaluate(() => getSt('0063', loadLacre(), loadInst()));
  check('getSt() reflete saiu=true vindo do Supabase (não do localStorage desatualizado)', stSec63?.saiu === true, JSON.stringify(stSec63));

  const rtTxt = await p.locator('#rt-status').textContent();
  check('indicador de saúde do Realtime sai de "sem sessão"', !rtTxt.includes('sem sessão'), rtTxt);

  // Realtime: coordenador lacra em outro aparelho — o mock simula o UPDATE.
  check('callback de sime_carga_lacre registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallbacks?.sime_carga_lacre === 'function'));
  await p.evaluate(() => { window.__mockConfig.sime_carga_lacre[0].lacre = false; });
  await p.evaluate(() => window.__mockConfig.realtimeCallbacks.sime_carga_lacre({ new: window.__mockConfig.sime_carga_lacre[0], eventType: 'UPDATE' }));
  await p.waitForTimeout(700);
  const lacreDepois = await p.evaluate(() => window.__lacreRemota);
  check('evento Realtime de sime_carga_lacre atualiza a tela sozinha', lacreDepois?.['0063']?.lacre === false, JSON.stringify(lacreDepois));
  check('zero erros JS não tratados', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Sem tv_token: fallback local intacto ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html');
  await p.waitForTimeout(500);
  const instRemota = await p.evaluate(() => window.__instRemota);
  check('sem tv_token: __instRemota nunca é populado', instRemota === undefined);
  check('sem tv_token: loadInst() cai no localStorage sem travar', (await p.evaluate(() => loadInst())) !== undefined);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
