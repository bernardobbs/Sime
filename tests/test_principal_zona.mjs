// Testa o escopo por zona em SIME_principal.html (portal).
//
// Antes o portal não tinha login nenhum e trazia as zonas fixas no HTML (7ª e
// 94ª, com números fixos), visíveis para qualquer um com a URL. Agora exige
// sessão, lista o que a RLS deixa ver e a aba Zonas é só do super_admin.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

const STUB = (meu) => `
const ZONAS = [
  { id:'z-7',  numero:7,  municipio:'Campo Maior', estado:'PI' },
  { id:'z-94', numero:94, municipio:'Oeiras',      estado:'PI' },
];
const SECOES = [
  { zona_id:'z-7', eleitores:300 }, { zona_id:'z-7', eleitores:250 },
];
const ROTAS = [{ zona_id:'z-7' }];
const USUARIOS = [
  { id:'u1', nome:'Maria Gomes',  perfil:'coordenador', zona_id:'z-7'  },
  { id:'u2', nome:'João Silva',   perfil:'gestor_prob', zona_id:'z-7'  },
  { id:'u3', nome:'Ana da 94',    perfil:'coordenador', zona_id:'z-94' },
  // Token de TV: criado pela sime-login, não é gente da equipe.
  { id:'u4', nome:'Token tv (ABC123)', perfil:'observador', zona_id:'z-7' },
];
const MEU = ${JSON.stringify(meu)};

class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  _visivel(rows, key){
    if(MEU.perfil==='super_admin') return rows;
    return rows.filter(r => r[key]===MEU.zona_id);
  }
  _rows(){
    if(this.t==='sime_zonas')    return this._visivel(ZONAS,'id');
    if(this.t==='sime_secoes')   return this._visivel(SECOES,'zona_id');
    if(this.t==='sime_rotas')    return this._visivel(ROTAS,'zona_id');
    if(this.t==='sime_usuarios') return this.f.auth_user_id ? [MEU] : this._visivel(USUARIOS,'zona_id');
    return [];
  }
  then(resolve){ return resolve({ data:this._rows(), error:null }); }
  maybeSingle(){ return Promise.resolve({ data:this._rows()[0] ?? null, error:null }); }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    auth: {
      async signInWithPassword(){ return { error:null }; },
      async getSession(){ return { data:{ session:null } }; },
      async getUser(){ return { data:{ user:{ id:'auth-1' } } }; },
    },
  };
}
`;

async function abrir(meu) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(meu) }));
  await p.goto(`${BASE}/SIME_principal.html`, { waitUntil: 'load' });
  return { p, erros };
}

// ── Sem login: nada de zonas ──
{
  const { p } = await abrir({ perfil: 'coordenador', zona_id: 'z-7' });
  await p.waitForTimeout(400);
  const overlayVisivel = await p.isVisible('#login-overlay');
  check('portal pede login ao abrir', overlayVisivel);
  const cards = await p.$$eval('#zonas-grid .zona-card', els => els.length);
  check('nenhuma zona listada antes do login', cards === 0, String(cards));
  await p.close();
}

