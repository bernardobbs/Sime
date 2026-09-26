// Testa o botão "▦ Trocar painel de TV" (sime_tv_nav.js, 22/09/2026, pedido
// direto: "trocar entre os 4 paineis (Preparação/Véspera/Distribuição/Dia)
// direto do proprio tv box") — presente nos 4 painéis, self-contained (não
// depende de sessão/Supabase, só do nome do próprio arquivo pra destacar o
// painel atual). Sem stub de Supabase: o script roda mesmo sem rede (a
// sessão de TV falha graciosamente, como já documentado alhures), então
// basta abrir a página real e verificar o DOM.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const PAINEIS = [
  ['SIME_tv_preparacao.html', 'TV Preparação'],
  ['SIME_tv_vespera.html', 'TV Véspera'],
  ['SIME_tv_distribuicao.html', 'TV Distribuição'],
  ['SIME_tv_dia.html', 'TV Dia da Eleição'],
];

for (const [arquivo, label] of PAINEIS) {
  const p = await b.newPage();
  await p.goto(`http://localhost:8917/modules/${arquivo}`);
  await p.waitForTimeout(300);

  check(`${arquivo}: botão de trocar painel visível`, await p.locator('#sime-tvnav-btn').isVisible());

  await p.locator('#sime-tvnav-btn').click();
  await p.waitForTimeout(100);
  check(`${arquivo}: overlay abre ao clicar`, await p.locator('#sime-tvnav-overlay.open').isVisible());

  const itens = await p.locator('.sime-tvnav-item').allTextContents();
  check(`${arquivo}: lista os 4 painéis`, itens.length === 4, itens.join(' | '));
  check(`${arquivo}: painel atual (${label}) marcado`, itens.some((t) => t.includes(label) && t.includes('atual')), itens.join(' | '));

  const outros = PAINEIS.filter(([a]) => a !== arquivo);
  const [outroArquivo, outroLabel] = outros[0];
  check(`${arquivo}: outro painel (${outroLabel}) clicável`,
    await p.locator('.sime-tvnav-item:not(.atual)', { hasText: outroLabel }).isVisible());

  // Fechar via "Fechar"
  await p.locator('#sime-tvnav-close').click();
  await p.waitForTimeout(100);
  check(`${arquivo}: overlay fecha em "Fechar"`, !(await p.locator('#sime-tvnav-overlay.open').isVisible()));

  // Navegação real pro outro painel (preserva query string)
  await p.goto(`http://localhost:8917/modules/${arquivo}?tv_token=ABC123`);
  await p.waitForTimeout(300);
  await p.locator('#sime-tvnav-btn').click();
  await Promise.all([
    p.waitForURL((u) => u.pathname.endsWith(outroArquivo)),
    p.locator('.sime-tvnav-item:not(.atual)', { hasText: outroLabel }).click(),
  ]);
  const urlDepois = new URL(p.url());
  check(`${arquivo}: clique em ${outroLabel} navega pro arquivo certo`, urlDepois.pathname.endsWith(outroArquivo), urlDepois.href);
  check(`${arquivo}: navegação preserva a query string (tv_token)`, urlDepois.searchParams.get('tv_token') === 'ABC123', urlDepois.href);

  await p.close();
}

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(`test_tv_panel_nav: ${results.length - fails.length}/${results.length} passaram`);
if (fails.length) { fails.forEach((f) => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`)); process.exit(1); }
