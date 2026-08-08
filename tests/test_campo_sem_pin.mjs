// Testa o modo com o PIN SUPRIMIDO (SIME_CONFIG.exigirPin=false), que é o que
// a operação pediu por ora.
//
// A propriedade que NÃO pode cair junto com o PIN: continua sendo preciso um
// TOKEN. Suprimir o segundo fator significa "o cartão sozinho basta" — não
// "qualquer um entra". Sem token na URL, o operador tem que continuar barrado
// nas seis telas de campo.
//
// As suítes que exercitam o fluxo COM PIN (test_mesario, test_conferente, …)
// fixam exigirPin=true no stub — o caminho continua existindo no código e
// volta quando o cartório quiser.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_CONFIG = `export const SIME_CONFIG = {
  exigirPin: false,
  supabaseUrl: 'https://exemplo.supabase.co',
  supabaseAnonKey: 'anon-de-teste',
};`;

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; } eq(){ return this; } in(){ return this; }
  order(){ return this; } limit(){ return this; }
  maybeSingle(){ return Promise.resolve({ data:null, error:null }); }
  then(res){ return res({ data:[], error:null }); }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(){ const c={ on(){return c;}, subscribe(){return c;} }; return c; },
    removeChannel(){},
    rpc(){ return Promise.resolve({ data:null, error:null }); },
    auth:{ async getSession(){ return { data:{ session:null } }; },
           async getUser(){ return { data:{ user:null } }; } },
  };
}
`;

// As quatro telas com campo único de PIN e as duas com teclado de 4 dígitos.
const CAMPO_UNICO = ['SIME_mesario', 'SIME_instalador', 'SIME_motorista', 'SIME_midias'];
const TECLADO     = ['SIME_conferente', 'SIME_acessibilidade'];

async function abrir(ctx, modulo, query = '') {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/sime_config.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_CONFIG }));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  let loginChamado = 0;
  await p.route('**/functions/v1/sime-login', async (route) => {
    loginChamado++;
    const body = route.request().postDataJSON();
    await route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
      jwt:'jwt.x', exp: Math.floor(Date.now()/1000)+999, zona_id:'z7',
      tipo:'mesario', rotas:['Rota 001'], local_id:null, local_nome:'G.E. Teste', secoes:['0063'],
      __body: body,
    }) });
  });
  await p.goto(`http://localhost:8917/modules/${modulo}.html${query}`);
  await p.waitForTimeout(600);
  return { p, erros, contarLogin: () => loginChamado };
}

const visivel = (p, sel) => p.evaluate((s) => {
  const n = document.querySelector(s);
  return !!n && getComputedStyle(n).display !== 'none';
}, sel);

// ── 1. O campo de PIN some nas seis telas ──
for (const m of [...CAMPO_UNICO, ...TECLADO]) {
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, m, '?token=BX86FPJ7');
  const temPin = (await visivel(p, '#login-pin')) || (await visivel(p, '.pin-input-wrap'));
  check(`${m}: campo de PIN escondido`, temPin === false);
  check(`${m}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. O token continua obrigatório — é o que sobra do controle de acesso ──
for (const m of TECLADO) {
  const ctx = await b.newContext();
  const { p, erros, contarLogin } = await abrir(ctx, m); // SEM ?token=
  await p.click('.btn-login');
  await p.waitForTimeout(400);

  check(`${m}: sem token, não autentica no servidor`, contarLogin() === 0);
  const entrou = await p.evaluate(() => {
    const lv = document.querySelector('.login-view');
    return !!lv && !lv.classList.contains('active') ? 'saiu' : 'ficou';
  });
  check(`${m}: sem token, continua na tela de login`, entrou === 'ficou', entrou);
  check(`${m}: avisa para usar o QR Code`,
    (await p.textContent('#toast')).toLowerCase().includes('qr'), await p.textContent('#toast'));
  check(`${m}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Com token, o teclado entra sem pedir dígito nenhum ──
for (const m of TECLADO) {
  const ctx = await b.newContext();
  const { p, erros, contarLogin } = await abrir(ctx, m, '?token=BX86FPJ7');
  await p.click('.btn-login');
  await p.waitForTimeout(600);
  check(`${m}: com token, autentica sem PIN`, contarLogin() === 1, 'chamadas=' + contarLogin());
  check(`${m}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Nas telas de campo único, o token ainda precisa ser informado ──
for (const m of CAMPO_UNICO) {
  const ctx = await b.newContext();
  const { p, erros, contarLogin } = await abrir(ctx, m); // sem ?token=
  const v = await p.inputValue('#login-token');
  check(`${m}: sem ?token= o campo fica vazio`, v === '', v);

  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
  check(`${m}: submeter sem token não vira sessão`, contarLogin() === 0 || (await visivel(p, '#login-overlay')));
  check(`${m}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. O QR preenche o token e o login sai sem digitar nada ──
for (const m of CAMPO_UNICO) {
  const ctx = await b.newContext();
  const { p, erros, contarLogin } = await abrir(ctx, m, '?token=BX86FPJ7');
  check(`${m}: QR preenche o token`, (await p.inputValue('#login-token')) === 'BX86FPJ7');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(600);
  check(`${m}: entra sem PIN`, contarLogin() === 1, 'chamadas=' + contarLogin());
  check(`${m}: sem erro JS`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
