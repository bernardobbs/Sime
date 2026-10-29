// Testa os padrões de data da eleição em SIME_principal.html:
//  - 1º turno: primeiro domingo de outubro
//  - 2º turno: último domingo de outubro
//  - véspera (D-1) derivada do Dia D
//  - tudo continua editável, e nada sobrescreve data já configurada
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

async function abrirConfig(p) {
  await p.click('button[onclick="goTab(\'config\',this)"]').catch(() => {});
  await p.waitForTimeout(200);
}

// Mesmo algoritmo de `domingosDeOutubro()`/`anoEleitoralPadrao()` em
// SIME_principal.html — replicado aqui (não importado, o teste roda fora do
// navegador) pra não travar em "2026" como se fosse sempre o ano corrente.
// Sem isso, o teste vira um time-bomb: passa enquanto "hoje" é antes do 1º
// turno daquele ano, e falha sozinho a partir do dia seguinte à eleição,
// mesmo sem nenhuma mudança de código (o padrão corretamente rola pro ano
// seguinte, só o teste é que ficava hardcoded).
function domingosDeOutubro(ano) {
  const primeiro = new Date(ano, 9, 1);
  primeiro.setDate(1 + ((7 - primeiro.getDay()) % 7));
  const ultimo = new Date(ano, 9, 31);
  ultimo.setDate(31 - ultimo.getDay());
  return { primeiro, ultimo };
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function anoEleitoralPadrao() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const ano = hoje.getFullYear();
  return domingosDeOutubro(ano).primeiro < hoje ? ano + 1 : ano;
}
function vesperaDe(d) {
  const v = new Date(d); v.setDate(v.getDate() - 1);
  return ymd(v);
}

// ── Padrões com armazenamento limpo ──
{
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(`${BASE}/SIME_principal.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);

  const r = await p.evaluate(() => ({
    t1d: document.getElementById('t1-d').value,
    t1d1: document.getElementById('t1-d1').value,
    t1dx: document.getElementById('t1-dx').value,
    t2d: document.getElementById('t2-d').value,
    t2d1: document.getElementById('t2-d1').value,
  }));

  const anoEsperado = anoEleitoralPadrao();
  const { primeiro, ultimo } = domingosDeOutubro(anoEsperado);
  const t1dEsperado = ymd(primeiro);
  const t2dEsperado = ymd(ultimo);
  const t1d1Esperado = vesperaDe(primeiro);
  const t2d1Esperado = vesperaDe(ultimo);

  check('1º turno usa o primeiro domingo de outubro', r.t1d === t1dEsperado, `${r.t1d} (esperado ${t1dEsperado})`);
  check('2º turno usa o último domingo de outubro', r.t2d === t2dEsperado, `${r.t2d} (esperado ${t2dEsperado})`);
  check('véspera do 1º turno é o dia anterior', r.t1d1 === t1d1Esperado, `${r.t1d1} (esperado ${t1d1Esperado})`);
  check('véspera do 2º turno é o dia anterior', r.t2d1 === t2d1Esperado, `${r.t2d1} (esperado ${t2d1Esperado})`);
  check('D-X (carga e lacre) fica em branco para o cartório definir', r.t1dx === '', r.t1dx);
  check('sem erro JS', erros.length === 0, erros.join(' | '));

  // Mudar o Dia D recalcula a véspera, inclusive virando o mês.
  await p.fill('#t1-d', '2026-11-01');
  await p.dispatchEvent('#t1-d', 'input');
  await p.waitForTimeout(200);
  const v = await p.inputValue('#t1-d1');
  check('mudar o Dia D recalcula a véspera (vira o mês)', v === '2026-10-31', v);

  // O campo continua editável — véspera atípica é possível.
  await p.fill('#t1-d1', '2026-10-30');
  check('véspera continua editável', (await p.inputValue('#t1-d1')) === '2026-10-30');
  check('Dia D continua editável', (await p.inputValue('#t1-d')) === '2026-11-01');

  await p.close();
}

// ── Não sobrescreve eleição já configurada ──
{
  const p = await b.newPage();
  await p.addInitScript(() => {
    localStorage.setItem('sime_eleicao_v1', JSON.stringify({
      nome: 'Suplementar 2026', turno_ativo: 1,
      turno1: { dx: '2026-03-10', d1: '2026-03-14', d: '2026-03-15', abertura: '08:00', encerramento: '17:00', dist_inicio: '05:30', intervalo_min: 10 },
      turno2: {},
    }));
  });
  await p.goto(`${BASE}/SIME_principal.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    d: document.getElementById('t1-d').value,
    d1: document.getElementById('t1-d1').value,
    dx: document.getElementById('t1-dx').value,
  }));
  check('não sobrescreve o Dia D já salvo', r.d === '2026-03-15', r.d);
  check('não sobrescreve a véspera já salva', r.d1 === '2026-03-14', r.d1);
  check('não sobrescreve o D-X já salvo', r.dx === '2026-03-10', r.dx);
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
