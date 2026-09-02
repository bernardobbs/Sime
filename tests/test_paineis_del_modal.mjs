// Testa SIME_paineis.html: excluir painel usava confirm() nativo, quebrando o
// padrão de modal já usado no resto da tela (achado "baixo" da auditoria) —
// agora usa o mesmo modal customizado (#conf-overlay) do restante do sistema.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const PANEL = {
  id: 'painel-teste-1',
  name: 'Painel de Teste',
  icon: '📺',
  rotation: false,
  rotDelay: 10,
  pages: [{ label: 'Página 1', sections: ['0701'] }],
};

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
// nenhum handler de 'dialog' registrado de propósito — se algum confirm()
// nativo sobrar, o clique trava (a página congela esperando resposta) e o
// teste falha por timeout, provando que a migração pro modal é real.
await p.addInitScript((panel) => {
  localStorage.setItem('sime_panels_v1', JSON.stringify([panel]));
}, PANEL);

await p.goto('http://localhost:8917/modules/SIME_paineis.html');
await p.waitForTimeout(300);

check('zero erros JS ao carregar', erros.length === 0, erros.join('; '));
check('painel seedado aparece no gerenciador', await p.locator('.panel-card:not(.add-card)').count() === 1);

await p.click('.btn-red.btn-sm'); // 🗑 excluir
await p.waitForTimeout(150);
check('modal de confirmação abre', await p.evaluate(() => document.getElementById('conf-overlay').classList.contains('show')));
check('painel continua na lista antes de confirmar', await p.evaluate(() => JSON.parse(localStorage.getItem('sime_panels_v1')).length === 1));

// cancelar não apaga
await p.click('.conf-btns >> text=Cancelar');
await p.waitForTimeout(150);
check('cancelar fecha o modal', await p.evaluate(() => !document.getElementById('conf-overlay').classList.contains('show')));
check('cancelar não apaga o painel', await p.evaluate(() => JSON.parse(localStorage.getItem('sime_panels_v1')).length === 1));
check('cancelar não recria elemento no grid (segue 1)', await p.locator('.panel-card:not(.add-card)').count() === 1);

// confirmar apaga
await p.click('.btn-red.btn-sm');
await p.click('#conf-ok-btn');
await p.waitForTimeout(150);
check('confirmar fecha o modal', await p.evaluate(() => !document.getElementById('conf-overlay').classList.contains('show')));
check('confirmar remove o painel do localStorage', await p.evaluate(() => JSON.parse(localStorage.getItem('sime_panels_v1')).length === 0));
check('confirmar remove o card da tela', await p.locator('.panel-card:not(.add-card)').count() === 0);
check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
