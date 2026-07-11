// Testa a integração Realtime em SIME_tv_vespera.html: snapshot inicial do
// instalador (chegou/posicionada/instalada, via sime_mesa_estado) + assinatura
// via subscribeMesaEstado() atualizando a tela quase instantaneamente.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
class QB {
  constructor(table) { this.table = table; }
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
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

// ── 3. Sem tv_token: fallback local intacto ──
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
