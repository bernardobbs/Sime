// Testa a busca pública de local de votação (SIME_buscar_local.html,
// acessada em produção por /onde-votar via rewrite único do vercel.json —
// ver CLAUDE.md "BUSCA PÚBLICA DE LOCAL DE VOTAÇÃO", 23/10/2026).
//
// Bug real corrigido nesta suíte: a página usava imports/links RELATIVOS
// (`./vendor/supabase-js.esm.js`, `./sime_config.js`, `./sime_theme_cream.css`
// etc.). Isso funciona quando a página é aberta por seu caminho real
// (/modules/SIME_buscar_local.html) ou por um rewrite de PREFIXO como
// `/z/:zona/:caminho*` (onde um sub-request relativo também cai sob o mesmo
// prefixo e é re-escrito). Mas `/onde-votar` é um rewrite de caminho ÚNICO —
// o navegador mantém a URL /onde-votar na barra, e todo import relativo
// resolve contra "/" (não "/modules/"), 404 em produção, o módulo nunca
// carrega e a página fica morta (exatamente "testei e não funcionou").
// Corrigido trocando todo asset/import pra caminho absoluto (/modules/...).
//
// Este teste reproduz a topologia real: stuba as respostas HTTP pra simular
// o rewrite único (só /onde-votar e /modules/* resolvem; qualquer outro
// caminho — o que um import relativo quebrado produziria — devolve 404),
// e confirma que a página carrega, busca, renderiza resultado e desenha o
// QR Code do Google Maps.
import pw from 'playwright';
import fs from 'fs';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
export function createClient(url, key) {
  return {
    rpc(name, params) {
      window.__mockConfig.rpcCalls.push({ name, params });
      if (window.__mockConfig.rpcShouldFail) {
        return Promise.resolve({ data: null, error: { message: 'mock fail' } });
      }
      return Promise.resolve({ data: window.__mockConfig.rows || [], error: null });
    },
  };
}
`;

async function withPage(run) {
  const page = await b.newPage();
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  page.on('pageerror', (err) => logs.push('PAGEERROR: ' + err.message));

  // Simula o rewrite ÚNICO de produção: só /onde-votar e /modules/* existem;
  // qualquer outro caminho (o que um import relativo quebrado produziria a
  // partir de /onde-votar) 404.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/modules/vendor/supabase-js.esm.js') {
      return route.fulfill({ contentType: 'application/javascript', body: STUB_SUPABASE_JS });
    }
    if (url.pathname.startsWith('/modules/')) {
      const fsPath = '/home/user/Sime' + url.pathname;
      try {
        const body = fs.readFileSync(fsPath);
        let ct = 'application/octet-stream';
        if (fsPath.endsWith('.js')) ct = 'application/javascript';
        else if (fsPath.endsWith('.css')) ct = 'text/css';
        else if (fsPath.endsWith('.html')) ct = 'text/html';
        else if (fsPath.endsWith('.png')) ct = 'image/png';
        return route.fulfill({ contentType: ct, body });
      } catch (e) {
        return route.fulfill({ status: 404, body: 'not found: ' + fsPath });
      }
    }
    if (url.pathname === '/onde-votar') {
      const body = fs.readFileSync('/home/user/Sime/modules/SIME_buscar_local.html');
      return route.fulfill({ contentType: 'text/html', body });
    }
    return route.fulfill({ status: 404, body: 'not found: ' + url.pathname });
  });

  await page.addInitScript(() => {
    window.__mockConfig = {
      rpcCalls: [],
      rpcShouldFail: false,
      rows: [
        { zona_numero: 7, secao_numero: 1, local_nome: '1279 - CENTRO DE EDUCAÇÃO DE JOVENS E ADULTOS MULATA LIMA', municipio: 'Campo Maior', endereco: 'Rua Benjamim Constant, 1158 - Centro', eleitores: 176, latitude: -4.8278589, longitude: -42.1645385 },
      ],
    };
  });

  await page.goto('http://localhost/onde-votar');
  await page.waitForTimeout(300);
  await run(page, logs);
  await page.close();
}

// Caso 1: caminho feliz — página carrega via /onde-votar (sem relativos
// quebrados), busca, mostra resultado com QR.
await withPage(async (page, logs) => {
  check('título carrega (sem import de módulo quebrado)', (await page.title()) === 'SIME · Onde Votar');
  check('sem pageerror/404 disparado pelo carregamento inicial',
    !logs.some(l => l.includes('PAGEERROR') || l.includes('Failed to load module')), logs.join(' | '));

  // 23/10/2026, pedido direto: "quero que fique bem explicito que a consulta
  // é para a 7ª Zona Eleitoral do piauí" — tem que aparecer ANTES de buscar,
  // não só dentro do card de resultado.
  const subHeader = await page.locator('#h-sub').textContent();
  check('subtítulo do topo já diz a zona antes de buscar', subHeader.includes('7ª Zona Eleitoral do Piauí'), subHeader);
  const buscaSub = await page.locator('.busca-sub').textContent();
  check('texto de apoio da busca também diz a zona', buscaSub.includes('7ª Zona Eleitoral do Piauí'), buscaSub);

  await page.fill('#busca-input', '001');
  await page.waitForTimeout(600);

  const rpcCalls = await page.evaluate(() => window.__mockConfig.rpcCalls);
  check('chama a RPC certa', rpcCalls.length === 1 && rpcCalls[0].name === 'sime_buscar_local_votacao', JSON.stringify(rpcCalls));
  check('passa o termo digitado', rpcCalls[0]?.params?.p_termo === '001');

  const cardText = await page.locator('.loc-card').first().textContent();
  check('card do resultado mostra o nome do local', cardText.includes('CENTRO DE EDUCAÇÃO'), cardText);
  check('card mostra a seção', cardText.includes('Seção 001'), cardText);

  const mapsHref = await page.locator('.loc-maps').first().getAttribute('href');
  check('link do mapa usa a coordenada', mapsHref === 'https://www.google.com/maps?q=-4.8278589,-42.1645385', mapsHref);

  const canvasCount = await page.locator('.loc-qr canvas').count();
  check('QR Code desenhado pro resultado', canvasCount === 1, 'canvas=' + canvasCount);

  const legenda = await page.locator('.loc-qr-legenda').first().textContent();
  check('legenda do QR explica o uso', legenda.includes('câmera'), legenda);
});

// Caso 1b: a RPC (23/10/2026, "quero que conste as seção agregadas, e
// somente da 7ª zona") passou a devolver TODAS as seções do mesmo prédio
// quando a busca bate por NÚMERO de uma delas — este teste garante que o
// front-end (que só agrupa o que recebe) mostra as várias seções
// agregadas num card só, não um card por seção.
await withPage(async (page) => {
  await page.evaluate(() => {
    window.__mockConfig.rows = [
      { zona_numero: 7, secao_numero: 85, local_nome: '1023 - GRUPO ESCOLAR MONSENHOR MATEUS', municipio: 'Sigefredo Pacheco', endereco: null, eleitores: 300, latitude: null, longitude: null },
      { zona_numero: 7, secao_numero: 86, local_nome: '1023 - GRUPO ESCOLAR MONSENHOR MATEUS', municipio: 'Sigefredo Pacheco', endereco: null, eleitores: 280, latitude: null, longitude: null },
      { zona_numero: 7, secao_numero: 177, local_nome: '1023 - GRUPO ESCOLAR MONSENHOR MATEUS', municipio: 'Sigefredo Pacheco', endereco: null, eleitores: 310, latitude: null, longitude: null },
    ];
  });
  await page.fill('#busca-input', '85');
  await page.waitForTimeout(600);
  const cardCount = await page.locator('.loc-card').count();
  check('seções do mesmo prédio viram 1 card só, não 3', cardCount === 1, 'cards=' + cardCount);
  const cardText = await page.locator('.loc-card').first().textContent();
  check('card mostra as 3 seções agregadas', ['085', '086', '177'].every(n => cardText.includes('Seção ' + n)), cardText);
});

// Caso 1c: bug real corrigido em 23/10/2026 — busca puramente numérica
// ("40") não podia mais casar por SUBSTRING contra o código embutido no
// nome do local (ex.: "1040 - ..."). A RPC real já filtra isso (ver
// sql/SIME_busca_local_votacao_publica.sql); este teste garante que o
// FRONT-END simplesmente mostra "nenhum resultado" quando a RPC devolve
// vazio pra um número que não existe — sem mascarar com um resultado que
// a RPC nunca deveria ter mandado.
await withPage(async (page) => {
  await page.evaluate(() => { window.__mockConfig.rows = []; });
  await page.fill('#busca-input', '40');
  await page.waitForTimeout(600);
  const vazio = await page.locator('.vazio').first().textContent();
  check('seção inexistente (ex.: "40") nunca é "resgatada" por nome embutido no prédio', vazio.includes('Nenhum local encontrado'), vazio);
});

// Caso 2: busca sem resultado nunca trava, mostra o vazio de sempre.
await withPage(async (page) => {
  await page.evaluate(() => { window.__mockConfig.rows = []; });
  await page.fill('#busca-input', '999');
  await page.waitForTimeout(600);
  const vazio = await page.locator('.vazio').first().textContent();
  check('sem resultado mostra aviso amigável', vazio.includes('Nenhum local encontrado'), vazio);
  const canvasCount = await page.locator('.loc-qr canvas').count();
  check('sem resultado não tenta desenhar QR nenhum', canvasCount === 0, 'canvas=' + canvasCount);
});

// Caso 3: erro de rede (RPC falha) mostra mensagem amigável, não crua.
await withPage(async (page) => {
  await page.evaluate(() => { window.__mockConfig.rpcShouldFail = true; });
  await page.fill('#busca-input', '001');
  await page.waitForTimeout(600);
  const vazio = await page.locator('.vazio').first().textContent();
  check('erro de rede mostra aviso amigável (nunca a mensagem crua)', vazio.includes('Não deu pra buscar'), vazio);
});

await b.close();

let pass = 0;
for (const r of results) {
  console.log((r.ok ? '✅' : '❌'), r.n, r.ok ? '' : ('— ' + r.e));
  if (r.ok) pass++;
}
console.log(`\n${pass}/${results.length} checks passed`);
if (pass !== results.length) process.exit(1);
