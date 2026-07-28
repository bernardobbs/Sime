// Testa, nas duas TVs (Dia e Véspera), o que a operação pediu depois de usar
// o painel: uma legenda que diga o que cada coisa significa, e — na parte de
// problemas — poder clicar num alerta para ver o que é e falar direto com a
// mesa daquela seção pelo WhatsApp.
//
// O ponto delicado é QUEM o botão chama. sime_atores guarda a junta eleitoral
// com funcao_mesa='Presidente' igual aos mesários; contatar a junta por causa
// de uma urna com defeito seria escalar para o lugar errado — e é exatamente
// o tipo de erro que só aparece no dia. Por isso há caso dedicado.
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
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(resolve) { return resolve({ data: rowsFor(this.table), error: null }); }
}
export function createClient(url, key, opts) {
  return {
    from(table) { return new QB(table); },
    channel(name) {
      const chan = { on(e, f, cb) { window.__mockConfig.realtimeCallback = cb; return chan; }, subscribe() { return chan; } };
      return chan;
    },
    removeChannel() {},
  };
}
`;

const SECOES = [
  { id: 'sec-uuid-63', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 150, ativo: true, parada: null, sime_rotas: null },
];

// Mesa completa da 63 fora de ordem de propósito: o código tem que escolher o
// Presidente, não o primeiro da lista.
const ATORES = [
  { id: 'a1', nome_completo: 'Bruno Dias Lima',    telefone_whatsapp: '86988887777', funcao: 'mesario', funcao_mesa: '2º Mesário',   secao_id: 'sec-uuid-63', ativo: true },
  { id: 'a2', nome_completo: 'Ana Paula Sousa',    telefone_whatsapp: '5586999996666', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 'sec-uuid-63', ativo: true },
  { id: 'a3', nome_completo: 'Carla Nunes',        telefone_whatsapp: '86977775555', funcao: 'mesario', funcao_mesa: '1º Mesário',   secao_id: 'sec-uuid-63', ativo: true },
  // Junta eleitoral: mesmo funcao_mesa, papel completamente diferente.
  { id: 'a4', nome_completo: 'Juiz Fulano',        telefone_whatsapp: '86911112222', funcao: 'junta_eleitoral', funcao_mesa: 'Presidente', secao_id: 'sec-uuid-63', ativo: true },
];

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

// ══════════════════════════════════════════════════
// TV DIA
// ══════════════════════════════════════════════════
function cfgDia({ atores = ATORES, panico = true } = {}) {
  return {
    sime_secoes: SECOES,
    sime_atores: atores,
    sime_mesa_estado: [
      { secao_id: 'sec-uuid-63', mesa_pres: 1, mesa_m1: 1, mesa_m2: 1, mesa_sec: 1,
        zeresima: true, votacao: true, encerrada: false, bu_impresso: false,
        material_recolhido: false, urna_recolhida: false, urna_cartorio: false, fila: 0,
        panico_energia: panico, panico_urna: false,
        panico_energia_resolvido: false, panico_urna_resolvido: false,
        updated_at: new Date().toISOString() },
    ],
  };
}

async function abrirDia(ctx, cfg) {
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800); // sessão + cache de CITIES + reload
  return { p, erros };
}

// ── 1. Legenda da fase de problemas ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirDia(ctx, cfgDia());
  await p.click('#fase-prob');
  await p.waitForTimeout(300);

  const leg = await p.locator('#v-leg').textContent();
  check('TV Dia: legenda explica falta de energia', leg.includes('Falta de energia'), leg);
  check('TV Dia: legenda explica problema na urna', leg.includes('Problema na urna'));
  check('TV Dia: legenda explica votação não iniciada', leg.includes('Votação não iniciada'));
  check('TV Dia: legenda explica mesa incompleta', leg.includes('Mesa incompleta'));
  check('TV Dia: legenda avisa que dá pra clicar', leg.toLowerCase().includes('clique'));

  const info = await p.locator('#fase-info').textContent();
  check('TV Dia: cabeçalho da fase também convida ao clique', info.toLowerCase().includes('clique'), info);
  check('TV Dia: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Clicar no problema abre o detalhe com o contato certo ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirDia(ctx, cfgDia());
  await p.click('#fase-prob');
  await p.waitForTimeout(300);

  const itens = await p.locator('.prob-item').count();
  check('TV Dia: o pânico da 63 aparece na lista de problemas', itens >= 1, 'n=' + itens);

  const ts = await p.locator('.prob-ts').first().textContent();
  check('TV Dia: item mostra desde quando (não a hora atual crua)', ts.trim().startsWith('desde'), ts);

  await p.locator('.prob-item').first().click();
  await p.waitForTimeout(300);
  check('TV Dia: clique abre o modal', await p.locator('#sec-overlay.open').count() === 1);

  const modal = await p.locator('#sec-modal').textContent();
  check('TV Dia: modal nomeia o problema', modal.includes('Falta de Energia'), modal.slice(0, 200));

  const href = await p.locator('#sec-modal a.sm-btn.wa').getAttribute('href');
  check('TV Dia: botão de WhatsApp presente', !!href, String(href));
  check('TV Dia: contata o Presidente da mesa (não o 1º da lista)',
    href.includes('wa.me/5586999996666'), href);
  check('TV Dia: NÃO contata a junta eleitoral', !href.includes('86911112222'));
  check('TV Dia: sem 55 duplicado no número', !href.includes('wa.me/5555'), href);
  check('TV Dia: mensagem já vem escrita com a seção', decodeURIComponent(href).includes('Seção 63'));
  check('TV Dia: mensagem cita o problema', decodeURIComponent(href).includes('Falta de energia'));

  const rotulo = await p.locator('#sec-modal a.sm-btn.wa').textContent();
  check('TV Dia: botão diz o papel e o nome de quem vai ser chamado',
    rotulo.includes('Presidente') && rotulo.includes('Ana'), rotulo);
  check('TV Dia: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Sem contato cadastrado: o botão some, o modal continua útil ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirDia(ctx, cfgDia({ atores: [] }));
  await p.click('#fase-prob');
  await p.waitForTimeout(300);
  await p.locator('.prob-item').first().click();
  await p.waitForTimeout(300);

  check('TV Dia: sem ator cadastrado, nenhum botão de WhatsApp',
    await p.locator('#sec-modal a.sm-btn.wa').count() === 0);
  check('TV Dia: modal ainda mostra o problema',
    (await p.locator('#sec-modal').textContent()).includes('Falta de Energia'));
  check('TV Dia: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ══════════════════════════════════════════════════
// TV VÉSPERA
// ══════════════════════════════════════════════════
function cfgVespera({ atores = ATORES, problema = true } = {}) {
  return {
    sime_secoes: SECOES,
    sime_atores: atores,
    sime_mesa_estado: [
      { secao_id: 'sec-uuid-63', urna_chegou: true, urna_posicionada: true, urna_instalada: false,
        problema_instalacao: problema, problema_instalacao_resolvido: false,
        updated_at: new Date().toISOString() },
    ],
  };
}

async function abrirVespera(ctx, cfg) {
  const p = await newPage(ctx, cfg);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_vespera.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1800);
  return { p, erros };
}

// ── 4. Legenda corrigida ──
// A legenda antiga listava #ef4444 como cor de círculo, mas problema é badge;
// e omitia #ea580c ("instalada sem registro de chegada"), que mkSVG usa de
// verdade — ou seja, havia uma cor na tela sem entrada na legenda.
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirVespera(ctx, cfgVespera());
  const leg = await p.locator('.leg').textContent();
  check('TV Véspera: legenda cobre "Instalada s/ chegada"', leg.includes('Instalada s/ chegada'), leg);
  check('TV Véspera: legenda explica os 3 arcos', leg.includes('saiu') && leg.includes('chegou') && leg.includes('instalada'), leg);
  check('TV Véspera: legenda avisa que dá pra clicar', leg.toLowerCase().includes('clique'));

  const cores = await p.locator('.leg .li-d').evaluateAll((els) => els.map((e) => e.style.background));
  check('TV Véspera: legenda não promete mais um círculo vermelho de problema',
    !cores.some((c) => c.includes('239, 68, 68')), cores.join(' | '));
  check('TV Véspera: problema aparece como badge na legenda', await p.locator('.leg .li-b').count() === 1);
  check('TV Véspera: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Clicar na seção abre detalhe + contato ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirVespera(ctx, cfgVespera());

  await p.locator('.sw').first().click();
  await p.waitForTimeout(300);
  check('TV Véspera: clique abre o modal', await p.locator('#sec-overlay.show').count() === 1);

  const modal = await p.locator('#sec-modal').textContent();
  check('TV Véspera: modal nomeia o problema', modal.includes('Problema na instalação'), modal.slice(0, 200));
  check('TV Véspera: modal mostra o passo a passo da urna',
    modal.includes('Urna saiu') && modal.includes('Chegou ao local') && modal.includes('Instalada'));

  const href = await p.locator('#sec-modal a.sm-btn.wa').getAttribute('href');
  check('TV Véspera: contata o Presidente da mesa', href.includes('wa.me/5586999996666'), href);
  check('TV Véspera: NÃO contata a junta eleitoral', !href.includes('86911112222'));
  check('TV Véspera: sem 55 duplicado', !href.includes('wa.me/5555'), href);
  check('TV Véspera: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Seção sem problema: modal ainda abre e informa o estado ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirVespera(ctx, cfgVespera({ problema: false }));
  await p.locator('.sw').first().click();
  await p.waitForTimeout(300);
  const modal = await p.locator('#sec-modal').textContent();
  check('TV Véspera: sem problema, o modal não inventa alerta', !modal.includes('Problema na instalação'), modal.slice(0, 200));
  check('TV Véspera: mesmo assim mostra a chegada registrada', modal.includes('Chegou'));
  check('TV Véspera: contato continua disponível', await p.locator('#sec-modal a.sm-btn.wa').count() === 1);
  check('TV Véspera: sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
