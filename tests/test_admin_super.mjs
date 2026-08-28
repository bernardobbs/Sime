// Testa o fluxo do super_admin em SIME_admin.html: raiz agora exige login
// (vercel.json aponta "/" pra cá), e um admin com sime_usuarios.perfil=
// 'super_admin' ganha a aba Zonas (escondida pra todo o resto) com dados
// reais de todas as zonas — sem tocar no fluxo já existente do admin de zona
// (curUser via equipe local, ver initTeam()/switchUser()).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ meuUsuario }) {
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [
    { id: 'zona-7', numero: 7, municipio: 'Campo Maior' },
    { id: 'zona-96', numero: 96, municipio: null },
  ];
  const SECOES = [
    { zona_id: 'zona-7', numero: 63, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 300 },
    { zona_id: 'zona-7', numero: 64, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 280 },
    { zona_id: 'zona-7', numero: 65, local_nome: 'G.E. Treze de Março', municipio: 'Campo Maior', eleitores: 260 },
  ];
  const USUARIOS_ATIVOS = [
    { zona_id: 'zona-7' }, { zona_id: 'zona-7' },
  ];
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => {
        session = { user: { email } };
        return { data: { session }, error: null };
      },
    },
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; }, in(){ return qb; },
        maybeSingle(){
          if (t === 'sime_usuarios') return Promise.resolve({ data: ${JSON.stringify(meuUsuario) ?? 'null'}, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_secoes') return resolve({ data: SECOES, error: null });
          if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
          if (t === 'sime_usuarios') return resolve({ data: USUARIOS_ATIVOS, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
  };
}
`;
}

async function fazerLogin(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);
}

// ── Caso 1: admin comum (perfil não é super_admin na tabela) — aba Zonas continua escondida ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ meuUsuario: { nome: 'Maria S.', perfil: 'coordenador', zona_id: 'zona-7' } }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  check('admin comum: zero erros JS', erros.length === 0, erros.join('; '));
  const zonasVisivel = await p.evaluate(() => getComputedStyle(document.getElementById('tab-zonas-btn')).display !== 'none');
  check('admin comum: aba Zonas continua escondida', !zonasVisivel);
  const nameTxt = await p.locator('#u-name').textContent();
  check('admin comum: nome vem do sime_usuarios real', nameTxt.trim() === 'Maria S.', 'got=' + nameTxt);
  const logoutVisivel = await p.evaluate(() => getComputedStyle(document.getElementById('btn-logout')).display !== 'none');
  check('admin comum: botão de logout aparece', logoutVisivel);

  // 27/08/2026 — pedido direto: "como adicionamos usuários a zona 94?". Um
  // admin comum (não super_admin) nunca deve ver o seletor de zona ao criar
  // membro novo — a Edge Function ignoraria mesmo (usa sempre a zona de quem
  // chama), mas oferecer o campo na tela seria enganoso.
  await p.click('button:has-text("Equipe")');
  await p.waitForTimeout(150);
  await p.click('button:has-text("Novo membro")');
  await p.waitForTimeout(150);
  check('admin comum: seletor de zona NÃO aparece ao criar membro', await p.locator('#m-zona').count() === 0);
  await ctx.close();
}

// ── Caso 2: super_admin de verdade — aba Zonas aparece com dados reais ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ meuUsuario: { nome: 'Rafael Super', perfil: 'super_admin', zona_id: 'zona-7' } }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);

  check('super_admin: zero erros JS', erros.length === 0, erros.join('; '));
  const zonasVisivel = await p.evaluate(() => getComputedStyle(document.getElementById('tab-zonas-btn')).display !== 'none');
  check('super_admin: aba Zonas aparece', zonasVisivel);
  const roleTxt = await p.locator('#u-role').textContent();
  check('super_admin: header mostra "Super Admin"', roleTxt.trim() === 'Super Admin', 'got=' + roleTxt);
  const nameTxt = await p.locator('#u-name').textContent();
  check('super_admin: nome vem do sime_usuarios real', nameTxt.trim() === 'Rafael Super', 'got=' + nameTxt);

  await p.click('#tab-zonas-btn');
  await p.waitForTimeout(200);
  const cards = await p.locator('.zona-card').count();
  check('super_admin: renderiza 2 zonas (7ª e 96ª)', cards === 2, 'cards=' + cards);
  const zona7Txt = await p.locator('.zona-card').nth(0).textContent();
  check('super_admin: zona 7 mostra 3 seções e 2 admins', /3/.test(zona7Txt) && /2/.test(zona7Txt), zona7Txt.replace(/\s+/g, ' '));
  const zona96Txt = await p.locator('.zona-card').nth(1).textContent();
  check('super_admin: zona sem município mostra fallback', zona96Txt.includes('sem município definido'), zona96Txt.replace(/\s+/g, ' '));

  // 27/08/2026 — pedido direto: "como adicionamos usuários a zona 94?". Antes
  // desta mudança, a Edge Function sime-admin-user já aceitava zona_id no
  // corpo pra super_admin escolher outra zona, mas a tela nunca mandava esse
  // campo — todo login novo caía sempre na zona de quem estava logado, sem
  // como um super_admin da 7ª criar o primeiro usuário de uma zona vazia
  // (como a 96ª aqui, sem nenhum admin próprio ainda pra logar e criar os
  // próximos). Agora o seletor aparece só pra super_admin, ao criar.
  await p.click('button:has-text("Equipe")');
  await p.waitForTimeout(150);
  await p.click('button:has-text("Novo membro")');
  await p.waitForTimeout(150);
  const opcoesZona = await p.locator('#m-zona option').allTextContents();
  check('super_admin: seletor de zona lista as 2 zonas', opcoesZona.length === 2 && /7ª Zona/.test(opcoesZona[0]) && /96ª Zona/.test(opcoesZona[1]), JSON.stringify(opcoesZona));
  const zonaDefault = await p.locator('#m-zona').inputValue();
  check('super_admin: zona vem pré-selecionada com a própria (7ª)', zonaDefault === 'zona-7', zonaDefault);

  await p.fill('#m-nome', 'Primeiro Admin 96');
  await p.fill('#m-email', 'admin96@tre-pi.jus.br');
  await p.selectOption('#m-perfil', 'coordenador');
  await p.selectOption('#m-zona', 'zona-96');
  let corpoEnviado = null;
  await p.route('**/functions/v1/sime-admin-user', async (route) => {
    corpoEnviado = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, usuario_id: 'novo-1', auth_user_id: 'auth-novo-1', email: 'admin96@tre-pi.jus.br', senha_temporaria: 'abc1234!', zona_id: 'zona-96' }) });
  });
  await p.click('.modal-footer button:has-text("Salvar")');
  await p.waitForTimeout(300);
  check('super_admin: escolher outra zona manda zona_id certo pra Edge Function', corpoEnviado?.zona_id === 'zona-96', JSON.stringify(corpoEnviado));
  check('super_admin: continua mandando nome/email/perfil normalmente', corpoEnviado?.nome === 'Primeiro Admin 96' && corpoEnviado?.email === 'admin96@tre-pi.jus.br' && corpoEnviado?.perfil === 'coordenador', JSON.stringify(corpoEnviado));

  check('super_admin: zero erros JS depois de criar o usuário', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 3: continuar offline — não quebra mesmo sem sessão nenhuma ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({ meuUsuario: null }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await p.click('#login-offline');
  await p.waitForTimeout(200);
  check('offline: zero erros JS', erros.length === 0, erros.join('; '));
  const zonasVisivel = await p.evaluate(() => getComputedStyle(document.getElementById('tab-zonas-btn')).display !== 'none');
  check('offline: aba Zonas continua escondida', !zonasVisivel);
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
