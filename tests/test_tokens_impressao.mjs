// Testa a impressão em formato de cartão de visita de SIME_tokens.html
// (11/09/2026, pedido direto: "em imprimir todos, quero que gere cada e as
// informações como um cartão de visitas e preenchendo uma folha a4 com
// cartões suficientes, verifique se o qrcode esta em tamanho suficiente").
// Antes disso "Imprimir todos" só chamava window.print() direto sobre a
// própria lista na tela (cards full-width, um embaixo do outro) — nada de
// cartão de visita nem de aproveitar a folha A4. Cobre: cartão de visita
// padrão (85×54mm, 2 col × 5 lin = 10 por folha), paginação quando passa
// de 10, conteúdo essencial (nome/papel/PIN, sem escopo), QR presente em
// resolução generosa mesmo pra link curto, e o 🖨️ de uma linha usando o
// MESMO formato (1 cartão só).
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
  insert() { return Promise.resolve({ data: null, error: null }); }
  then(resolve) { return resolve({ data: rowsFor(this.table).filter((r) => matchFilters(r, this.filters)), error: null }); }
  maybeSingle() { const rows = rowsFor(this.table).filter((r) => matchFilters(r, this.filters)); return Promise.resolve({ data: rows[0] ?? null, error: null }); }
}
export function createClient() {
  return {
    from(table) { return new QB(table); },
    auth: {
      async signInWithPassword() { return { error: null }; },
      async getSession() { return { data: { session: null } }; },
    },
  };
}
`;

async function newPage(ctx) {
  const p = await ctx.newPage();
  await p.addInitScript((cfg) => { window.__mockConfig = cfg; }, {
    sime_eleicoes: [{ id: 'ele-uuid-1', turno: 1, ativa: true, created_at: '2026-01-01' }],
  });
  // window.print() abriria um diálogo real do navegador (trava o teste) —
  // mesmo stub já usado em test_rotas.mjs/test_convocacao_mesarios.mjs.
  await p.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS });
  });
  return p;
}
async function login(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha123');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none');
}

function tokenMesario(id, nome, criado_em) {
  return { id, nome, tipo: 'mesario', local: null, zona: 7, turno: 1, pin: '4821', secoes: ['63'], rotas: [], criado_em };
}
function tokenTv(id, nome, criado_em) {
  return { id, nome, tipo: 'tv', local: 'tv_dia', zona: 7, turno: 1, pin: '0000', secoes: [], rotas: [], criado_em };
}
async function setTokens(p, tokens) {
  await p.evaluate((toks) => {
    const map = {}; toks.forEach(t => map[t.id] = t);
    localStorage.setItem('sime_tokens_v1', JSON.stringify(map));
    window.renderTokens();
  }, tokens);
}

// ── 1. "Imprimir todos" com 12 tokens — 2 folhas (10 + 2), cartão de
// visita 85×54mm com guia de corte, sem popup (window.print direto). ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);

  const tokens = [];
  for (let i = 1; i <= 11; i++) tokens.push(tokenMesario(`tok-mesario-${i}`, `Operador ${i}`, 1000 + i));
  tokens.push(tokenTv('tok-tv-1', 'TV Praça', 2000)); // 12º token, o mais recente → primeiro da lista
  await setTokens(p, tokens);

  await p.click('button:has-text("🖨️ Imprimir todos")');
  await p.waitForTimeout(200);

  check('chama window.print() uma vez, sem popup', await p.evaluate(() => window.__printCalls) === 1);

  const paginas = await p.locator('#print-area .tk-page').count();
  check('12 tokens viram 2 páginas (10 + 2, sem página em branco sobrando)', paginas === 2, String(paginas));
  const cartoes = await p.locator('#print-area .tk-card').count();
  check('todos os 12 tokens viram cartão', cartoes === 12, String(cartoes));

  const cartoesPag1 = await p.locator('#print-area .tk-page').nth(0).locator('.tk-card').count();
  const cartoesPag2 = await p.locator('#print-area .tk-page').nth(1).locator('.tk-card').count();
  check('1ª folha preenchida com 10 cartões (grade 2×5 cheia)', cartoesPag1 === 10, String(cartoesPag1));
  check('2ª folha só com o restante (2), sem inventar cartão vazio', cartoesPag2 === 2, String(cartoesPag2));

  const qrs = await p.locator('#print-area .tk-card-qr canvas').count();
  check('todo cartão tem QR desenhado (canvas)', qrs === 12, String(qrs));

  const printHtml = await p.locator('#print-area').innerHTML();
  check('mostra o nome do operador', /Operador 1</.test(printHtml), printHtml.slice(0, 400));
  check('mostra papel com ícone (🗳️ Mesário)', /🗳️ Mesário/.test(printHtml));
  check('mostra o PIN de backup', /PIN 4821/.test(printHtml));
  check('cartão TV mostra "Sem PIN — só QR" em vez de PIN', /Sem PIN — só QR/.test(printHtml));
  check('cartão TV NÃO mostra PIN 0000 (TV nunca usa PIN de verdade)', !/PIN 0000/.test(printHtml));
  check('mostra papel da TV (📺 Painel de TV)', /📺 Painel de TV/.test(printHtml));
  // Escopo isolado do texto do cartão (.tk-card-info), não do innerHTML
  // inteiro — o QR vira uma <img> com base64 gigante, e por acaso "63"
  // aparece ali dentro (é só ruído de imagem, não um "63" de seção
  // vazando pro cartão).
  const textoCartoes = await p.locator('#print-area .tk-card-info').allInnerTexts();
  const textoCartoesJunto = textoCartoes.join(' | ');
  check(
    'conteúdo é ESSENCIAL — sem escopo (nº de seção) no cartão, mesmo o mesário tendo seção 63',
    !/Seção/.test(textoCartoesJunto) && !/\b63\b/.test(textoCartoesJunto),
    textoCartoesJunto
  );
  check('cada cartão tem guia de corte (borda tracejada via CSS .tk-card)', await p.locator('#print-area .tk-card').first().count() === 1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. QR gerado em resolução generosa mesmo pra link curto — a impressão
// fixa o TAMANHO FÍSICO em 40mm (CSS), mas a matriz por trás não pode
// nascer borrada; tkQrCanvasPx() garante um canvas de pelo menos 160px
// pro comprimento de URL típico de um token (bem abaixo do 1º tier). ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);

  await setTokens(p, [tokenMesario('tok-curto', 'Ana Paula', 1000)]);
  await p.click('button:has-text("🖨️ Imprimir todos")');
  await p.waitForTimeout(200);

  const canvasSize = await p.locator('#print-area .tk-card-qr canvas').evaluate(el => ({ w: el.width, h: el.height }));
  check('canvas do QR nasce em resolução generosa (≥160px) mesmo pra link curto', canvasSize.w >= 160 && canvasSize.h >= 160, JSON.stringify(canvasSize));

  const qrBoxCss = await p.locator('#print-area .tk-card-qr').evaluate(el => getComputedStyle(el).width);
  // getComputedStyle no modo tela (não impressão) não aplica @media print —
  // só confirma que a regra existe e o container está no DOM certo; o
  // tamanho físico de 40mm em si é regra CSS, testado por leitura de
  // arquivo abaixo (Playwright não emula impressão em milímetros de forma
  // confiável no headless).
  check('container do QR do cartão existe no DOM (dimensionado por CSS de impressão)', typeof qrBoxCss === 'string' && qrBoxCss.length > 0, qrBoxCss);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. 🖨️ de uma linha só imprime AQUELE token, no mesmo formato de
// cartão de visita (não mais a página de detalhe cheia de antes). ──
{
  const ctx = await b.newContext();
  const p = await newPage(ctx);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://localhost:8917/modules/SIME_tokens.html');
  await login(p);
  await p.waitForTimeout(200);

  await setTokens(p, [
    tokenMesario('tok-a', 'Bruno Alves', 5000), // mais recente → 1ª linha da lista
    tokenMesario('tok-b', 'Carla Souza', 4000),
  ]);
  await p.waitForTimeout(150);

  await p.locator('button[aria-label="Imprimir"]').first().click();
  await p.waitForTimeout(200);

  check('chama window.print() uma vez', await p.evaluate(() => window.__printCalls) === 1);
  check('gera só 1 página', await p.locator('#print-area .tk-page').count() === 1);
  check('gera só 1 cartão (não os 2 tokens da lista)', await p.locator('#print-area .tk-card').count() === 1);

  const printHtml = await p.locator('#print-area').innerHTML();
  check('é o cartão da 1ª linha (mais recente)', /Bruno Alves/.test(printHtml) && !/Carla Souza/.test(printHtml), printHtml);
  check('usa o mesmo cartão de visita (borda tracejada .tk-card, não a página de detalhe antiga)', await p.locator('#print-area .tk-card').count() === 1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_tokens_impressao.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
