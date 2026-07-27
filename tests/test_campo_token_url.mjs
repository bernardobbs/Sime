// Testa o preenchimento automático do token a partir do ?token= da URL nos
// módulos de campo — o que o QR Code do cartão codifica (buildUrl() em
// SIME_tokens.html gera ".../SIME_mesario.html?token=XXXXXXXX").
//
// Sem isso o operador escaneia o QR e mesmo assim precisa digitar os 8
// caracteres à mão. O PIN NÃO é preenchido de propósito: é o segundo fator, e
// o cartão pode ser fotografado ou ficar exposto na mesa.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

// Os 4 módulos de campo cujo login é "campo de token + campo de PIN".
//
// SIME_conferente e SIME_acessibilidade ficam de fora de propósito: têm outra
// UI de login (teclado de 4 dígitos, sem campo de token) e já leem o ?token=
// por conta própria — porém validando contra o sime_tokens_v1 do localStorage,
// que no celular do operador está sempre vazio. É um defeito separado e maior
// (exige login server-first), não coberto aqui.
const MODULOS = [
  'SIME_mesario.html',
  'SIME_motorista.html',
  'SIME_instalador.html',
  'SIME_midias.html',
];

const TOKEN = 'BX86FPJ7';

for (const mod of MODULOS) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));

  await p.goto(`${BASE}/${mod}?token=${TOKEN}`, { waitUntil: 'load' });
  await p.waitForTimeout(400);

  const r = await p.evaluate(() => ({
    token: document.getElementById('login-token')?.value ?? null,
    pin: document.getElementById('login-pin')?.value ?? null,
    focado: document.activeElement?.id ?? null,
  }));

  check(`${mod}: campo de token preenchido pela URL`, r.token === TOKEN, `valor=${r.token}`);
  check(`${mod}: PIN continua vazio (segundo fator)`, !r.pin, `valor=${r.pin}`);
  check(`${mod}: sem erro JS`, erros.length === 0, erros.join(' | '));

  await p.close();
}

// Token em minúsculas na URL (usuário digitando à mão) tem que normalizar —
// genId() em SIME_tokens.html só emite maiúsculas.
{
  const p = await b.newPage();
  await p.goto(`${BASE}/SIME_mesario.html?token=${TOKEN.toLowerCase()}`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const v = await p.inputValue('#login-token');
  check('token minúsculo na URL é normalizado para maiúsculo', v === TOKEN, `valor=${v}`);
  await p.close();
}

// Sem ?token= o formulário fica vazio, como antes — não pode inventar valor.
{
  const p = await b.newPage();
  await p.goto(`${BASE}/SIME_mesario.html`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const v = await p.inputValue('#login-token');
  check('sem ?token= o campo continua vazio', v === '', `valor=${v}`);
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
