// Testa o painel "🔮 Previsão de encerramento" em SIME_tv_dia.html
// (08/09/2026) — pedido direto, depois do mesmo painel já existir em
// SIME_admin.html: "Quer que eu adicione a previsão de encerramento na TV
// Dia também agora? sim". Mesmo cálculo do Admin (fila pós-encerramento,
// recolhimento de mídia reaproveitando sime_rotas.horario_chegada_previsto),
// só a fonte de dado (window.__mesaRemota/__midiasRemota/ELEICAO_ATIVA, já
// carregados pela TV) e o DOM mudam.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function hhmm(offsetMin) {
  const agora = new Date();
  let d = new Date(agora.getTime() + offsetMin * 60000);
  if (d.toDateString() !== agora.toDateString()) {
    d = new Date(agora);
    if (offsetMin >= 0) d.setHours(23, 59, 0, 0); else d.setHours(0, 0, 0, 0);
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { iso: `${hh}:${mm}:00`, label: `${hh}:${mm}` };
}

const STUB_SUPABASE_TV = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) {
  return Object.entries(filters).every(([k, v]) => {
    if (k.startsWith('__in_')) return v.includes(row[k.slice(5)]);
    return row[k] === v;
  });
}
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  in(col, vals) { this.filters['__in_' + col] = vals; return this; }
  not() { return this; }
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
    sime_zonas: [{ numero: 7, municipio: 'Campo Maior', lat: -4.8252, lon: -42.1733 }],
    sime_eleicoes: [{ id: 'el-7', turno: 1, ativa: true, zona_id: 'zona-x', data_d: '2026-10-04', horario_ab: '07:00:00', horario_enc: '17:00:00', minutos_por_eleitor_fila: 1, created_at: '2026-01-01' }],
    sime_mesa_estado: [],
    sime_midias: [],
    sime_rotas: [],
    sime_rota_secoes: [],
  };
}

async function gotoTv(p, url = 'http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVX') {
  const erros = []; p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto(url);
  await p.waitForTimeout(500);
  return erros;
}

// ── 1. Botão visível; sem fila alguma, painel mostra o horário oficial ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  const encFuturo = hhmm(6 * 60);
  cfg.sime_eleicoes[0].horario_enc = encFuturo.iso;
  cfg.sime_mesa_estado = [{ secao_id: 'sec-uuid-63', fila: 5, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' }];
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);

  check('botão 🔮 visível no topbar', await p.locator('#previsao-btn').isVisible());
  await p.click('#previsao-btn');
  await p.waitForTimeout(200);
  check('painel abre', await p.evaluate(() => document.getElementById('prev-overlay').classList.contains('open')));
  const txtVotacao = (await p.locator('#prev-votacao-tv').textContent()).replace(/\s+/g, ' ');
  check('ainda dentro do horário normal: usa o horário oficial, fila não conta', txtVotacao.includes(encFuturo.label), txtVotacao);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 2. Depois do horário de encerramento: fila aparece na lista com a contagem certa ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  cfg.sime_eleicoes[0].horario_enc = hhmm(-30).iso;
  cfg.sime_mesa_estado = [{ secao_id: 'sec-uuid-63', fila: 8, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' }];
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);
  await p.click('#previsao-btn');
  await p.waitForTimeout(200);

  const txtFilas = (await p.locator('#prev-filas-tv').textContent()).replace(/\s+/g, ' ');
  check('seção com fila aparece na lista com a contagem', /Seção 0063/.test(txtFilas) && /8 na fila/.test(txtFilas), txtFilas);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 3. Recolhimento de mídia: progresso reaproveitado do módulo de Rotas, rota sem previsão avisa ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  cfg.sime_secoes = [
    { id: 'sec-uuid-100', numero: 100, local_nome: 'Escola X', municipio: 'Campo Maior', eleitores: 100, ativo: true },
    { id: 'sec-uuid-101', numero: 101, local_nome: 'Escola Y', municipio: 'Campo Maior', eleitores: 100, ativo: true },
  ];
  const rotaFutura = hhmm(3 * 60);
  cfg.sime_rotas = [
    { id: 'rota-uuid-001', codigo: '001', nome: 'Recolhimento A', tipos: ['recolhimento_midia'], ativo: true, horario_chegada_previsto: rotaFutura.iso },
    { id: 'rota-uuid-002', codigo: '002', nome: 'Recolhimento B', tipos: ['recolhimento_midia'], ativo: true, horario_chegada_previsto: null },
  ];
  cfg.sime_rota_secoes = [
    { rota_id: 'rota-uuid-001', secao_id: 'sec-uuid-100', parada: 1 },
    { rota_id: 'rota-uuid-002', secao_id: 'sec-uuid-101', parada: 1 },
  ];
  cfg.sime_midias = [
    { secao_id: 'sec-uuid-100', status: 'aguardando_encerramento' },
    { secao_id: 'sec-uuid-101', status: 'pronta_para_coleta' },
  ];
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);
  await p.click('#previsao-btn');
  await p.waitForTimeout(200);

  const txtMidia = (await p.locator('#prev-midia-tv').textContent()).replace(/\s+/g, ' ');
  check('rota 001 mostra progresso 0/1 e a previsão de chegada cadastrada', txtMidia.includes('Rota 001') && txtMidia.includes('0/1') && txtMidia.includes(rotaFutura.label), txtMidia);
  check('rota 002 (sem previsão) avisa em vez de inventar', txtMidia.includes('Rota 002') && /sem previsão cadastrada/.test(txtMidia), txtMidia);
  const txtFim = (await p.locator('#prev-fim-tv').textContent()).replace(/\s+/g, ' ');
  check('previsão parcial avisada no fim da operação (rota 002 sem previsão)', /Previsão parcial/.test(txtFim), txtFim);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

// ── 4. Sem eleição ativa: mostra aviso amigável, não quebra ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfigTv();
  cfg.sime_eleicoes = [];
  const p = await newPageTv(ctx, cfg);
  const erros = await gotoTv(p);
  await p.click('#previsao-btn');
  await p.waitForTimeout(200);
  const txtFim = (await p.locator('#prev-fim-tv').textContent()).replace(/\s+/g, ' ');
  check('sem eleição ativa: aviso amigável', /Sem eleição ativa/.test(txtFim), txtFim);
  check('zero erros JS', erros.length === 0, erros.join(';'));
  await ctx.close();
}

await b.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_tv_dia_previsao.mjs`);
falhas.forEach((f) => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
