// Testa o escopo por zona em SIME_tokens.html.
//
// Antes a zona era um <select> fixo (7 ou 96) que só virava rótulo no cartão:
// o token era sempre gravado na eleição resolvida pela RLS, então um admin
// podia escolher "96ª Zona" e emitir um cartão que na verdade autentica na
// zona 7. Agora a zona vem da sessão, e o seletor só é editável para
// super_admin — que enxerga todas as zonas e precisa dizer em qual está
// trabalhando, senão getEleicaoAtiva pegaria a eleição ativa mais recente de
// qualquer zona.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

const STUB = (meuUsuario) => `
const ZONAS = [
  { id: 'z-7',  numero: 7,  municipio: 'Campo Maior' },
  { id: 'z-96', numero: 96, municipio: 'Teresina' },
];
const ELEICOES = [
  { id: 'el-7',  turno: 1, zona_id: 'z-7',  ativa: true, created_at: '2026-01-01' },
  { id: 'el-96', turno: 1, zona_id: 'z-96', ativa: true, created_at: '2026-06-01' },
];
const SECOES = [
  { numero: 63, local_nome: 'G.E. Treze de Março', zona_id: 'z-7' },
  { numero: 900, local_nome: 'Col. 96', zona_id: 'z-96' },
];
const ROTAS = [{ codigo: '004', zona_id: 'z-7' }];
const MEU = ${JSON.stringify(meuUsuario)};

window.__calls = { insert: [], eleicaoQueries: [] };

class QB {
  constructor(t){ this.t=t; this.f={}; this._op='select'; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  not(){ return this; }
  insert(payload){ window.__calls.insert.push({ table:this.t, payload }); return Promise.resolve({ data:null, error:null }); }
  delete(){ this._op='delete'; return this; }
  _rows(){
    if(this.t==='sime_zonas'){
      // Simula a RLS: admin de zona só enxerga a dele; super_admin vê todas.
      return MEU.perfil==='super_admin' ? ZONAS : ZONAS.filter(z=>z.id===MEU.zona_id);
    }
    if(this.t==='sime_eleicoes'){
      window.__calls.eleicaoQueries.push({ ...this.f });
      let rows = ELEICOES.filter(e=>e.ativa);
      if(MEU.perfil!=='super_admin') rows = rows.filter(e=>e.zona_id===MEU.zona_id);
      if(this.f.zona_id) rows = rows.filter(e=>e.zona_id===this.f.zona_id);
      // mais recente primeiro, como o order('created_at', desc) real
      return [...rows].sort((a,b)=>b.created_at.localeCompare(a.created_at));
    }
    if(this.t==='sime_secoes') return SECOES;
    if(this.t==='sime_rotas') return ROTAS;
    if(this.t==='sime_usuarios') return [MEU];
    if(this.t==='sime_tokens') return [];
    return [];
  }
  then(resolve){
    if(this._op==='delete') return resolve({ data:null, error:null });
    return resolve({ data:this._rows(), error:null });
  }
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

async function abrir(meuUsuario) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(meuUsuario) }));
  await p.goto(`${BASE}/SIME_tokens.html`, { waitUntil: 'load' });
  await p.fill('#login-email', 'a@b.c');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  await p.waitForTimeout(300);
  return { p, erros };
}

// ── Admin da 7ª zona: seletor travado na zona dele ──
{
  const { p, erros } = await abrir({ perfil: 'coordenador', zona_id: 'z-7' });
  const r = await p.evaluate(() => ({
    valor: document.getElementById('f-zona').value,
    travado: document.getElementById('f-zona').disabled,
    opcoes: [...document.querySelectorAll('#f-zona option')].map(o => o.textContent.trim()),
  }));
  check('admin de zona: seletor travado', r.travado === true);
  check('admin de zona: só enxerga a própria zona', r.opcoes.length === 1, r.opcoes.join(' | '));
  check('admin de zona: zona selecionada é a dele', r.valor === 'z-7', r.valor);
  check('admin de zona: sem erro JS', erros.length === 0, erros.join(' | '));

  // O cartão gerado leva o NÚMERO da zona, não o UUID do seletor.
  await p.fill('#f-nome', 'Fulano');
  await p.selectOption('#f-tipo', 'conferente');
  await p.click('#rotas-check label');
  await p.click('button[onclick="criarToken()"]');
  await p.waitForTimeout(300);
  const meta = await p.textContent('.tc-meta');
  check('cartão mostra o número da zona (não o UUID)', /Zona 7\b/.test(meta), meta.trim());

  const ins = await p.evaluate(() => window.__calls.insert.filter(c => c.table === 'sime_tokens'));
  check('token gravado na eleição da zona do admin', ins[0]?.payload?.eleicao_id === 'el-7', JSON.stringify(ins[0]?.payload?.eleicao_id));
  await p.close();
}

// ── super_admin: escolhe a zona, e a escolha manda na eleição ──
{
  const { p, erros } = await abrir({ perfil: 'super_admin', zona_id: 'z-7' });
  const r = await p.evaluate(() => ({
    travado: document.getElementById('f-zona').disabled,
    opcoes: [...document.querySelectorAll('#f-zona option')].map(o => o.value),
    valor: document.getElementById('f-zona').value,
  }));
  check('super_admin: seletor habilitado', r.travado === false);
  check('super_admin: enxerga as duas zonas', r.opcoes.length === 2, r.opcoes.join(','));
  check('super_admin: começa na própria zona', r.valor === 'z-7', r.valor);

  // Sem filtro por zona, a eleição ativa mais recente seria a da 96 (created_at
  // 2026-06) — este é o caso que silenciosamente gravava na zona errada.
  const ins0 = await p.evaluate(() => {
    window.__calls.insert.length = 0;
    return true;
  });
  await p.selectOption('#f-zona', 'z-96');
  await p.waitForTimeout(400);
  await p.fill('#f-nome', 'Beltrano');
  await p.selectOption('#f-tipo', 'conferente');
  const temRota = await p.$('#rotas-check label');
  if (temRota) await p.click('#rotas-check label');
  await p.click('button[onclick="criarToken()"]');
  await p.waitForTimeout(300);
  const ins = await p.evaluate(() => window.__calls.insert.filter(c => c.table === 'sime_tokens'));
  check('super_admin: token vai para a eleição da zona escolhida', ins[0]?.payload?.eleicao_id === 'el-96', String(ins[0]?.payload?.eleicao_id));

  const meta = await p.textContent('.tc-meta');
  check('super_admin: cartão rotula a zona escolhida', /Zona 96\b/.test(meta), meta.trim());
  check('super_admin: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