// ── Admin de zona: sem aba Zonas ──
{
  const { p, erros } = await abrir({ perfil: 'coordenador', zona_id: 'z-7' });
  await p.fill('#login-email', 'a@b.c');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  await p.waitForTimeout(300);
  const abaVisivel = await p.isVisible('#tab-zonas-btn');
  check('admin de zona: aba Zonas escondida', !abaVisivel);
  const nums = await p.$$eval('#zonas-grid .zona-num', els => els.map(e => e.textContent.trim()));
  check('admin de zona: só a própria zona é listada', nums.length === 1 && nums[0] === '7ª', nums.join(','));
  check('admin de zona: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── super_admin: aba Zonas e todas as zonas, com números reais ──
{
  const { p, erros } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });
  await p.fill('#login-email', 'a@b.c');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  await p.waitForTimeout(300);
  check('super_admin: aba Zonas visível', await p.isVisible('#tab-zonas-btn'));
  const nums = await p.$$eval('#zonas-grid .zona-num', els => els.map(e => e.textContent.trim()));
  check('super_admin: enxerga as duas zonas', nums.length === 2, nums.join(','));

  // Números vindos do banco, não os fixos que estavam no HTML (174/12/34.967).
  const texto = await p.textContent('#zonas-grid');
  check('estatísticas vêm do banco, não do HTML fixo', !texto.includes('34.967') && !texto.includes('174'), '');
  const primeiro = await p.$eval('#zonas-grid .zona-card', el => el.textContent);
  check('7ª zona soma as seções reais', /2\s*Seções/.test(primeiro.replace(/\s+/g, ' ')), '');
  check('7ª zona soma os eleitores reais', primeiro.includes('550'), '');
  check('94ª zona aparece como sem seções', texto.includes('Sem seções'));
  check('super_admin: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ══════════════════════════════════════════════════
// ABA USUÁRIOS — era ficção, agora é a equipe da zona
// ══════════════════════════════════════════════════
// A aba listava SETE pessoas escritas no HTML ('Maria S.', 'João P.', …), com
// um filtro de zona também fixo, e o botão "+ Novo usuário" abria um modal que
// terminava em showToast('✓ Criado') sem criar nada. Alguém podia cadastrar a
// equipe ali, ver o ✓, e descobrir no dia 4 que ninguém consegue entrar.

async function entrar(p) {
  await p.fill('#login-email', 'admin@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);
}

// ── Admin de zona vê só a própria equipe ──
{
  const { p, erros } = await abrir({ perfil: 'coordenador', zona_id: 'z-7' });
  await entrar(p);
  const txt = await p.textContent('#user-tbody');

  check('usuários: mostra quem é da zona', txt.includes('Maria Gomes') && txt.includes('João Silva'), txt.slice(0, 160));
  check('usuários: NÃO mostra a equipe da outra zona', !txt.includes('Ana da 94'), txt.slice(0, 160));
  check('usuários: NÃO lista token de TV como pessoa', !txt.includes('Token tv'), txt.slice(0, 160));
  check('usuários: sumiram os nomes inventados', !txt.includes('Maria S.') && !txt.includes('Rafael A.'), txt.slice(0, 160));

  const escopo = await p.textContent('#usuarios-escopo');
  check('usuários: diz de quantas pessoas e de que zona', escopo.includes('2 pessoas') && escopo.includes('7ª'), escopo);

  check('usuários: não há mais filtro de zona escrito no HTML',
    await p.$('#zona-filter') === null);
  check('usuários: criar acesso aponta para o Admin, onde de fato acontece',
    (await p.getAttribute('a.btn[href="SIME_admin.html"]', 'href')) === 'SIME_admin.html');
  check('usuários: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Super admin vê as duas zonas ──
{
  const { p, erros } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });
  await entrar(p);
  const txt = await p.textContent('#user-tbody');
  check('super_admin: vê a equipe das duas zonas',
    txt.includes('Maria Gomes') && txt.includes('Ana da 94'), txt.slice(0, 160));
  check('super_admin: mostra a zona de cada pessoa', txt.includes('7ª') && txt.includes('94ª'), txt.slice(0, 200));
  check('super_admin: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Nenhum botão pode mais dizer "✓" para algo que não gravou ──
{
  const { p } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });
  // Procura a CHAMADA, não o texto solto: os comentários do arquivo citam as
  // mensagens antigas de propósito, para explicar por que saíram.
  const html = await p.content();
  for (const mentira of ['✓ Criado', '✓ Zona criada', '✓ Turno arquivado', '✓ Calendário importado']) {
    const chamada = new RegExp(`showToast\\(["'\u0027]${mentira.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`);
    check(`nenhum botão promete "${mentira}" sem gravar nada`, !chamada.test(html), 
      (html.match(chamada) || [''])[0]);
  }
  await p.close();
}

// ── Modais fantasma avisam ANTES do preenchimento, e a "drop zone" não finge ser clicável ──
{
  const { p, erros } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });
  await p.evaluate(() => window.openModal('nova-zona'));
  await p.waitForTimeout(150);
  const avisoNovaZona = await p.locator('.aviso-nao-impl').textContent();
  check('modal "Nova zona" avisa antes de preencher que nada é salvo', avisoNovaZona.includes('não'), avisoNovaZona);

  await p.evaluate(() => window.closeModal());
  await p.evaluate(() => window.openModal('config-zona', '7'));
  await p.waitForTimeout(150);
  check('modal "Configurar zona" também avisa antes de preencher', (await p.locator('.aviso-nao-impl').count()) === 1);
  const dropzoneCursor = await p.locator('.dropzone-desativada').evaluate((el) => getComputedStyle(el).cursor);
  check('"drop zone" sem handler não finge mais ser clicável (cursor não é pointer)', dropzoneCursor !== 'pointer', dropzoneCursor);

  await p.evaluate(() => window.closeModal());
  await p.evaluate(() => window.openModal('importar-cal'));
  await p.waitForTimeout(150);
  check('modal "Importar calendário" avisa que não está implementado', (await p.locator('.aviso-nao-impl').count()) === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Achados "baixo": overlay como dialog acessível, Esc fecha, toast com aria-live, login com label ──
{
  const { p, erros } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });

  check('overlay do modal tem role=dialog', await p.getAttribute('#overlay', 'role') === 'dialog');
  check('overlay do modal tem aria-modal=true', await p.getAttribute('#overlay', 'aria-modal') === 'true');
  check('toast tem aria-live (leitor de tela anuncia sozinho)', await p.getAttribute('#toast', 'aria-live') === 'polite');
  check('login tem labels associadas (não só placeholder)',
    await p.locator('label[for="login-email"]').count() === 1 && await p.locator('label[for="login-pass"]').count() === 1);

  await p.evaluate(() => window.openModal('nova-zona'));
  await p.waitForTimeout(150);
  check('modal abre (overlay ganha .show)', await p.evaluate(() => document.getElementById('overlay').classList.contains('show')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('Esc fecha o modal (achado "baixo": só fechava clicando fora)', await p.evaluate(() => !document.getElementById('overlay').classList.contains('show')));

  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
