// Testa a persistência da configuração da eleição em sime_eleicoes.
//
// Antes as datas viviam só no localStorage de quem configurou: trocar de
// máquina perdia tudo, e a expiração dos tokens — que sai daí — ia junto.
// Agora o banco é a fonte e o localStorage segue como cópia offline.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

const STUB = ({ zonaId, eleicoes }) => `
const MEU = { perfil:'coordenador', zona_id:${JSON.stringify(zonaId)} };
const ELEICOES = ${JSON.stringify(eleicoes)};
window.__upserts = [];

class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  upsert(linhas, opts){
    window.__upserts.push({ table:this.t, linhas, opts });
    return Promise.resolve({ data:null, error:null });
  }
  _rows(){
    if(this.t==='sime_usuarios') return [MEU];
    if(this.t==='sime_zonas')    return [{ id:'z-7', numero:7, municipio:'Campo Maior', estado:'PI' }];
    if(this.t==='sime_eleicoes') return ELEICOES.filter(e=>!this.f.zona_id || e.zona_id===this.f.zona_id);
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

async function abrir(cfg) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(cfg) }));
  await p.goto(`${BASE}/SIME_principal.html`, { waitUntil: 'load' });
  return { p, erros };
}

async function logar(p) {
  await p.fill('#login-email', 'a@b.c');
  await p.fill('#login-pass', 'x');
  await p.click('#login-form button[type=submit]');
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  await p.waitForTimeout(400);
}

// ── Carrega do banco e sobrepõe o padrão de outubro ──
{
  const { p, erros } = await abrir({ zonaId: 'z-7', eleicoes: [
    { zona_id:'z-7', turno:1, data_dx_ini:'2026-09-20', data_d1:'2026-10-03', data_d:'2026-10-04', horario_ab:'08:00:00', horario_enc:'17:00:00', ativa:true },
  ]});
  await logar(p);
  const r = await p.evaluate(() => ({
    dx: document.getElementById('t1-dx').value,
    d1: document.getElementById('t1-d1').value,
    d:  document.getElementById('t1-d').value,
    ab: document.getElementById('t1-ab').value,
  }));
  check('carga e lacre vem do banco', r.dx === '2026-09-20', r.dx);
  check('véspera vem do banco', r.d1 === '2026-10-03', r.d1);
  check('Dia D vem do banco', r.d === '2026-10-04', r.d);
  check('horário com segundos vira HH:MM no input', r.ab === '08:00', r.ab);

  // O que veio do banco tem que ficar no localStorage também (uso offline).
  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_eleicao_v1') || '{}'));
  check('banco é espelhado no localStorage', local?.turno1?.dx === '2026-09-20', JSON.stringify(local?.turno1?.dx));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Salvar grava no banco com upsert por (zona, turno) ──
{
  const { p, erros } = await abrir({ zonaId: 'z-7', eleicoes: [] });
  await logar(p);
  await p.fill('#t1-dx', '2026-09-25');
  await p.click('button[onclick="saveEleicao()"]');
  await p.waitForTimeout(500);

  const ups = await p.evaluate(() => window.__upserts);
  const chamada = ups.find(u => u.table === 'sime_eleicoes');
  check('salvar faz upsert em sime_eleicoes', !!chamada);
  check('upsert usa a chave (zona_id, turno)', chamada?.opts?.onConflict === 'zona_id,turno', JSON.stringify(chamada?.opts));

  const l1 = chamada?.linhas?.find(l => l.turno === 1);
  check('grava a zona do usuário', l1?.zona_id === 'z-7', l1?.zona_id);
  check('grava a carga e lacre digitada', l1?.data_dx_ini === '2026-09-25', l1?.data_dx_ini);
  check('grava a véspera derivada', l1?.data_d1 === '2026-10-03', l1?.data_d1);
  check('marca o turno ativo', l1?.ativa === true, String(l1?.ativa));

  // 2º turno tem Dia D padrão (último domingo), então também é gravado.
  const l2 = chamada?.linhas?.find(l => l.turno === 2);
  check('2º turno gravado com o padrão de outubro', l2?.data_d === '2026-10-25', l2?.data_d);
  check('2º turno não é o ativo', l2?.ativa === false, String(l2?.ativa));

  const toast = await p.textContent('#toast');
  check('avisa que salvou no cartório', /cartório/.test(toast), toast.trim());
  check('sem erro JS ao salvar', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Sem zona resolvida: salva local e diz isso, sem quebrar ──
{
  const { p, erros } = await abrir({ zonaId: null, eleicoes: [] });
  await logar(p);
  await p.click('button[onclick="saveEleicao()"]');
  await p.waitForTimeout(400);
  const ups = await p.evaluate(() => window.__upserts.filter(u => u.table === 'sime_eleicoes'));
  check('sem zona: não tenta gravar no banco', ups.length === 0, String(ups.length));
  const local = await p.evaluate(() => JSON.parse(localStorage.getItem('sime_eleicao_v1') || '{}'));
  check('sem zona: ainda salva no localStorage', !!local?.turno1?.d, JSON.stringify(local?.turno1?.d));
  check('sem zona: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
