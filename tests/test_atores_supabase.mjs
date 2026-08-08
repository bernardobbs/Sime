// Testa a leitura de atores do Supabase em SIME_atores.html e na aba Atores do
// SIME_admin.html.
//
// Os dois liam só o localStorage: a 7ª Zona tem centenas de pessoas em
// sime_atores (465 mesários, entre outros) e a tela abria vazia em qualquer
// máquina que não fosse aquela onde o CSV foi importado.
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });

const b = await chromium.launch();

// A RLS de sime_atores é sime_zona_visivel(zona_id) — o stub devolve só os da
// zona do usuário, como o banco faz.
const STUB = ({ comSessao = true } = {}) => `
const SECOES = [
  { id:'sec-16',  numero:16,  local_nome:'Clube dos Cocais', municipio:'Campo Maior', zona_id:'z-7' },
  { id:'sec-123', numero:123, local_nome:'Grupo Escolar',    municipio:'Campo Maior', zona_id:'z-7' },
];
const ATORES = [
  { id:'a1', nome_completo:'GABRIELA QUEIROZ MENDES', telefone_whatsapp:'5586981080059',
    funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'sec-16',  confirmacao:'pendente', ativo:true },
  { id:'a2', nome_completo:'KECYA DANDELLA ROCHA PAZ', telefone_whatsapp:'5586994433769',
    funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'sec-123', confirmacao:'recusou',  ativo:false },
  { id:'a3', nome_completo:'JOSE DA JUNTA', telefone_whatsapp:'5586991110000',
    funcao:'junta_eleitoral', funcao_mesa:null, secao_id:null, confirmacao:'pendente', ativo:true },
];
// Pra testar o caminho de escrita (editar/criar/remover ator via Supabase):
// zonaDoUsuario() lê sime_usuarios, getEleicaoAtivaDaZona() lê sime_eleicoes.
const USUARIOS = [{ auth_user_id:'u1', zona_id:'z-7' }];
const ELEICOES = [{ id:'el-7', zona_id:'z-7', ativa:true, turno:1 }];
window.__ops = [];
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; } limit(){ return this; }
  update(p){ this._op='update'; this._payload=p; return this; }
  insert(p){ this._op='insert'; this._payload=p; return this; }
  _rows(){
    // sime_atores/sime_secoes: sem filtro, igual ao stub original (RLS já
    // simulada pelo conjunto fixo). sime_usuarios/sime_eleicoes: filtra de
    // verdade, só usados pelo caminho de escrita (criar ator novo).
    if(this.t==='sime_atores') return ATORES;
    if(this.t==='sime_secoes') return SECOES;
    if(this.t==='sime_usuarios') return USUARIOS.filter(u => this.f.auth_user_id===undefined || u.auth_user_id===this.f.auth_user_id);
    if(this.t==='sime_eleicoes') return ELEICOES.filter(e => (this.f.zona_id===undefined || e.zona_id===this.f.zona_id) && (this.f.ativa===undefined || e.ativa===this.f.ativa));
    return [];
  }
  then(r){
    if(this._op==='update'){
      window.__ops.push({ op:'update', t:this.t, payload:this._payload, filter:this.f });
      if(this.t==='sime_atores'){
        const row = ATORES.find(a=>a.id===this.f.id);
        if(row) Object.assign(row, this._payload);
      }
      return r({ error:null });
    }
    if(this._op==='insert'){
      const novoId = 'novo-' + Math.random().toString(36).slice(2, 8);
      window.__ops.push({ op:'insert', t:this.t, payload:this._payload, id:novoId });
      if(this.t==='sime_atores') ATORES.push({ id:novoId, ...this._payload });
      return r({ data:[{ id:novoId }], error:null });
    }
    return r({ data:this._rows(), error:null });
  }
  maybeSingle(){ return Promise.resolve({ data:this._rows()[0] ?? null, error:null }); }
  // .insert(...).select('id').single() — pega o id gerado pro upsert local em ATORES_REAIS.
  single(){
    if(this._op==='insert'){
      const novoId = 'novo-' + Math.random().toString(36).slice(2, 8);
      window.__ops.push({ op:'insert', t:this.t, payload:this._payload, id:novoId });
      if(this.t==='sime_atores') ATORES.push({ id:novoId, ...this._payload });
      return Promise.resolve({ data:{ id:novoId }, error:null });
    }
    return Promise.resolve({ data:this._rows()[0] ?? null, error:null });
  }
}
export function createClient(){
  return { from(t){ return new QB(t); }, auth:{
    async getSession(){ return { data:{ session: ${comSessao ? "{ user:{ id:'u1' } }" : 'null'} } }; },
    async getUser(){ return { data:{ user:{ id:'u1' } } }; },
    async signInWithPassword(){ return { error:null }; },
  },
  channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
  removeChannel(){},
  };
}
`;

async function abrir(arquivo, opts = {}) {
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(opts) }));
  await p.goto(`${BASE}/${arquivo}`, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { p, erros };
}

