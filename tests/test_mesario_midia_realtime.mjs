// Achado real na auditoria de localStorage órfão de 03/09/2026: SIME_mesario.html
// gravava o status de mídia (marcarMidiaPronta → sime_acao_midia) mas nunca lia
// de volta — só do próprio localStorage['sime_midias_v1'] do aparelho, que
// jamais reflete "coletada"/"entregue_transmissao" (essas transições acontecem
// no aparelho do Coletor de Mídias, um dispositivo físico diferente). O botão
// tinha até os textos prontos pra esses dois estados (renderMidiaBtn), mas
// eram inalcançáveis: o mesário nunca ficava sabendo que a própria mídia já
// tinha sido recolhida. Corrigido com Realtime + leitura inicial, mesmo padrão
// já usado pro pânico (ver test_mesario_panico_realtime.mjs).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_JS = `
function rowsFor(table) { return (window.__mockConfig[table] || []); }
function matchFilters(row, filters) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}
class QB {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  then(resolve) {
    const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters));
    return resolve({ data: rows, error: null });
  }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    // Vários canais podem existir na mesma página (pânico + mídia) — guarda
    // todos, indexável por tabela, em vez de assumir que só existe um.
    channel(name) {
      if (!window.__mockConfig.canais) window.__mockConfig.canais = [];
      const registro = { nome: name };
      window.__mockConfig.canais.push(registro);
      const chan = {
        on(ev, filtro, cb) { registro.filtro = filtro; registro.callback = cb; return chan; },
        subscribe() { return chan; },
      };
      return chan;
    },
    removeChannel() {},
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

function baseMockConfig({ midiaSecao } = {}) {
  return {
    rpcCalls: [],
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior',
        eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, zona_id: 'zona-7', ativa: true }],
    sime_mesa_estado: [],
    sime_midias: midiaSecao ? [midiaSecao] : [],
  };
}

async function abrirLogado(ctx, mockConfig) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, mockConfig);
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  await p.route('**/sime_config.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      jwt: 'jwt.x', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-7',
      tipo: 'mesario', secoes: ['0063'],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_mesario.html');
  await p.fill('#login-token', 'MESA0063');
  await p.fill('#login-pin', '1234');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(700);
  return { p, erros };
}

// ── 1. Assinatura: canal próprio da seção pra mídia ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({});
  const { p, erros } = await abrirLogado(ctx, cfg);

  // .filtro (dado puro) sobrevive à serialização do evaluate(); .callback é
  // uma function e some nela — checado à parte, dentro da própria página.
  const canal = await p.evaluate(() => { const c = window.__mockConfig.canais.find(x => x.filtro?.table === 'sime_midias'); return c ? { nome: c.nome, filtro: c.filtro } : null; });
  check('assina um canal próprio da seção', canal?.nome === 'sime_midias_secao_sec-uuid-63', `nome=${canal?.nome}`);
  check('filtra por secao_id (não recebe as outras 174 seções)',
    canal?.filtro?.filter === 'secao_id=eq.sec-uuid-63', JSON.stringify(canal?.filtro));
  const temCallback = await p.evaluate(() => typeof window.__mockConfig.canais.find(x => x.filtro?.table === 'sime_midias')?.callback === 'function');
  check('callback registrado', temCallback);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Evento remoto "coletada" — mídia recolhida em OUTRO aparelho ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({});
  const { p, erros } = await abrirLogado(ctx, cfg);

  // Mesário marca a própria mídia como pronta primeiro (fluxo normal).
  await p.evaluate(() => { saveMidia('0063', { status: 'pronta_para_coleta', pronta_ts: Date.now() }); renderMidiaBtn(); });
  await p.waitForTimeout(150);

  // Coletor de Mídias (outro dispositivo) recolhe — o evento chega por aqui.
  await p.evaluate(() => window.__mockConfig.canais.find(c => c.filtro?.table === 'sime_midias').callback({
    new: { secao_id: 'sec-uuid-63', status: 'coletada', pronta_ts: null },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  const txt = await p.locator('#midia-btn').textContent();
  check('mídia recolhida em outro aparelho reflete no botão do mesário', /recolhida pelo coletor/i.test(txt), txt);
  const statusLocal = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_midias_v1'))['0063']?.status);
  check('estado local (cache offline) também foi atualizado', statusLocal === 'coletada', statusLocal);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Evento remoto "entregue_transmissao" ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({});
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => window.__mockConfig.canais.find(c => c.filtro?.table === 'sime_midias').callback({
    new: { secao_id: 'sec-uuid-63', status: 'entregue_transmissao', pronta_ts: null },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  const txt = await p.locator('#midia-btn').textContent();
  check('mídia entregue na transmissão reflete no botão do mesário', /entregue na transmissão/i.test(txt), txt);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Leitura inicial: app aberto DEPOIS da coleta já ter acontecido ──
// Sem isto, um mesário que só abre o app depois do fim do dia nunca saberia
// — o canal só entrega o que acontece enquanto está de pé.
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({
    midiaSecao: { secao_id: 'sec-uuid-63', eleicao_id: 'ele-uuid-1', status: 'coletada', pronta_ts: null },
  });
  const { p, erros } = await abrirLogado(ctx, cfg);
  await p.waitForTimeout(300);

  const txt = await p.locator('#midia-btn').textContent();
  check('leitura inicial já mostra "coletada" sem precisar de evento novo', /recolhida pelo coletor/i.test(txt), txt);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Ação local (marcar pronta) continua funcionando sem regressão ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({});
  const { p, erros } = await abrirLogado(ctx, cfg);

  // Simula S.enc=true (encerramento já feito) — pré-requisito do botão de mídia.
  await p.evaluate(() => { S.enc = true; renderMidiaBtn(); });
  await p.waitForTimeout(150);
  await p.click('#midia-btn');
  await p.waitForTimeout(300);

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_midia'));
  check('marcar mídia pronta ainda sincroniza via sime_acao_midia', chamadas.length >= 1, `n=${chamadas.length}`);
  check('grava p_status=pronta_para_coleta', chamadas[chamadas.length - 1]?.params?.p_status === 'pronta_para_coleta', JSON.stringify(chamadas));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
