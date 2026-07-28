// Garante que SIME_conferente e SIME_acessibilidade NÃO entram no aplicativo
// sem credencial válida.
//
// Antes destes testes os dois módulos tinham um atalho de desenvolvimento:
// "se não há token em sime_tokens_v1, entra com acesso total". Em produção o
// localStorage vazio é exatamente o estado do celular de qualquer operador —
// e de qualquer pessoa com o link —, então o atalho liberava ver e operar
// todas as rotas / todos os locais, inclusive disparar pânico, sem PIN.
// O SIME_acessibilidade ainda aceitava ?local=<nome> como entrada direta.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

// Estas suítes exercitam o fluxo COM PIN. A operação suprimiu o PIN por ora
// (SIME_CONFIG.exigirPin=false), mas o caminho continua no código e volta
// quando o cartório quiser — então aqui a configuração é fixada, em vez de
// deixar a suíte seguir um flag de produção que muda debaixo dela.
const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: true,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;


// Entrou no app = a tela de login não é a que está visível.
async function estadoDaTela(p) {
  return p.evaluate(() => {
    const visivel = el => !!el && getComputedStyle(el).display !== 'none';
    const login = document.getElementById('view-login');
    const outras = [...document.querySelectorAll('.view, .login-view')]
      .filter(v => v.id !== 'view-login' && visivel(v));
    return { loginVisivel: visivel(login), entrouNoApp: outras.length > 0 };
  });
}

const CENARIOS = [
  ['conferente, armazenamento limpo',        `${BASE}/SIME_conferente.html`],
  ['conferente, ?token= desconhecido',       `${BASE}/SIME_conferente.html?token=BX86FPJ7`],
  ['conferente, ?pin= chutado',              `${BASE}/SIME_conferente.html?pin=1234`],
  ['acessibilidade, armazenamento limpo',    `${BASE}/SIME_acessibilidade.html`],
  ['acessibilidade, ?token= desconhecido',   `${BASE}/SIME_acessibilidade.html?token=BX86FPJ7`],
  ['acessibilidade, ?local= direto',         `${BASE}/SIME_acessibilidade.html?local=G.E.%20Treze%20de%20Mar%C3%A7o`],
];

for (const [nome, url] of CENARIOS) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const { loginVisivel, entrouNoApp } = await estadoDaTela(p);
  check(`${nome}: NÃO entra no app`, !entrouNoApp);
  check(`${nome}: para na tela de PIN`, loginVisivel);
  check(`${nome}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await p.close();
}

// PIN chutado na tela de login, sem token conhecido, também não pode passar.
//
// A operação suprimiu o PIN (acesso só pelo QR), então este bloco roda contra
// a configuração COM PIN, fixada no stub: o caminho continua no código e volta
// quando o cartório quiser. Os cenários acima, ao contrário, rodam de
// propósito contra o sime_config.js REAL — é a configuração que vai ao ar que
// precisa provar que ninguém entra sem token.
{
  const p = await b.newPage();
  await p.route('**/sime_config.js**', (r) => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB_CONFIG }));
  await p.goto(`${BASE}/SIME_conferente.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i++) await p.fill(`#pin-${i}`, String(i + 1));
  await p.click('.btn-login');
  await p.waitForTimeout(600);
  const { entrouNoApp } = await estadoDaTela(p);
  check('conferente: PIN chutado sem token não entra', !entrouNoApp);
  await p.close();
}

// Com o PIN suprimido (configuração real de hoje), tocar em Entrar sem token
// também não pode passar — é a garantia que sobra quando o segundo fator sai.
{
  const p = await b.newPage();
  await p.goto(`${BASE}/SIME_conferente.html`, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.click('.btn-login');
  await p.waitForTimeout(600);
  const { entrouNoApp } = await estadoDaTela(p);
  check('conferente: sem PIN e sem token, Entrar não abre o app', !entrouNoApp);
  await p.close();
}

// O caminho legítimo continua funcionando: token válido no localStorage (o
// computador do cartório, offline) entra normalmente.
{
  const p = await b.newPage();
  const expira = Date.now() + 86400000;
  await p.addInitScript((exp) => {
    localStorage.setItem('sime_tokens_v1', JSON.stringify({
      TOKENOK1: {
        id: 'TOKENOK1', pin: '4321', nome: 'Conferente Teste', tipo: 'conferente',
        rotas: ['Rota 004'], local: null, secoes: [], turno: 1, zona: '7',
        criado_em: Date.now(), expira_em: exp, usado_em: null,
      },
    }));
  }, expira);
  await p.goto(`${BASE}/SIME_conferente.html?token=TOKENOK1`, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const { entrouNoApp } = await estadoDaTela(p);
  check('conferente: token local válido ainda entra (offline no cartório)', entrouNoApp);
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
