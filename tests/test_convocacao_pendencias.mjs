// Testa a aba "🚦 Pendências de Convocação" de SIME_convocacao.html
// (03/09/2026, pedido direto: "quero um relatorio para saber todos que
// estão como convocados no elo e ainda não estão convocados ou confirmados
// no sime" → "pode fazer isso um relatorio do sime convocações?
// permanente?"). sime_pendencias_convocacao.js tinha sido escrito mas nunca
// ligado (sem <script>, sem aba, sem entrada em goTab/render) — corrigido
// junto com este teste.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(_cols, opts){ if(opts && opts.count) this._count=true; return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  contains(c,v){ this.f['__contains_'+c]=v; return this; }
  not(c, op, v){
    // Os dois usos reais no projeto: .not(col,'in','(a,b,c)') e
    // .not(col,'is',null) — mesma sintaxe crua do supabase-js.
    if(op==='in'){ this.f['__notin_'+c]=String(v).replace(/^\\(|\\)$/g,'').split(','); }
    else if(op==='is' && v===null){ this.f['__notnull_'+c]=true; }
    return this;
  }
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  delete(){ this._op='delete'; return this; }
  insert(p){
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ...row }));
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    if(!window.__mock[this.t]) window.__mock[this.t]=[];
    window.__mock[this.t].push(...linhas);
    return Promise.resolve({ error:null, data:linhas });
  }
  _casa(x){
    return Object.entries(this.f).every(([k,v]) => {
      if(k.startsWith('__in_')) return v.includes(x[k.slice(5)]);
      if(k.startsWith('__notin_')) return !v.includes(x[k.slice(8)]);
      if(k.startsWith('__notnull_')) return x[k.slice(10)] != null;
      if(k.startsWith('__contains_')){
        const path=k.slice(11); const [col,key]=path.split('->');
        const arr=x[col]?.[key];
        return Array.isArray(arr) && arr.some(item => v.every(want => Object.entries(want).every(([kk,vv]) => item[kk]===vv)));
      }
      if(k.includes('->>')){ const [col,key]=k.split('->>'); return String(x[col]?.[key] ?? '')===String(v); }
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
      window.__mock[this.t] = rows.filter(x=>!this._casa(x));
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
    rpc(name, params){
      window.__mock.rpcChamadas.push({ name, params });
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-10T15:30:00.000Z', error:null });
      return Promise.resolve({ data:null, error:null });
    },
    auth: {
      async getSession(){ return { data:{ session: ler() } }; },
      async getUser(){ const s=ler(); return { data:{ user: s?{ id:'auth-maria' }:null } }; },
      async signInWithPassword({ email }){ const session={ user:{ id:'auth-maria', email } }; localStorage.setItem('_mock_session', JSON.stringify(session)); return { data:{ session }, error:null }; },
    },
  };
}
`;

function mock() {
  return {
    escritas: [], rpcChamadas: [],
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
    sime_logs: [
      // Tentativa MANUAL (➕ Registrar tentativa / 🔗 Copiar link) — conta
      // como "já contactado" mesmo sem nenhuma campanha, mesmo critério de
      // sime_contatar_mesarios.js.
      { id: 'l1', acao: 'mesario_tentativa_contato', payload: { ator_id: 'p3' }, ts: '2026-09-08T10:00:00.000Z' },
    ],
    sime_secoes: [
      { id: 's1', numero: 30, local_nome: 'Grupo Escolar A', municipio: 'Campo Maior', zona_id: 'z7' },
      { id: 's2', numero: 63, local_nome: 'Escola B', municipio: 'Jatobá do Piauí', zona_id: 'z7' },
    ],
    sime_campanhas_confirmacao: [
      { id: 'cc1', ator_id: 'p2', zona_id: 'z7', status: 'enviado', created_at: '2026-09-07T10:00:00.000Z' },
    ],
    sime_atores: [
      // p1: nunca contactado — nenhuma campanha, nenhum log manual.
      { id: 'p1', nome_completo: 'PEDRO NUNCA CONTACTADO', inscricao_eleitoral: '111111111111', telefone_whatsapp: '5586999990001', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's1', confirmacao: 'pendente', meio_contato: null, zona_id: 'z7', ativo: true },
      // p2: já contactado por CAMPANHA (status='enviado').
      { id: 'p2', nome_completo: 'JOANA JA CONTACTADA CAMPANHA', inscricao_eleitoral: '222222222222', telefone_whatsapp: '5586999990002', funcao: 'mesario', funcao_mesa: '1º Mesário', secao_id: 's2', confirmacao: 'pendente', meio_contato: null, zona_id: 'z7', ativo: true },
      // p3: já contactado por TENTATIVA MANUAL, apoio logístico.
      { id: 'p3', nome_completo: 'CARLOS TENTATIVA MANUAL', inscricao_eleitoral: '333333333333', telefone_whatsapp: '5586999990003', funcao: 'coord_acessibilidade', funcao_mesa: null, secao_id: 's1', confirmacao: 'contato_incorreto', meio_contato: null, zona_id: 'z7', ativo: true },
      // p4/p5/p6: já avançaram (convocado/confirmado/substituído) — devem
      // ficar de fora da lista inteira, é exatamente o que a pendência NÃO é.
      { id: 'p4', nome_completo: 'DANIELA JA CONVOCADA', inscricao_eleitoral: '444444444444', telefone_whatsapp: '5586999990004', funcao: 'mesario', funcao_mesa: '2º Mesário', secao_id: 's1', confirmacao: 'convocado', meio_contato: null, zona_id: 'z7', ativo: true },
      { id: 'p5', nome_completo: 'EDUARDO JA CONFIRMADO', inscricao_eleitoral: '555555555555', telefone_whatsapp: '5586999990005', funcao: 'mesario', funcao_mesa: 'Secretário', secao_id: 's2', confirmacao: 'confirmado', meio_contato: null, zona_id: 'z7', ativo: true },
      { id: 'p6', nome_completo: 'FATIMA JA SUBSTITUIDA', inscricao_eleitoral: '666666666666', telefone_whatsapp: '5586999990006', funcao: 'mesario', funcao_mesa: 'Presidente', secao_id: 's1', confirmacao: 'substituido', meio_contato: null, zona_id: 'z7', ativo: false },
    ],
  };
}

async function abrir(ctx, m, path = 'SIME_convocacao.html') {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/' + path);
  await p.waitForTimeout(400);
  return { p, erros };
}
async function login(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── 1. Lista, contagem, badges de situação — só quem AINDA não avançou ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-pendencias-btn');
  await p.waitForTimeout(400);

  const txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('mostra os 3 pendentes de verdade', /PEDRO NUNCA CONTACTADO/.test(txt) && /JOANA JA CONTACTADA CAMPANHA/.test(txt) && /CARLOS TENTATIVA MANUAL/.test(txt), txt.slice(0, 500));
  check('quem já é convocado/confirmado/substituído NUNCA aparece aqui', !/DANIELA JA CONVOCADA/.test(txt) && !/EDUARDO JA CONFIRMADO/.test(txt) && !/FATIMA JA SUBSTITUIDA/.test(txt), txt.slice(0, 500));
  check('contagem "3 no total"', /3 no total/.test(txt), txt.slice(0, 300));
  check('1 nunca contactado (🔴)', /🔴 1 nunca contactado/.test(txt), txt.slice(0, 300));
  check('2 já contactados sem avanço (🟡)', /🟡 2 já contactado, sem avanço/.test(txt), txt.slice(0, 300));
  check('badge de status do SIME aparece (contato incorreto, pra Carlos)', /🔍 Contato incorreto/.test(txt));
  check('badge de tentativa "1x contactado" (campanha) pra Joana', /1x contactado/.test(txt));
  check('badge "Nunca contactado" pra Pedro', /🔴 Nunca contactado/.test(txt));
  check('seção da pessoa aparece (nº + local + município)', /Seção 30.*Grupo Escolar A.*Campo Maior/.test(txt));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Filtro por situação (nunca contactado / já contactado) ──
// Escopado à lista de pessoas (.cm-lista-pessoas), não ao #content inteiro
// — o painel de destaque amarelo "já tiveram alguma tentativa..." SEMPRE
// cita Joana/Carlos pelo nome, independente do filtro ativo (mesmo padrão
// de "Contatar mesários"), então testar contra o texto todo daria falso
// negativo mesmo com o filtro funcionando certo.
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-pendencias-btn');
  await p.waitForTimeout(400);

  await p.selectOption('#pc-filtro-situacao', 'nunca');
  await p.waitForTimeout(150);
  let txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "nunca contactado": só Pedro', /PEDRO NUNCA CONTACTADO/.test(txt) && !/JOANA/.test(txt) && !/CARLOS/.test(txt), txt.slice(0, 400));

  await p.selectOption('#pc-filtro-situacao', 'ja_contactado');
  await p.waitForTimeout(150);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro "já contactado, sem avanço": Joana e Carlos, sem Pedro', /JOANA/.test(txt) && /CARLOS/.test(txt) && !/PEDRO NUNCA CONTACTADO/.test(txt), txt.slice(0, 400));

  // Painel de destaque amarelo também filtra ao clicar (mesmo padrão de
  // "Contatar mesários").
  await p.selectOption('#pc-filtro-situacao', '');
  await p.waitForTimeout(150);
  await p.click('.import-result.ir-warn:has-text("já tiveram alguma tentativa")');
  await p.waitForTimeout(150);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('clicar no painel de destaque aplica o mesmo filtro "já contactado"', /JOANA/.test(txt) && /CARLOS/.test(txt) && !/PEDRO NUNCA CONTACTADO/.test(txt), txt.slice(0, 400));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Filtro por função e por município + busca por nome/título ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-pendencias-btn');
  await p.waitForTimeout(400);

  await p.selectOption('#pc-filtro-funcao', 'coord_acessibilidade');
  await p.waitForTimeout(150);
  let txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro função=coordenador de acessibilidade: só Carlos', /CARLOS/.test(txt) && !/PEDRO/.test(txt) && !/JOANA/.test(txt), txt.slice(0, 400));
  await p.selectOption('#pc-filtro-funcao', '');

  await p.selectOption('#pc-filtro-municipio', 'Jatobá do Piauí');
  await p.waitForTimeout(150);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('filtro município=Jatobá do Piauí: só Joana (seção s2)', /JOANA/.test(txt) && !/PEDRO/.test(txt) && !/CARLOS/.test(txt), txt.slice(0, 400));
  await p.selectOption('#pc-filtro-municipio', '');

  await p.fill('#pc-busca', 'joana');
  await p.waitForTimeout(300);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por nome (case-insensitive)', /JOANA/.test(txt) && !/PEDRO/.test(txt) && !/CARLOS/.test(txt), txt.slice(0, 400));
  await p.fill('#pc-busca', '');
  await p.waitForTimeout(300);

  await p.fill('#pc-busca', '333333333333');
  await p.waitForTimeout(300);
  txt = (await p.locator('.cm-lista-pessoas').textContent()).replace(/\s+/g, ' ');
  check('busca por título de eleitor', /CARLOS/.test(txt) && !/PEDRO/.test(txt) && !/JOANA/.test(txt), txt.slice(0, 400));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Exportar CSV — dispara download sem erro ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-pendencias-btn');
  await p.waitForTimeout(400);

  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.click('button:has-text("⬇️ Exportar CSV")'),
  ]);
  check('exportar CSV gera um arquivo de download', /sime_pendencias_convocacao_.*\.csv/.test(download.suggestedFilename()), download.suggestedFilename());

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Nome clicável abre o modal compartilhado de "Contatar mesários" ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-pendencias-btn');
  await p.waitForTimeout(400);

  await p.click('text=PEDRO NUNCA CONTACTADO');
  await p.waitForTimeout(300);
  check('clicar no nome abre o modal de pessoa (mesmo modal de Contatar mesários)', await p.locator('.m-title, .modal').first().isVisible().catch(() => false));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const fails = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.n}${r.ok ? '' : ' — ' + r.e}`);
console.log(`\n${results.length - fails.length}/${results.length} ok`);
process.exit(fails.length ? 1 : 0);
