// Testa a responsividade das seis telas de campo em larguras reais.
//
// Elas nasceram para o celular do operador e tinham dois problemas opostos no
// monitor do cartório: mesário e acessibilidade viravam uma tira de 390px no
// meio de um monitor de 27"; instalador, motorista, mídias e conferente
// esticavam de ponta a ponta, com o cartão de uma seção ocupando 1440px.
//
// E havia um defeito só no celular: o bloco de mídia do mesário estava FORA do
// .remote, como filho direto do body. Como o body é flex, os 158px dele
// somavam à largura do controle e empurravam a tela para fora do viewport —
// justamente no aparelho para o qual a tela foi desenhada.
//
// O alvo não é "encher a tela": é manter o alcance do polegar no celular e dar
// corpo legível no monitor.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: false,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_JS = `
class QB { constructor(t){this.t=t;} select(){return this;} eq(){return this;} in(){return this;}
  order(){return this;} limit(){return this;}
  maybeSingle(){return Promise.resolve({data:null,error:null});} then(r){return r({data:[],error:null});} }
export function createClient(){ return {
  from(t){return new QB(t);},
  channel(){const c={on(){return c;},subscribe(){return c;}};return c;},
  removeChannel(){}, rpc(){return Promise.resolve({data:null,error:null});},
  auth:{async getSession(){return {data:{session:null}};},async getUser(){return {data:{user:null}};}},
};}
`;

const MODULOS = ['SIME_mesario','SIME_acessibilidade','SIME_instalador',
                 'SIME_motorista','SIME_midias','SIME_conferente'];
const REMOTE  = ['SIME_mesario','SIME_acessibilidade'];

// Larguras de aparelhos reais, não números redondos: 375 é o iPhone SE que
// ainda circula, e 1440 é o monitor do cartório.
const VIEWPORTS = [
  ['iPhone SE',   375, 667],
  ['iPhone Pro',  430, 932],
  ['iPad',        820, 1180],
  ['Desktop',    1440, 900],
];

async function abrir(ctx, modulo, w, h) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/sime_config.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_CONFIG }));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto(`http://localhost:8917/modules/${modulo}.html?token=BX86FPJ7`);
  await p.waitForTimeout(400);
  return { p, erros };
}

const medir = (p) => p.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  scrollW: document.documentElement.scrollWidth,
  vw: window.innerWidth,
  remote: document.querySelector('.remote')
    ? Math.round(document.querySelector('.remote').getBoundingClientRect().width) : null,
}));

// ── 1. Nenhuma tela pode rolar na horizontal, em nenhuma largura ──
// É o sintoma que o operador sente: metade dos botões fora da tela.
for (const m of MODULOS) {
  for (const [nome, w, h] of VIEWPORTS) {
    const ctx = await b.newContext();
    const { p, erros } = await abrir(ctx, m, w, h);
    const r = await medir(p);
    check(`${m} @ ${nome}: sem rolagem horizontal`, !r.overflow,
      `scrollW=${r.scrollW} vw=${r.vw}`);
    check(`${m} @ ${nome}: sem erro JS`, erros.length === 0, erros.join(' | '));
    await ctx.close();
  }
}

// ── 2. O "controle remoto" cresce por degraus, sem virar faixa larga ──
{
  for (const m of REMOTE) {
    const larguras = {};
    for (const [nome, w, h] of VIEWPORTS) {
      const ctx = await b.newContext();
      const { p } = await abrir(ctx, m, w, h);
      larguras[nome] = (await medir(p)).remote;
      await ctx.close();
    }
    check(`${m}: no celular ocupa a tela toda`, larguras['iPhone SE'] === 375, JSON.stringify(larguras));
    check(`${m}: cresce no iPad`, larguras['iPad'] > larguras['iPhone Pro'], JSON.stringify(larguras));
    check(`${m}: cresce no desktop`, larguras['Desktop'] > larguras['iPad'], JSON.stringify(larguras));
    // O limite existe de propósito: um controle de 1440px de largura não é
    // mais usável, é só maior.
    check(`${m}: mas não vira faixa (para em ~520px)`, larguras['Desktop'] <= 560, JSON.stringify(larguras));
  }
}

// ── 3. O bloco de mídia do mesário está DENTRO do controle ──
// Fora dele, somava 158px à largura e quebrava o celular.
{
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, 'SIME_mesario', 375, 667);
  const dentro = await p.evaluate(() =>
    !!document.querySelector('.remote #midia-block'));
  check('mesário: bloco de mídia dentro do .remote', dentro);
  const filhosSoltos = await p.evaluate(() =>
    [...document.body.children].filter((e) =>
      e.tagName === 'DIV' && getComputedStyle(e).position !== 'fixed'
      && !e.classList.contains('remote')).length);
  check('mesário: nenhum bloco solto disputando largura com o controle',
    filhosSoltos === 0, 'soltos=' + filhosSoltos);
  await ctx.close();
}

// ── 4. As telas em lista param de esticar no monitor ──
// Linha de 1440px obriga a varrer a cabeça para ler.
for (const m of ['SIME_instalador', 'SIME_midias']) {
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, m, 1440, 900);
  const larguraLista = await p.evaluate(() => {
    const el = document.querySelector('.list, .route-list, .sec-list');
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  });
  check(`${m}: a lista para de crescer antes da janela`,
    larguraLista !== null && larguraLista <= 900, 'largura=' + larguraLista);
  await ctx.close();
}

// ── 5. O zoom deixou de ser bloqueado ──
// Mesário de 60 anos com o celular no sol precisa poder ampliar; travar o
// zoom é barreira de acessibilidade, não decisão de layout.
for (const m of MODULOS) {
  const ctx = await b.newContext();
  const { p } = await abrir(ctx, m, 375, 667);
  const vp = await p.getAttribute('meta[name=viewport]', 'content');
  check(`${m}: não bloqueia zoom`,
    !/user-scalable\s*=\s*no/.test(vp) && !/maximum-scale\s*=\s*1/.test(vp), vp);
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