// ── SIME_atores.html com sessão ──
{
  const { p, erros } = await abrir('SIME_atores.html');
  const texto = await p.textContent('#content');
  check('atores: lista o mesário vindo do banco', texto.includes('GABRIELA QUEIROZ MENDES'), '');
  check('atores: mostra a junta eleitoral (função nova)', texto.includes('JOSE DA JUNTA'), '');
  check('atores: rótulo da junta aparece', texto.includes('Junta Eleitoral'), '');

  // Telefone do banco vem com o 55 do país — não pode duplicar no link.
  const href = await p.getAttribute('a.ac-btn', 'href');
  check('atores: link do WhatsApp sem 55 duplicado', href === 'https://wa.me/5586981080059', href);

  const sub = await p.textContent('#h-sub');
  check('atores: contador reflete o banco', /3 atores/.test(sub), sub.trim());
  check('atores: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── SIME_atores.html: editar/criar/remover grava no banco (não só localStorage) ──
{
  const { p, erros } = await abrir('SIME_atores.html');

  // Editar: telefone desatualizado → deve chamar update em sime_atores, não só localStorage.
  await p.evaluate(() => window.abrirModal('a1'));
  await p.fill('#m-tel', '86988887777');
  await p.evaluate(() => window.salvarAtor('a1'));
  await p.waitForFunction(() => window.__ops.some(o => o.op === 'update' && o.t === 'sime_atores'));
  let ops = await p.evaluate(() => window.__ops);
  const upd = ops.find(o => o.op === 'update' && o.t === 'sime_atores');
  check('editar ator: grava update em sime_atores (não só localStorage)', !!upd, JSON.stringify(ops));
  check('editar ator: telefone vai só com dígitos', upd?.payload?.telefone_whatsapp === '86988887777', JSON.stringify(upd));
  check('editar ator: identifica a pessoa certa pelo id', upd?.filter?.id === 'a1', JSON.stringify(upd));
  const textoApos = await p.textContent('#content');
  check('editar ator: tela recarrega refletindo o novo telefone', textoApos.includes('88887777') || textoApos.includes('8888-7777'), textoApos.slice(0, 200));

  // Criar: ator novo → insert em sime_atores, resolvendo zona/eleição da sessão.
  await p.evaluate(() => window.abrirModal(null));
  await p.fill('#m-nome', 'NOVO ATOR TESTE');
  await p.fill('#m-tel', '86999998888');
  await p.selectOption('#m-func', 'tecnico');
  await p.evaluate(() => window.salvarAtor(''));
  await p.waitForFunction(() => window.__ops.some(o => o.op === 'insert' && o.t === 'sime_atores'));
  ops = await p.evaluate(() => window.__ops);
  const ins = ops.find(o => o.op === 'insert' && o.t === 'sime_atores');
  check('criar ator: grava insert em sime_atores', !!ins, JSON.stringify(ops));
  check('criar ator: resolve zona_id da sessão', ins?.payload?.zona_id === 'z-7', JSON.stringify(ins));
  check('criar ator: resolve eleicao_id ativa da zona', ins?.payload?.eleicao_id === 'el-7', JSON.stringify(ins));

  // Remover: soft-delete (ativo=false) via update, não remoção do array local.
  ops.length = 0;
  await p.evaluate(() => { window.__ops.length = 0; });
  p.once('dialog', d => d.accept());
  await p.evaluate(() => window.removerAtor('a1'));
  await p.waitForFunction(() => window.__ops.some(o => o.op === 'update' && o.payload?.ativo === false));
  const opsRem = await p.evaluate(() => window.__ops);
  check('remover ator: grava ativo=false em sime_atores (soft delete)', opsRem.some(o => o.op === 'update' && o.t === 'sime_atores' && o.payload?.ativo === false && o.filter?.id === 'a1'), JSON.stringify(opsRem));

  check('editar/criar/remover: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── SIME_atores.html sem sessão: segue no localStorage, sem quebrar ──
{
  const { p, erros } = await abrir('SIME_atores.html', { comSessao: false });
  const texto = await p.textContent('#content');
  check('atores sem sessão: não mostra dado do banco', !texto.includes('GABRIELA'), '');
  check('atores sem sessão: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

// ── Aba Atores do Admin ──
{
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB() }));
  await p.goto(`${BASE}/SIME_admin.html`, { waitUntil: 'load' });
  // Com sessão o Admin esconde o overlay sozinho — não há botão "offline" pra clicar.
  await p.waitForFunction(() => document.getElementById('login-overlay').style.display === 'none', { timeout: 15000 });
  await p.click('button[onclick="goTab(\'atores\',this)"]');
  await p.waitForTimeout(600);

  const tbody = await p.textContent('#atores-tbody');
  check('admin: aba Atores lista o mesário do banco', tbody.includes('GABRIELA QUEIROZ MENDES'), '');
  check('admin: mostra a função na mesa', tbody.includes('1º Mesário'), '');
  check('admin: seção resolvida pelo secao_id', /Seção 16/.test(tbody), '');
  check('admin: ator sem seção não quebra a linha', tbody.includes('JOSE DA JUNTA'), '');
  check('admin: inativo (recusou) fica fora da lista', !tbody.includes('KECYA'), '');

  // Filtro por função, incluindo a que faltava.
  await p.selectOption('#atores-funcao', 'junta_eleitoral');
  await p.waitForTimeout(200);
  const filtrado = await p.textContent('#atores-tbody');
  check('admin: filtro junta_eleitoral existe e funciona', filtrado.includes('JOSE DA JUNTA') && !filtrado.includes('GABRIELA'), '');

  // Busca por telefone digitado sem o 55.
  await p.selectOption('#atores-funcao', '');
  await p.fill('#atores-search', '86981080059');
  await p.waitForTimeout(200);
  const busca = await p.textContent('#atores-tbody');
  check('admin: busca por telefone sem o 55 encontra', busca.includes('GABRIELA'), '');
  check('admin: sem erro JS', erros.length === 0, erros.join(' | '));
  await p.close();
}

await b.close();

const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
