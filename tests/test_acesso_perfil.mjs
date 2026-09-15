// Testa a restrição de acesso do perfil "Auxiliar de Eleição" (14/09/2026,
// pedido direto: "os auxiliares devem ter acesso somente a parte de gestão
// de problemas, consulta a rotas"). Ver modules/sime_acesso_perfil.js —
// fonte única de verdade de quais páginas cada perfil restrito pode abrir.
//
// Cobre dois ângulos que nenhum outro teste cobre:
//   1. SIME_principal.html: o hub de módulos só mostra Problemas/Rotas pro
//      auxiliar_eleicao (grupos de fase inteiros somem, cabeçalho junto).
//   2. SIME_rotas.html: auxiliar_eleicao continua entrando (não é
//      redirecionado — Rotas é uma das duas páginas permitidas), mas em
//      modo consulta: sem "Nova rota", sem Desativar/Gerar recolhimento,
//      e o modal de uma rota já cadastrada abre com tudo desabilitado e só
//      "Fechar" no rodapé (nunca "Salvar").
//
// O redirecionamento de páginas BLOQUEADAS (SIME_admin.html e as demais)
// já é coberto em tests/test_admin_auxiliar_locais.mjs (bloco 5).
import pw from 'playwright';
const { chromium } = pw;

const BASE = 'http://localhost:8917/modules';
const results = [];
const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// ══════════════════════════════════════════════════════════════════════
// 1. SIME_principal.html — hub filtrado por perfil
// ══════════════════════════════════════════════════════════════════════
{
  const STUB = (perfil) => `
const ZONAS = [{ id:'z-7', numero:7, municipio:'Campo Maior', estado:'PI' }];
const SECOES = [{ zona_id:'z-7', eleitores:300 }];
const ROTAS = [{ zona_id:'z-7' }];
const MEU = { id:'u1', nome:'Fulano', perfil:'${perfil}', zona_id:'z-7' };
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  _rows(){
    if(this.t==='sime_zonas')    return ZONAS;
    if(this.t==='sime_secoes')   return SECOES;
    if(this.t==='sime_rotas')    return ROTAS;
    if(this.t==='sime_usuarios') return this.f.auth_user_id ? [MEU] : [MEU];
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

  async function abrir(perfil) {
    const p = await b.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.route('**/vendor/supabase-js.esm.js', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(perfil) }));
    await p.goto(`${BASE}/SIME_principal.html`, { waitUntil: 'load' });
    await p.fill('#login-email', 'a@b.c');
    await p.fill('#login-pass', 'x');
    await p.click('#login-form button[type=submit]');
    await p.waitForTimeout(500);
    return { p, erros };
  }

  {
    const { p, erros } = await abrir('auxiliar_eleicao');
    const hrefsVisiveis = await p.$$eval('.mod-card[href]', (els) => els.map((e) => e.getAttribute('href')));
    check('auxiliar_eleicao: só Problemas + Rotas aparecem no hub',
      hrefsVisiveis.length === 2 && hrefsVisiveis.includes('SIME_problemas.html') && hrefsVisiveis.includes('SIME_rotas.html'),
      JSON.stringify(hrefsVisiveis));

    const secTitlesVisiveis = await p.$$eval('.sec-title', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent));
    check('auxiliar_eleicao: só o grupo "Ferramentas do cartório" (onde vivem os dois) fica visível',
      secTitlesVisiveis.length === 1 && /Ferramentas do cartório/.test(secTitlesVisiveis[0] || ''),
      JSON.stringify(secTitlesVisiveis));

    check('sem erro JS', erros.length === 0, erros.join('; '));
    await p.close();
  }

  {
    const { p, erros } = await abrir('coordenador');
    const hrefsVisiveis = await p.$$eval('.mod-card[href]', (els) => els.map((e) => e.getAttribute('href')));
    check('coordenador: hub continua completo (sem restrição nenhuma)', hrefsVisiveis.length > 2, JSON.stringify(hrefsVisiveis));
    check('sem erro JS', erros.length === 0, erros.join('; '));
    await p.close();
  }
}

// ══════════════════════════════════════════════════════════════════════
// 2. SIME_rotas.html — modo consulta
// ══════════════════════════════════════════════════════════════════════
{
  const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  delete(){ this._op='delete'; return this; }
  insert(p){
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    if(!window.__mock[this.t]) window.__mock[this.t]=[];
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ...row }));
    window.__mock[this.t].push(...linhas);
    return Promise.resolve({ error:null, data:linhas });
  }
  _casa(x){
    return Object.entries(this.f).every(([k,v]) => {
      if(k.startsWith('__in_')) return v.includes(x[k.slice(5)]);
      return x[k]===v;
    });
  }
  then(res, rej){
    if(this._op==='update'){
      window.__mock.escritas.push({ op:'update', tabela:this.t, payload:this._payload, filtro:{...this.f} });
      const rows=(window.__mock[this.t]||[]);
      const atingidas=[];
      rows.forEach((x,idx)=>{ if(this._casa(x)){ rows[idx]={...x, ...this._payload}; atingidas.push(rows[idx]); } });
      return res({ data: atingidas, error:null });
    }
    if(this._op==='delete'){
      window.__mock.escritas.push({ op:'delete', tabela:this.t, filtro:{...this.f} });
      const rows=(window.__mock[this.t]||[]);
      const restantes = rows.filter(x=>!this._casa(x));
      window.__mock[this.t] = restantes;
      return res({ data:null, error:null });
    }
    const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x));
    return res({ data:r, error:null, count: r.length });
  }
}
export function createClient(){
  const ler = () => { try { return JSON.parse(localStorage.getItem('_mock_session')||'null'); } catch(e){ return null; } };
  return {
    from(t){ return new QB(t); },
    rpc(name){
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-14T15:00:00.000Z', error:null });
      return Promise.resolve({ data:null, error:null });
    },
    auth: {
      async getSession(){ return { data:{ session: ler() } }; },
      async getUser(){ const s=ler(); return { data:{ user: s?{ id:'auth-pedro' }:null } }; },
      async signInWithPassword({ email }){ const session={ user:{ id:'auth-pedro', email } }; localStorage.setItem('_mock_session', JSON.stringify(session)); return { data:{ session }, error:null }; },
    },
  };
}
`;

  function mock() {
    return {
      escritas: [],
      sime_usuarios: [{ id: 'u-pedro', nome: 'Pedro Auxiliar', perfil: 'auxiliar_eleicao', zona_id: 'z7', ativo: true, auth_user_id: 'auth-pedro' }],
      sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
      sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
      sime_logs: [],
      sime_secoes: [
        { id: 's1', numero: 30, local_nome: 'Grupo Escolar A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: 'r1', parada: 1, latitude: -4.83, longitude: -42.16 },
      ],
      sime_rotas: [
        { id: 'r1', zona_id: 'z7', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], tipos: ['distribuicao'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null },
      ],
      sime_rota_secoes: [{ id: 'rs1', rota_id: 'r1', secao_id: 's1', parada: 1 }],
      sime_atores: [],
    };
  }

  async function abrir(m) {
    const p = await b.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e)));
    await p.addInitScript((x) => { window.__mock = x; }, m);
    await p.route('**/vendor/supabase-js.esm.js**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
    await p.goto(`${BASE}/SIME_rotas.html`);
    await p.waitForTimeout(400);
    return { p, erros };
  }
  async function login(p) {
    await p.fill('#login-email', 'x@sime.gov.br');
    await p.fill('#login-pass', 'senha');
    await p.click('#login-form button[type=submit]');
    await p.waitForTimeout(500);
  }

  const { p, erros } = await abrir(mock());
  await login(p);

  check('modo consulta detectado (RT_SOMENTE_LEITURA)', await p.evaluate(() => window.RT_SOMENTE_LEITURA === true));
  check('nota "Modo consulta" aparece no lugar do botão "Nova rota"', /Modo consulta/.test(await p.textContent('body')));
  check('"➕ Nova rota" NÃO aparece', !(await p.locator('button:has-text("➕ Nova rota")').count()));
  check('"🚫 Desativar" NÃO aparece no card', !(await p.locator('button:has-text("🚫 Desativar")').count()));
  check('"🖨️ Imprimir ficha" continua aparecendo (consulta é permitida)', await p.locator('button:has-text("🖨️ Imprimir ficha")').count() === 1);

  await p.click('text=Rota 001');
  await p.waitForTimeout(200);
  check('modal abre (consulta ao detalhe é permitida)', await p.isVisible('#modal-body .m-title'));
  const salvarVisivel = await p.locator('.m-foot button:has-text("Salvar")').count();
  check('"💾 Salvar" NÃO aparece no rodapé do modal', salvarVisivel === 0);
  check('rodapé mostra só "Fechar"', /Fechar/.test(await p.locator('.m-foot').textContent()));
  const inputsDesabilitados = await p.$$eval('#modal-body input, #modal-body select, #modal-body textarea', (els) => els.every((e) => e.disabled));
  check('todo campo do formulário fica desabilitado', inputsDesabilitados);
  check('▲/▼ de reposicionar parada NÃO aparecem', !(await p.locator('#rt-paradas-secao button:has-text("▲")').count()));
  check('"+" de adicionar parada NÃO aparece', !(await p.locator('#rt-paradas-secao button:has-text("+")').count()));

  // Defesa extra: mesmo chamando a função de escrita direto (ex.: console),
  // nada é gravado — a UI escondida não é a única barreira.
  await p.evaluate(() => window.rtSalvarRota());
  await p.waitForTimeout(150);
  const escritasSalvar = await p.evaluate(() => window.__mock.escritas.filter((e) => e.tabela === 'sime_rotas'));
  check('rtSalvarRota() chamada direto não grava nada (defesa em profundidade)', escritasSalvar.length === 0, JSON.stringify(escritasSalvar));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await p.close();
}

await b.close();
const falhas = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_acesso_perfil.mjs`);
process.exit(falhas.length ? 1 : 0);
