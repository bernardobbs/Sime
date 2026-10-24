import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
export function createClient(url, key, opts) {
  return {
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; },
        maybeSingle(){
          if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_secoes') {
            return resolve({ data: [
              { id: 'sec-uuid-801', numero: 801, local_nome: 'Escola Dia Um', municipio: 'Cidade Teste', eleitores: 60, parada: null, sime_rotas: null },
            ], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    channel(name) {
      const chan = { on() { return chan; }, subscribe() { return chan; } };
      return chan;
    },
    removeChannel() {},
  };
}
`;

// ── Caso 1: sem tv_token → CITIES = fallback (3 municípios) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html');
  await p.waitForTimeout(500);
  const nCities = await p.evaluate(() => CITIES.length);
  check('sem tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  check('sem tv_token: CITIES = fallback (3 municípios)', nCities === 3, 'n=' + nCities);
  await ctx.close();
}

// ── Caso 2: com tv_token → CITIES real (reload) ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500); // fetch + reload automático (CITIES)

  check('com tv_token: zero erros JS', erros.length === 0, erros.join('; '));
  const cities = await p.evaluate(() => CITIES);
  check('após reload: CITIES = 1 município real (não os 3 do fallback)', cities.length === 1, 'len=' + cities?.length);

  await ctx.close();
}

// ── Caso 3 (03/09/2026, achado real): horário de encerramento vem de
// sime_eleicoes (Supabase) via window.ELEICAO_ATIVA, não só de
// localStorage['sime_eleicao_v1'] — essa chave só existe na TV se alguém já
// tiver aberto o Painel Principal NO MESMO aparelho (nunca acontece na
// prática), então antes o campo de auto-troca sempre caía no "17:00"
// chumbado, mesmo a zona tendo um horário de encerramento diferente
// configurado de verdade. ──
{
  const STUB_COM_ELEICAO = STUB_SUPABASE_JS.replace(
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });",
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });\n          if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'el-1', turno: 1, zona_id: 'zona-x', data_d: '2026-10-04', data_d1: '2026-10-03', horario_ab: '08:00:00', horario_enc: '16:30:00', nome: 'Eleição Teste' }, error: null });"
  );
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/functions/v1/sime-login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
  });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COM_ELEICAO });
  });

  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
  await p.waitForTimeout(1500);

  check('com eleição real: zero erros JS', erros.length === 0, erros.join('; '));
  const eleicaoAtiva = await p.evaluate(() => window.ELEICAO_ATIVA);
  check('window.ELEICAO_ATIVA populado a partir do Supabase', eleicaoAtiva?.horario_enc === '16:30:00', JSON.stringify(eleicaoAtiva));
  const hor = await p.evaluate(() => window.getHor());
  check('getHor() usa o horário real (16:30), não o fallback chumbado (17:00)', hor.enc === '16:30' && hor.ab === '08:00', JSON.stringify(hor));
  const autoSwitchVal = await p.evaluate(() => document.getElementById('auto-switch')?.value);
  check('campo #auto-switch é pré-preenchido com o horário real de encerramento', autoSwitchVal === '16:30', autoSwitchVal);

  await ctx.close();
}

// ── Caso 4 (22/09/2026, achado real: "tem uma aba de problemas, mas não
// apareceu nada") — renderCurrent() ativa o .v-page cujo índice no DOM bate
// com `curPage`; a aba "⚠ Problemas" sempre monta um único .v-page no
// índice 0, mas `curPage` fica parado onde a rotação automática de cidades
// (startTicker/goPage) o deixou (0, 1 ou 2). Trocar de aba sem resetar
// curPage comparava "0 === curPage" e, quando curPage≠0, removia a classe
// .active do próprio painel de Problemas — tela em branco, sem nem mesmo o
// "Nenhum problema ativo". ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tv_dia.html');
  await p.waitForTimeout(500);

  // Simula a rotação automática já ter avançado pra 2ª/3ª cidade (índice != 0).
  // curPage é `let` no escopo do <script> clássico — não vira propriedade de
  // window, mas continua acessível por page.evaluate() (mesmo escopo léxico
  // top-level da página, como o console do navegador).
  await p.evaluate(() => { goPage(1); });
  const curPageAntes = await p.evaluate(() => curPage);
  check('setup: curPage avançou pra 1 antes de trocar de aba', curPageAntes === 1, 'curPage=' + curPageAntes);

  await p.evaluate(() => { setFase('prob'); });
  await p.waitForTimeout(200);

  check('trocar pra aba Problemas: zero erros JS', erros.length === 0, erros.join('; '));
  const ativo = await p.locator('.v-page.active').count();
  check('aba Problemas: o painel .v-page.active existe (não removido por curPage desatualizado)', ativo === 1, 'count=' + ativo);
  const opacidade = await p.locator('.v-page.active').evaluate((el) => getComputedStyle(el).opacity);
  check('aba Problemas: o painel está visível (opacity 1, não 0)', opacidade === '1', 'opacity=' + opacidade);
  const visivel = await p.locator('.v-page.active').isVisible();
  check('aba Problemas: Playwright considera o painel visível', visivel === true);
  const curPageDepois = await p.evaluate(() => curPage);
  check('trocar pra aba Problemas reseta curPage pra 0', curPageDepois === 0, 'curPage=' + curPageDepois);
  const txt = await p.locator('.v-page.active').innerText();
  check('conteúdo da aba Problemas está presente no texto (não em branco)', txt.trim().length > 10, JSON.stringify(txt.slice(0, 80)));

  await ctx.close();
}

// ── Caso 5 (27/09/2026, pedido direto: "os problemas com votação não
// iniciada e mesa incompleta só deve ser indicado a partir daquela data"
// [04/10/2026, sime_eleicoes.data_d]) — diaDaVotacaoChegou() passa a gatear
// os dois alertas: sem ela, deixar a TV ligada QUALQUER dia antes da
// eleição (mesmo sem tocar o relógio) sinalizava toda seção aberta como
// "atraso" assim que o relógio de parede passasse do horário oficial +
// 1h/2h, mesmo sem ser Dia D de verdade. ──
{
  const STUB_MESA_INCOMPLETA = (dataD) => STUB_SUPABASE_JS.replace(
    "if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });",
    `if (t === 'sime_zonas') return Promise.resolve({ data: { numero: 96, municipio: 'Cidade Teste', lat: -10.5, lon: -50.5 }, error: null });
          if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'el-1', turno: 1, zona_id: 'zona-x', data_d: ${dataD ? `'${dataD}'` : 'null'}, data_d1: null, horario_ab: '00:00:00', horario_enc: '17:00:00', nome: 'Eleição Teste' }, error: null });`
  ).replace(
    "return resolve({ data: [], error: null });",
    `if (t === 'sime_mesa_estado') return resolve({ data: [
            { secao_id: 'sec-uuid-801', mesa_pres: 0, mesa_m1: 0, mesa_m2: 0, mesa_sec: 0,
              zeresima: false, votacao: false, encerrada: false, bu_impresso: false,
              material_recolhido: false, urna_recolhida: false, urna_cartorio: false, fila: 0,
              panico_energia: false, panico_urna: false,
              panico_energia_resolvido: false, panico_urna_resolvido: false,
              updated_at: new Date().toISOString() },
          ], error: null });
          return resolve({ data: [], error: null });`
  );

  // nowMin()/diaDaVotacaoChegou() usam o relógio de PAREDE real (new Date()),
  // e horario_ab do mock é fixo em '00:00:00' — sem congelar o relógio da
  // página, "atraso vot."/"mesa inc." dependem de que HORA (UTC) o job de CI
  // por acaso está rodando quando o teste executa (achado real: falha
  // intermitente em CI, nunca reproduzida localmente, porque o job só cai
  // dentro da janela 00:00-02:00 UTC às vezes). Congelado às 10:00 local —
  // bem acima dos dois limiares (limVot=02:00, limMesa=01:00) — pra tornar o
  // teste determinístico independente de quando ele roda de verdade. Sem
  // sufixo 'Z' no ISO, o JS interpreta como hora LOCAL do processo, então
  // `getHours()` sempre devolve 10, não importa o fuso do executor.
  async function abrirComData(dataD) {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.addInitScript((fixedIso) => {
      const FIXED = new Date(fixedIso).getTime();
      const OrigDate = Date;
      class FakeDate extends OrigDate {
        constructor(...args) {
          if (args.length === 0) { super(FIXED); } else { super(...args); }
        }
        static now() { return FIXED; }
      }
      window.Date = FakeDate;
    }, '2026-06-15T10:00:00');
    await p.route('**/functions/v1/sime-login', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jwt: 'x.y.z', exp: Math.floor(Date.now() / 1000) + 999, zona_id: 'zona-x' }) });
    });
    await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MESA_INCOMPLETA(dataD) });
    });
    await p.goto('http://localhost:8917/modules/SIME_tv_dia.html?tv_token=TVTOKENX');
    await p.waitForTimeout(1800);
    return { ctx, p, erros };
  }

  // (a) data_d no futuro distante — hoje ainda não chegou lá, os dois
  // alertas (horário já bem passado da meia-noite) precisam ficar OFF.
  {
    const { ctx, p, erros } = await abrirComData('2099-01-01');
    const stats = await p.locator('#t-stats').innerHTML();
    check('data_d no futuro: NÃO conta "atraso vot." mesmo com o horário passado', !/atraso vot\./.test(stats), stats);
    check('data_d no futuro: NÃO conta "mesa inc."', !/mesa inc\./.test(stats), stats);
    const diaOk = await p.evaluate(() => window.diaDaVotacaoChegou());
    check('diaDaVotacaoChegou() retorna false antes da data', diaOk === false);
    check('zero erros JS', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }

  // (b) data_d no passado (equivalente a "hoje já é o Dia D ou depois") —
  // os dois alertas devem aparecer, comportamento de sempre.
  {
    const { ctx, p, erros } = await abrirComData('2020-01-01');
    const stats = await p.locator('#t-stats').innerHTML();
    check('data_d no passado: conta "atraso vot."', /atraso vot\./.test(stats), stats);
    check('data_d no passado: conta "mesa inc."', /mesa inc\./.test(stats), stats);
    await p.click('#fase-prob');
    await p.waitForTimeout(200);
    const probTxt = await p.locator('.v-page.active').innerText();
    check('aba Problemas lista "Votação não iniciada"', probTxt.includes('Votação não iniciada'), probTxt);
    check('aba Problemas lista "Mesa incompleta"', probTxt.includes('Mesa incompleta'), probTxt);
    const diaOk = await p.evaluate(() => window.diaDaVotacaoChegou());
    check('diaDaVotacaoChegou() retorna true na/depois da data', diaOk === true);
    check('zero erros JS', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }

  // (c) sem data_d cadastrado (Supabase sem essa coluna preenchida) — nunca
  // bloqueia, cai no comportamento de sempre (só o horário decide).
  {
    const { ctx, p, erros } = await abrirComData(null);
    const stats = await p.locator('#t-stats').innerHTML();
    check('sem data_d: continua contando "atraso vot." (nunca esconde por falta de dado)', /atraso vot\./.test(stats), stats);
    check('sem data_d: continua contando "mesa inc."', /mesa inc\./.test(stats), stats);
    check('zero erros JS', erros.length === 0, erros.join(' | '));
    await ctx.close();
  }
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
