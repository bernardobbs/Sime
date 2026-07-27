// Testa a URL por zona nos QR Codes: /z/<numero>/<modulo>?token=...
//
// A reescrita fica no vercel.json (/z/:zona/:caminho* -> /modules/:caminho*).
// É reescrita e não redirect de propósito: mantendo /z/<numero>/ no endereço,
// os caminhos relativos do módulo (./sime_config.js, ./vendor/...) resolvem
// para /z/<numero>/... e caem na mesma regra. Um redirect também funcionaria
// para o HTML, mas trocaria o endereço e tiraria a zona de vista.
import { readFileSync } from 'node:fs';
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

// ── vercel.json ──
{
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rw = (cfg.rewrites || []).find(r => r.source.startsWith('/z/'));
  check('vercel.json tem a reescrita por zona', !!rw, JSON.stringify(cfg.rewrites));
  check('reescrita captura o caminho inteiro (assets inclusive)', rw?.source === '/z/:zona/:caminho*', rw?.source);
  check('reescrita aponta para /modules', rw?.destination === '/modules/:caminho*', rw?.destination);
  // Redirect da raiz continua existindo — não pode ter sido substituído.
  check('redirect da raiz preservado', (cfg.redirects || []).some(r => r.source === '/'), '');
}

// ── URL gerada no cartão ──
const b = await chromium.launch();

const STUB = (perfil, zonaId) => `
const ZONAS = [
  { id:'z-7',  numero:7,  municipio:'Campo Maior' },
  { id:'z-96', numero:96, municipio:'Teresina' },
];
const ELEICOES = [{ id:'el-7', turno:1, zona_id:'z-7', ativa:true, created_at:'2026-01-01' }];
const MEU = { perfil:'${perfil}', zona_id:'${zonaId}' };
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; } eq(c,v){ this.f[c]=v; return this; } order(){ return this; }
  limit(){ return this; } not(){ return this; }
  insert(){ return Promise.resolve({ data:null, error:null }); }
  delete(){ return this; }
  _rows(){
    if(this.t==='sime_zonas') return MEU.perfil==='super_admin' ? ZONAS : ZONAS.filter(z=>z.id===MEU.zona_id);
    if(this.t==='sime_eleicoes') return ELEICOES;
    if(this.t==='sime_usuarios') return [MEU];
    if(this.t==='sime_secoes') return [{ numero:63, local_nome:'G.E. Treze', zona_id:'z-7' }];
    if(this.t==='sime_rotas') return [{ codigo:'004', zona_id:'z-7' }];
    return [];
  }
  then(r){ return r({ data:this._rows(), error:null }); }
  maybeSingle(){ return Promise.resolve({ data:this._rows()[0] ?? null, error:null }); }
}
export function createClient(){
  return { from(t){ return new QB(t); }, auth:{
    async signInWithPassword(){ return { error:null }; },
    async getSession(){ return { data:{ session:null } }; },
    async getUser(){ return { data:{ user:{ id:'auth-1' } } }; },
  }};
}
`;

async function gerarCartao({ logado }) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB('coordenador', 'z-7') }));
  await p.goto(`${BASE}/SIME_tokens.html`, { waitUntil: 'load' });
  if (logado) {
    await p.fill('#login-email', 'a@b.c');
    await p.fill('#login-pass', 'x');
    await p.click('#login-form button[type=submit]');
    await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  } else {
    await p.click('#login-offline');
  }
  await p.waitForTimeout(300);
  await p.fill('#f-nome', 'Teste');
  await p.selectOption('#f-tipo', 'conferente');
  await p.click('#rotas-check label');
  await p.click('button[onclick="criarToken()"]');
  await p.waitForTimeout(400);
  const url = (await p.textContent('.tc-url')).trim().split(/\s+/)[0];
  await p.close();
  return { url, erros };
}

// Logado: a URL carrega a zona.
{
  const { url, erros } = await gerarCartao({ logado: true });
  check('URL do QR usa /z/<numero>/', /\/z\/7\/SIME_conferente\.html\?token=/.test(url), url);
  check('URL é absoluta (o QR é lido fora do site)', url.startsWith('http'), url);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
}

// Offline (sem zona resolvida): mantém a URL relativa de antes, para nunca
// imprimir um cartão com uma zona chutada.
{
  const { url } = await gerarCartao({ logado: false });
  check('sem zona resolvida, volta para a URL relativa', url.includes('/modules/SIME_conferente.html?token=') && !url.includes('/z/'), url);
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
