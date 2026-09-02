// Testa o achado "baixo" da auditoria em SIME_tv_vespera.html: não havia
// visão dedicada de "Problemas" como o TV Dia tem — instalações com problema
// ficavam misturadas na rotação normal, só destacadas por cor. Réplica
// completa do TV Dia não cabe aqui (domínios de dado diferentes — pânico de
// Dia D vs. prob/probResolvido do Instalador), então o chip "N problemas"
// no topo agora pula direto pra 1ª cidade com problema e pausa a rotação.
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
    channel(name) { const chan = { on() { return chan; }, subscribe() { return chan; } }; return chan; },
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

// 2 municípios — o problema está só no 2º, pra provar que o pulo é de verdade.
function baseMockConfig() {
  return {
    sime_secoes: [
      { id: 'sec-uuid-1', numero: 1, local_nome: 'Escola A', municipio: 'Alfa', eleitores: 100, ativo: true, parada: null, sime_rotas: null },
      { id: 'sec-uuid-2', numero: 2, local_nome: 'Escola B', municipio: 'Beta', eleitores: 100, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_mesa_estado: [
      { secao_id: 'sec-uuid-1', urna_chegou: true, urna_posicionada: true, urna_instalada: true,
        problema_instalacao: false, problema_instalacao_resolvido: false, updated_at: new Date().toISOString() },
      { secao_id: 'sec-uuid-2', urna_chegou: true, urna_posicionada: false, urna_instalada: false,
        problema_instalacao: true, problema_instalacao_resolvido: false, updated_at: new Date().toISOString() },
    ],
  };
}

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
const cfg = baseMockConfig();
await p.addInitScript((c) => { window.__mockConfig = c; }, cfg);
await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
});
await p.route('**/functions/v1/sime-login', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x',
  }) });
});
await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
await p.waitForTimeout(1800); // reload automático (CITIES reais) + fetch do inst

check('zero erros JS', erros.length === 0, erros.join('; '));
check('página inicial é a 1ª cidade (curPage=0)', await p.evaluate(() => curPage) === 0);

const chip = p.locator('#t-stats button:has-text("problemas")');
check('chip "N problemas" aparece no topo', await chip.count() === 1);
check('chip mostra a contagem certa (1)', (await chip.textContent()).includes('1 problemas'), await chip.textContent());

await chip.click();
await p.waitForTimeout(200);

const paginaAtual = await p.evaluate(() => curPage);
const cidadeAtual = await p.evaluate(() => CITIES[curPage]?.city);
check('clicar no chip pula pra cidade com problema (Beta, não a 1ª)', cidadeAtual === 'Beta', `curPage=${paginaAtual} cidade=${cidadeAtual}`);
check('rotação automática pausa ao pular (senão volta sozinho pro Alfa)', await p.evaluate(() => paused) === true);

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_tv_vespera_problemas.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
