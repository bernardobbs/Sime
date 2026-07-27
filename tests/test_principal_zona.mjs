// Testa o escopo por zona em SIME_principal.html (portal).
//
// Antes o portal não tinha login nenhum e trazia as zonas fixas no HTML (7ª e
// 96ª, com números fixos), visíveis para qualquer um com a URL. Agora exige
// sessão, lista o que a RLS deixa ver e a aba Zonas é só do super_admin.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

const STUB = (meu) => `
const ZONAS = [
  { id:'z-7',  numero:7,  municipio:'Campo Maior', uf:'PI' },
  { id:'z-96', numero:96, municipio:null,          uf:null },
];
const SECOES = [
  { zona_id:'z-7', eleitores:300 }, { zona_id:'z-7', eleitores:250 },
];
const ROTAS = [{ zona_id:'z-7' }];
const USUARIOS = [{ zona_id:'z-7' }, { zona_id:'z-96' }];
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
  check('96ª zona aparece como sem seções', texto.includes('Sem seções'));
  check('super_admin: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
