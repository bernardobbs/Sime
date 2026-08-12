// Testa o destaque de campo inválido em SIME_principal.html: antes, salvar
// sem preencher o Dia D só mostrava um toast (que some rápido) — nada na
// tela indicava qual campo corrigir (achado "médio" da auditoria). Também
// confere que os botões primários ganharam alvo de toque ≥44px.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));

await p.goto('http://localhost:8917/modules/SIME_principal.html');
await p.waitForTimeout(300);

check('zero erros JS ao carregar', erros.length === 0, erros.join('; '));

// destacarCampoInvalido() marca o campo, sem precisar de sessão/backend —
// é a mesma função que saveEleicao() chama quando salvarEleicaoNoBanco()
// devolve motivo:'sem data'.
await p.evaluate(() => window.destacarCampoInvalido('t1-d'));
await p.waitForTimeout(100);
const marcado = await p.locator('#t1-d').evaluate(el => el.classList.contains('campo-invalido'));
check('campo Dia D ganha a classe de destaque', marcado);
const focado = await p.evaluate(() => document.activeElement?.id === 't1-d');
check('campo Dia D recebe foco', focado);

// digitar no campo remove o destaque — não fica preso vermelho pra sempre
await p.fill('#t1-d', '2026-10-04');
await p.waitForTimeout(100);
const aindaMarcado = await p.locator('#t1-d').evaluate(el => el.classList.contains('campo-invalido'));
check('destaque some ao digitar', !aindaMarcado);

// alvo de toque: botão primário de salvar tem pelo menos 44px de altura
const alturaSalvar = await p.locator('button:has-text("💾 Salvar configuração")').evaluate(el => el.getBoundingClientRect().height);
check('botão "Salvar configuração" tem alvo de toque ≥44px', alturaSalvar >= 44, String(alturaSalvar));

check('zero erros JS ao final', erros.length === 0, erros.join('; '));

await ctx.close();
await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_principal_campo_invalido.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
