// Testa a integração Supabase+Realtime em SIME_tv_preparacao.html: achado
// crítico da auditoria — a TV só lia localStorage['sime_lacre_v3'], que só
// existe no navegador de quem preencheu (o Coordenador de Preparação); numa
// TV real (outro aparelho), as barras ficavam sempre em 0%, sem Realtime
// nenhum. Agora lê sime_carga_lacre (snapshot inicial + assinatura).
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
  not() { return this; }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
  then(resolve) { return resolve({ data: rowsFor(this.table).filter((r) => matchFilters(r, this.filters)), error: null }); }
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
  return {
    sime_zonas: [{ numero: 7, municipio: 'Campo Maior', estado: 'PI' }],
    sime_secoes: [
      { id: 'sec-uuid-1', numero: 1, local_nome: 'Escola A', municipio: 'Campo Maior', eleitores: 100, ativo: true },
      { id: 'sec-uuid-2', numero: 2, local_nome: 'Escola A', municipio: 'Campo Maior', eleitores: 90, ativo: true },
      { id: 'sec-uuid-3', numero: 3, local_nome: 'Escola B', municipio: 'Campo Maior', eleitores: 80, ativo: true },
      { id: 'sec-uuid-4', numero: 4, local_nome: 'Escola B', municipio: 'Campo Maior', eleitores: 70, ativo: true },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, zona_id: 'zona-x' }],
    sime_carga_lacre: [
      { eleicao_id: 'ele-uuid-1', secao_id: 'sec-uuid-1', carga: true, preparacao: true, lacre: true },
      { eleicao_id: 'ele-uuid-1', secao_id: 'sec-uuid-2', carga: true, preparacao: false, lacre: false },
    ],
  };
}

// ── 1. Snapshot inicial: contagens reais de sime_carga_lacre, não localStorage ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  // localStorage teria dado outra coisa (ou nada) — prova que quem manda é o Supabase.
  await p.addInitScript(() => { localStorage.setItem('sime_lacre_v3', JSON.stringify({})); });
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(900);

  const real = await p.evaluate(() => window.SIME_CARGA_LACRE_REAL);
  check('window.SIME_CARGA_LACRE_REAL populado (1 carga, 1 preparação, 1 lacre)', real?.c === 2 && real?.p === 1 && real?.l === 1, JSON.stringify(real));

  const pctCarga = await p.locator('#p-carga').textContent();
  check('barra de carga reflete o dado real (2/4 = 50%)', pctCarga.trim() === '50%', pctCarga);
  const fcLacre = await p.locator('#fc-lacre').textContent();
  check('contador de lacradas reflete o dado real (1)', fcLacre.trim() === '1', fcLacre);
  const rtTxt = await p.locator('#rt-status').textContent();
  check('indicador de saúde do Realtime sai de "sem sessão" (achado "médio")', !rtTxt.includes('sem sessão'), rtTxt);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Evento Realtime: nova seção lacrada atualiza a tela sozinha ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(900);

  check('callback de sime_carga_lacre registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallbacks?.sime_carga_lacre === 'function'));

  // Coordenador de Preparação lacra a seção 2 em outro aparelho — o mock
  // simula a mudança na "tabela" e dispara o callback do canal.
  await p.evaluate(() => {
    window.__mockConfig.sime_carga_lacre[1].lacre = true;
    window.__mockConfig.realtimeCallbacks.sime_carga_lacre({
      new: window.__mockConfig.sime_carga_lacre[1], eventType: 'UPDATE',
    });
  });
  await p.waitForTimeout(500);

  const real = await p.evaluate(() => window.SIME_CARGA_LACRE_REAL);
  check('evento Realtime atualiza a contagem de lacradas (2, não mais 1)', real?.l === 2, JSON.stringify(real));
  const fcLacre = await p.locator('#fc-lacre').textContent();
  check('DOM re-renderizou sozinho (contador de lacradas = 2)', fcLacre.trim() === '2', fcLacre);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3b. Todas as seções lacradas: destaque de verde (achado "alto") ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_carga_lacre = cfg.sime_secoes.map((s) => ({
    eleicao_id: 'ele-uuid-1', secao_id: s.id, carga: true, preparacao: true, lacre: true,
  }));
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(900);

  check('todas lacradas: body ganha a classe de destaque', await p.evaluate(() => document.body.classList.contains('tudo-lacrado')));
  const corLacre = await p.evaluate(() => getComputedStyle(document.getElementById('b-lacre')).backgroundColor);
  check('barra de lacre fica verde quando 100% completa', corLacre === 'rgb(10, 122, 61)', corLacre);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Sem eleição ativa: cai no fallback local, sem travar ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  cfg.sime_eleicoes = []; // nenhuma eleição ativa
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html?tv_token=TVTOKENX');
  await p.waitForTimeout(700);

  const real = await p.evaluate(() => window.SIME_CARGA_LACRE_REAL);
  check('sem eleição ativa: SIME_CARGA_LACRE_REAL continua null (fallback local)', real === null, JSON.stringify(real));
  check('sem eleição ativa: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Sem tv_token: fallback local intacto, sem tentar Supabase ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig();
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_preparacao.html');
  await p.waitForTimeout(500);
  const real = await p.evaluate(() => window.SIME_CARGA_LACRE_REAL);
  check('sem tv_token: SIME_CARGA_LACRE_REAL nunca é populado', real === null);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
