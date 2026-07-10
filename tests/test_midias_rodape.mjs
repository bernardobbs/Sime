import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(String(e)));
await p.goto('http://localhost:8917/modules/SIME_midias.html');
await p.waitForTimeout(400);

check('zero erros JS', erros.length === 0, erros.join('; '));

// 0101 = Jatobá do Piauí, 0079 = Sigefredo Pacheco, 0001 = Campo Maior (ver SECOES do arquivo)
const msgJatoba = await p.evaluate(() => montarMsgMidiaPronta('0101', 'U.E. Tertuliano Pereira'));
check('seção de Jatobá do Piauí NÃO usa "Campo Maior" no rodapé', !msgJatoba.includes('Campo Maior'));
check('seção de Jatobá do Piauí usa o município real no rodapé', msgJatoba.includes('Jatobá do Piauí'));

const msgSigefredo = await p.evaluate(() => montarMsgRotaAlterada('0079', 'U.E. da Paz Sousa', { nome: 'Fulano' }));
check('seção de Sigefredo Pacheco usa o município real no rodapé', msgSigefredo.includes('Sigefredo Pacheco'));

const msgCampoMaior = await p.evaluate(() => montarMsgNovoResponsavel('0001', 'Centro Ed. JA Mulata Lima', { nome: 'Ciclana' }));
check('seção de Campo Maior continua correta (não regrediu)', msgCampoMaior.includes('Campo Maior'));

const msgInexistente = await p.evaluate(() => montarMsgMidiaPronta('9999', 'Desconhecido'));
check('seção inexistente cai no fallback "Campo Maior" (sem quebrar)', msgInexistente.includes('Campo Maior'));

await ctx.close();
await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
