// Testa o switch "Rotação automática" no editor de painel de
// SIME_paineis.html: era um <button class="toggle"> sem role, sem
// aria-pressed e sem label associada — leitor de tela não dizia se estava
// ligado ou desligado, nem o que o controle fazia (achado "médio" da
// auditoria).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));

await p.goto('http://localhost:8917/modules/SIME_paineis.html');
await p.waitForTimeout(300);
check('zero erros JS ao carregar', erros.length === 0, erros.join('; '));

await p.click('button:has-text("＋ Novo painel")');
await p.waitForTimeout(200);

const toggle = p.locator('#rot-toggle');
check('switch tem role=switch', await toggle.getAttribute('role') === 'switch');
check('switch começa com aria-pressed=false (estático)', await toggle.getAttribute('aria-pressed') === 'false');
check('switch referencia a legenda + o rótulo de estado via aria-labelledby',
  (await toggle.getAttribute('aria-labelledby') || '').includes('rot-toggle-caption') &&
  (await toggle.getAttribute('aria-labelledby') || '').includes('rot-label'));
check('legenda "Rotação automática" tem o id referenciado', await p.locator('#rot-toggle-caption').count() === 1);

await toggle.click();
await p.waitForTimeout(150);
check('aria-pressed vira true ao ligar', await toggle.getAttribute('aria-pressed') === 'true');
check('rótulo de estado atualiza pra "Automática"', (await p.locator('#rot-label').textContent()).includes('Automática'));

await toggle.click();
await p.waitForTimeout(150);
check('aria-pressed volta a false ao desligar', await toggle.getAttribute('aria-pressed') === 'false');

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_paineis_rot_toggle.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
