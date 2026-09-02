// Testa a correção do defeito relatado em campo: "após o problema ser
// resolvido pela equipe, o controle do mesário não atualiza".
//
// Eram dois problemas no mesmo lugar:
//   1. TELA PARADA — só as TVs assinavam o Realtime; o mesário só escrevia,
//      então a tela dele seguia vermelha depois da resolução pelo Admin.
//   2. PERDA DE DADO — buildMesaPayload() mandava o snapshot inteiro a cada
//      toque, então o próximo toque do mesário em QUALQUER botão reenviava
//      `panico_*_resolvido: false` e desfazia a resolução no banco.
//
// O (2) é o mais grave e é corrigido sem depender de rede: os campos de
// pânico só entram no payload quando o próprio toque foi de pânico (o RPC
// trata NULL como "mantém o que está lá").
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// Estas suítes exercitam o fluxo COM PIN. A operação suprimiu o PIN por ora
// (SIME_CONFIG.exigirPin=false), mas o caminho continua no código e volta
// quando o cartório quiser — então aqui a configuração é fixada, em vez de
// deixar a suíte seguir um flag de produção que muda debaixo dela.
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
    channel(name) {
      window.__mockConfig.canalNome = name;
      const chan = {
        on(ev, filtro, cb) { window.__mockConfig.realtimeFiltro = filtro; window.__mockConfig.realtimeCallback = cb; return chan; },
        subscribe() { return chan; },
      };
      return chan;
    },
    removeChannel() {},
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      // rpcTravado simula a escrita ainda em voo (rede lenta) — é a janela em
      // que um evento antigo do Realtime poderia pisar no toque do operador.
      if (window.__mockConfig.rpcTravado) {
        return new Promise((resolve) => { window.__mockConfig.destravar = () => resolve({ data: {}, error: null }); });
      }
      return Promise.resolve({ data: { ...params }, error: null });
    },
  };
}
`;

function baseMockConfig(mesaEstado) {
  return {
    rpcCalls: [],
    sime_secoes: [
      { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior',
        eleitores: 150, ativo: true, parada: null, sime_rotas: null },
    ],
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, zona_id: 'zona-7', ativa: true }],
    sime_mesa_estado: mesaEstado ? [mesaEstado] : [],
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

const estadoPanico = (id) => ({
  ativo: id === 'energia',
});

// ── 1. Assinatura: canal por seção, não a zona inteira ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  const nome = await p.evaluate(() => window.__mockConfig.canalNome);
  const filtro = await p.evaluate(() => window.__mockConfig.realtimeFiltro);
  check('assina um canal próprio da seção', nome === 'sime_mesa_estado_secao_sec-uuid-63', `nome=${nome}`);
  check('filtra por secao_id (não recebe as outras 174 seções)',
    filtro?.filter === 'secao_id=eq.sec-uuid-63', JSON.stringify(filtro));
  check('assina a tabela sime_mesa_estado', filtro?.table === 'sime_mesa_estado');
  check('callback do Realtime registrado', await p.evaluate(() => typeof window.__mockConfig.realtimeCallback === 'function'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. O defeito relatado: equipe resolve pelo Admin → tela do mesário vira ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.click('#btn-energia');           // mesário aciona o pânico
  await p.waitForTimeout(200);
  check('pânico local: botão fica ATIVO',
    (await p.locator('#btn-energia').getAttribute('class')).includes('c-panic-active'));
  check('pânico local: badge vermelho', (await p.locator('#badge-energia').textContent()) === '🔴');

  // Equipe resolve pelo Admin → o servidor emite o UPDATE
  await p.evaluate(() => window.__mockConfig.realtimeCallback({
    new: { secao_id: 'sec-uuid-63', panico_energia: false, panico_urna: false,
           panico_energia_resolvido: true, panico_urna_resolvido: false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  const cls = await p.locator('#btn-energia').getAttribute('class');
  check('resolvido pelo Admin: botão do mesário vira RESOLVIDO', cls.includes('c-panic-resolved'), cls);
  check('resolvido pelo Admin: badge vira ✓', (await p.locator('#badge-energia').textContent()) === '✓');
  check('resolvido pelo Admin: subtítulo muda',
    (await p.locator('#sub-energia').textContent()).includes('Resolvido'));
  check('estado interno acompanha', await p.evaluate(() => S.panico.energia === false && S.panico_resolved.energia === true));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Eco da própria escrita não desfaz o que o mesário acabou de tocar ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.click('#btn-energia');
  await p.waitForTimeout(200);
  // Evento em trânsito, disparado ANTES do toque, chegando depois dele.
  await p.evaluate(() => window.__mockConfig.realtimeCallback({
    new: { secao_id: 'sec-uuid-63', panico_energia: false, panico_urna: false,
           panico_energia_resolvido: false, panico_urna_resolvido: false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);
  // O evento é legítimo (nenhuma escrita em voo àquela altura), então a tela
  // acompanha o servidor — mas volta ao repouso, não a um estado inventado.
  const cls = await p.locator('#btn-energia').getAttribute('class');
  check('linha zerada no servidor devolve o botão ao repouso',
    !cls.includes('c-panic-active') && !cls.includes('c-panic-resolved'), cls);
  check('repouso: subtítulo volta ao texto original',
    (await p.locator('#sub-energia').textContent()).includes('toque para acionar'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. A perda de dado: toque comum NÃO reenvia pânico ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => { window.__mockConfig.rpcCalls.length = 0; });
  await p.click('#mb-pres');               // chegada do presidente — ação comum
  await p.waitForTimeout(300);

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa'));
  check('toque comum sincroniza via sime_acao_mesa', chamadas.length >= 1, `n=${chamadas.length}`);
  const params = chamadas[chamadas.length - 1]?.params || {};
  check('toque comum NÃO envia p_panico_energia', !('p_panico_energia' in params), JSON.stringify(params));
  check('toque comum NÃO envia p_panico_urna', !('p_panico_urna' in params));
  check('toque comum NÃO envia p_panico_energia_resolvido', !('p_panico_energia_resolvido' in params));
  check('toque comum NÃO envia p_panico_urna_resolvido', !('p_panico_urna_resolvido' in params));
  check('toque comum continua enviando o que é do mesário (mesa_pres)', params.p_mesa_pres === 1, JSON.stringify(params));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Toque de pânico continua enviando os campos de pânico ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => { window.__mockConfig.rpcCalls.length = 0; });
  await p.click('#btn-energia');
  await p.waitForTimeout(300);

  const chamadas = await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa'));
  const params = chamadas[chamadas.length - 1]?.params || {};
  check('acionar pânico envia p_panico_energia=true', params.p_panico_energia === true, JSON.stringify(params));
  check('acionar pânico envia p_panico_energia_resolvido=false', params.p_panico_energia_resolvido === false);

  await p.evaluate(() => { window.__mockConfig.rpcCalls.length = 0; });
  // Resolver exige toque duplo (proteção contra cancelar um alerta real por
  // engano) — o primeiro toque só avisa, o segundo confirma.
  await p.click('#btn-energia');
  await p.click('#btn-energia');            // resolver no próprio aparelho
  await p.waitForTimeout(300);
  const p2 = (await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa')))
    .slice(-1)[0]?.params || {};
  check('resolver no aparelho envia p_panico_energia=false', p2.p_panico_energia === false, JSON.stringify(p2));
  check('resolver no aparelho envia p_panico_energia_resolvido=true', p2.p_panico_energia_resolvido === true);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Leitura inicial: app reaberto não volta com o vermelho velho ──
// O canal só entrega o que acontece enquanto está de pé. Se a equipe resolveu
// com o celular fechado, só a leitura inicial corrige a tela.
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig({
    secao_id: 'sec-uuid-63', eleicao_id: 'ele-uuid-1',
    panico_energia: false, panico_urna: false,
    panico_energia_resolvido: true, panico_urna_resolvido: false,
  });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((c) => { window.__mockConfig = c; }, cfg);
  // localStorage com o pânico ainda ATIVO — o que o aparelho tinha ao fechar.
  await p.addInitScript(() => {
    localStorage.setItem('sime_mesa_v1', JSON.stringify({
      '0063': { mesa: { pres: 0, m1: 0, m2: 0, sec: 0 }, zero: false, vot: false, enc: false,
                bu: false, mat: false, urna: false, fila: null,
                panico: { energia: true, urnaprob: false },
                panico_resolved: { energia: false, urnaprob: false } },
    }));
  });
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
  await p.waitForTimeout(900);

  const cls = await p.locator('#btn-energia').getAttribute('class');
  check('reabrir com pânico resolvido no servidor: tela NÃO volta vermelha',
    !cls.includes('c-panic-active'), cls);
  check('reabrir: botão mostra resolvido', cls.includes('c-panic-resolved'), cls);
  check('reabrir: localStorage foi corrigido', await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sime_mesa_v1'))['0063'];
    return d.panico.energia === false && d.panico_resolved.energia === true;
  }));
  check('reabrir: a correção do servidor não vira escrita de volta',
    await p.evaluate(() => window.__mockConfig.rpcCalls.filter(c => c.name === 'sime_acao_mesa').length === 0));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Escrita em voo: evento antigo não pisa no toque do operador ──
{
  const ctx = await b.newContext();
  const cfg = baseMockConfig(null);
  const { p, erros } = await abrirLogado(ctx, cfg);

  await p.evaluate(() => { window.__mockConfig.rpcTravado = true; });
  await p.click('#btn-energia');            // pânico acionado, escrita travada
  await p.waitForTimeout(200);

  // Evento disparado antes do toque, chegando com a escrita ainda em voo.
  await p.evaluate(() => window.__mockConfig.realtimeCallback({
    new: { secao_id: 'sec-uuid-63', panico_energia: false, panico_urna: false,
           panico_energia_resolvido: false, panico_urna_resolvido: false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);

  const cls = await p.locator('#btn-energia').getAttribute('class');
  check('escrita em voo: evento antigo NÃO apaga o pânico recém-acionado',
    cls.includes('c-panic-active'), cls);
  check('escrita em voo: estado interno preservado', await p.evaluate(() => S.panico.energia === true));

  // Escrita conclui → a partir daí eventos voltam a valer.
  await p.evaluate(() => window.__mockConfig.destravar());
  await p.waitForTimeout(200);
  await p.evaluate(() => window.__mockConfig.realtimeCallback({
    new: { secao_id: 'sec-uuid-63', panico_energia: false, panico_urna: false,
           panico_energia_resolvido: true, panico_urna_resolvido: false },
    eventType: 'UPDATE',
  }));
  await p.waitForTimeout(300);
  check('depois da escrita concluir, o Realtime volta a valer',
    (await p.locator('#btn-energia').getAttribute('class')).includes('c-panic-resolved'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
