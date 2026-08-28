// Testa a aba nova "🙋 Voluntários" de SIME_convocacao.html (28/08/2026) —
// cadastro paralelo ao roster oficial do TRE, pra o cartório ter de onde
// tirar gente quando uma vaga precisar ser preenchida. Só a equipe do
// cartório cadastra (sem trava de perfil, mesmo padrão do resto da página).
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
  order(){ return this; }
  limit(){ return this; }
  single(){ return this.maybeSingle(); }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>this._casa(x)); return Promise.resolve({ data:r[0]??null, error:null }); }
  update(p){ this._op='update'; this._payload=p; return this; }
  delete(){ this._op='delete'; return this; }
  insert(p){
    // ativo:true simula o DEFAULT do Postgres (sime_voluntarios.ativo not
    // null default true) — o insert de verdade nunca manda esse campo
    // explicitamente, então sem o default aqui o mock guardaria a linha sem
    // o campo ativo, e o filtro ativo=true do reload a excluiria por engano.
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ativo:true, ...row }));
    // CPF duplicado na mesma zona — simula a violação da unique index
    // (zona_id,cpf) igual o Postgres faria, pra testar o erro amigável.
    if(this.t==='sime_voluntarios'){
      for(const row of linhas){
        const bate=(window.__mock.sime_voluntarios||[]).some(x=>x.zona_id===row.zona_id && x.cpf===row.cpf);
        if(bate){
          window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p, erro:true });
          return Promise.resolve({ error:{ message:'duplicate key value violates unique constraint "idx_voluntarios_zona_cpf"' }, data:null });
        }
      }
    }
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    if(!window.__mock[this.t]) window.__mock[this.t]=[];
    window.__mock[this.t].push(...linhas);
    return Promise.resolve({ error:null, data:linhas });
  }
  _casa(x){
    return Object.entries(this.f).every(([k,v]) => {
      if(k.startsWith('__in_')) return v.includes(x[k.slice(5)]);
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
      if(this.t==='sime_voluntarios' && 'cpf' in this._payload){
        const bate=(window.__mock.sime_voluntarios||[]).some(x=>this._casa(x)===false && x.zona_id===this._payload.zona_id && x.cpf===this._payload.cpf);
      }
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
      if(name==='sime_now') return Promise.resolve({ data:'2026-08-28T15:30:00.000Z', error:null });
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
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', nome: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
    sime_logs: [],
    sime_secoes: [
      { id: 's1', numero: 30, local_nome: 'Grupo Escolar A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 280 },
      { id: 's2', numero: 63, local_nome: 'Escola B', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 300 },
      { id: 's3', numero: 10, local_nome: 'Escola Sede', municipio: 'Jatobá do Piauí', zona_id: 'z7', ativo: true, eleitores: 150 },
    ],
    sime_atores: [],
    sime_voluntarios: [
      { id: 'v1', zona_id: 'z7', cpf: '11122233344', nome: 'ANA VOLUNTARIA', telefone_whatsapp: '5586999991111', funcoes: ['mesario'], municipio: 'Campo Maior', local_votacao: 'Grupo Escolar A', observacao: null, status: 'disponivel', ativo: true, created_at: '2026-08-27T10:00:00.000Z' },
      { id: 'v2', zona_id: 'z7', cpf: '22233344455', nome: 'BRUNO VOLUNTARIO', telefone_whatsapp: '', funcoes: [], municipio: null, local_votacao: null, observacao: 'Disponível só de manhã', status: 'convocado', ativo: true, created_at: '2026-08-26T10:00:00.000Z' },
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

// ── 1. Lista, filtros, badges ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(400);

  const txt = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('lista mostra os 2 voluntários cadastrados', /ANA VOLUNTARIA/.test(txt) && /BRUNO VOLUNTARIO/.test(txt), txt.slice(0, 400));
  check('badge de função específica (Ana: só Mesário)', /Mesário \(MRV\)/.test(txt));
  check('badge "Qualquer função" pro voluntário sem função marcada (Bruno)', /Qualquer função/.test(txt));
  check('badge de local específico (Ana: Campo Maior — Grupo Escolar A)', /Campo Maior — Grupo Escolar A/.test(txt));
  check('badge "Qualquer município" pro voluntário sem município (Bruno)', /Qualquer município/.test(txt));
  check('CPF formatado na exibição', /111\.222\.333-44/.test(txt));
  check('status badge mostra Convocado pro Bruno', /📋 Convocado/.test(txt));
  check('observação do Bruno aparece', /Disponível só de manhã/.test(txt));
  check('sem telefone: "Sem telefone" em vez de botão quebrado', /Sem telefone/.test(txt));
  check('contagem "2 de 2 voluntário\\(s\\)"', /2 de 2 voluntário/.test(txt));

  // Filtro por status
  await p.selectOption('#vl-filtro-status', 'convocado');
  await p.waitForTimeout(150);
  let txt2 = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('filtro status=convocado: só Bruno aparece', /BRUNO VOLUNTARIO/.test(txt2) && !/ANA VOLUNTARIA/.test(txt2), txt2.slice(0, 300));
  await p.selectOption('#vl-filtro-status', '');

  // Filtro por função — Bruno tem funcoes=[] (qualquer função), então
  // sempre casa com qualquer filtro de função (regra deliberada do código).
  await p.selectOption('#vl-filtro-funcao', 'coord_acessibilidade');
  await p.waitForTimeout(150);
  txt2 = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('filtro função=coord_acessibilidade: Ana (só mesário) some, Bruno (qualquer) continua', !/ANA VOLUNTARIA/.test(txt2) && /BRUNO VOLUNTARIO/.test(txt2), txt2.slice(0, 300));
  await p.selectOption('#vl-filtro-funcao', '');

  // Busca por nome
  await p.fill('#content input[placeholder*="Buscar"]', 'ana volu');
  await p.waitForTimeout(150);
  txt2 = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('busca por nome (case-insensitive)', /ANA VOLUNTARIA/.test(txt2) && !/BRUNO VOLUNTARIO/.test(txt2), txt2.slice(0, 300));
  await p.fill('#content input[placeholder*="Buscar"]', '');

  // Busca por CPF (só dígitos)
  await p.fill('#content input[placeholder*="Buscar"]', '222333444');
  await p.waitForTimeout(150);
  txt2 = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('busca por CPF', /BRUNO VOLUNTARIO/.test(txt2) && !/ANA VOLUNTARIA/.test(txt2), txt2.slice(0, 300));

  check('nenhum erro JS na aba', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Cadastrar novo voluntário — função "qualquer" + município/local em cascata ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  await p.click('button:has-text("➕ Novo voluntário")');
  await p.waitForTimeout(200);
  check('modal abre com título "Novo voluntário"', /Novo voluntário/.test(await p.locator('.m-title').textContent()));

  // Salvar sem nome — validação
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(150);
  check('nome vazio bloqueia salvar (nenhum insert)', !(await p.evaluate(() => window.__mock.escritas.some(e => e.tabela === 'sime_voluntarios' && e.op === 'insert'))));

  await p.fill('#vl-nome', 'CARLA NOVA VOLUNTARIA');
  await p.fill('#vl-cpf', '123');
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(150);
  check('CPF com menos de 11 dígitos bloqueia salvar', !(await p.evaluate(() => window.__mock.escritas.some(e => e.tabela === 'sime_voluntarios' && e.op === 'insert'))));

  await p.fill('#vl-cpf', '999.888.777-66');
  await p.fill('#vl-tel', '(86) 98888-7766');

  // Município → local em cascata
  check('grupo de local escondido sem município escolhido', await p.evaluate(() => getComputedStyle(document.getElementById('vl-grp-local')).display === 'none'));
  await p.selectOption('#vl-municipio', 'Jatobá do Piauí');
  await p.waitForTimeout(100);
  check('grupo de local aparece ao escolher município', await p.evaluate(() => getComputedStyle(document.getElementById('vl-grp-local')).display !== 'none'));
  const opcoesLocal = await p.locator('#vl-local option').allTextContents();
  check('locais do município escolhido populam o select (Escola Sede, Jatobá)', opcoesLocal.some(t => /Escola Sede/.test(t)), opcoesLocal.join(','));
  await p.selectOption('#vl-local', 'Escola Sede');

  // "Qualquer função" vem marcada por padrão num cadastro novo (funcoesAtuais
  // vazio) — as específicas já nascem desabilitadas. Desmarcar libera.
  check('específicas nascem desabilitadas (qualquer função é o padrão)', await p.locator('.vl-func-especifica[value="mesario"]').isDisabled());
  await p.uncheck('#vl-func-qualquer');
  await p.waitForTimeout(100);
  check('desmarcar "Qualquer função" habilita as específicas', !(await p.locator('.vl-func-especifica[value="mesario"]').isDisabled()));
  await p.check('.vl-func-especifica[value="mesario"]');
  check('específica marcada manualmente', await p.locator('.vl-func-especifica[value="mesario"]').isChecked());

  // Voltar a marcar "Qualquer função" desmarca e desabilita as específicas de novo
  await p.check('#vl-func-qualquer');
  await p.waitForTimeout(100);
  const mesarioChecked = await p.locator('.vl-func-especifica[value="mesario"]').isChecked();
  const mesarioDisabled = await p.locator('.vl-func-especifica[value="mesario"]').isDisabled();
  check('marcar "Qualquer função" desmarca e desabilita as específicas', !mesarioChecked && mesarioDisabled);

  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(250);

  const ins = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_voluntarios' && e.op === 'insert' && !e.erro));
  check('insert gravado com CPF só-dígitos (sem máscara)', !!ins && ins.payload.cpf === '99988877766', JSON.stringify(ins && ins.payload));
  check('insert com funcoes=[] (qualquer função)', !!ins && Array.isArray(ins.payload.funcoes) && ins.payload.funcoes.length === 0);
  check('insert com município/local escolhidos', !!ins && ins.payload.municipio === 'Jatobá do Piauí' && ins.payload.local_votacao === 'Escola Sede');
  check('telefone normalizado com prefixo 55', !!ins && ins.payload.telefone_whatsapp === '5586988887766', ins && ins.payload.telefone_whatsapp);
  check('zona_id do usuário logado', !!ins && ins.payload.zona_id === 'z7');
  check('created_by resolvido pro id de sime_usuarios', !!ins && ins.payload.created_by === 'u-maria');

  const logGravado = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_logs' && e.op === 'insert' && e.payload.acao === 'voluntario_cadastrado'));
  check('log voluntario_cadastrado gravado com eleicao_id preenchido', !!logGravado && logGravado.payload.eleicao_id === 'el7', JSON.stringify(logGravado));

  check('modal fecha depois de salvar', await p.evaluate(() => getComputedStyle(document.getElementById('overlay')).display === 'none' || !document.getElementById('overlay').classList.contains('open')));

  // vlDados=null força vlCarregar() de novo (Promise.all assíncrono) — dá
  // tempo do "select" mockado resolver antes de ler a lista renderizada.
  await p.waitForTimeout(300);
  const txtFinal = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('novo voluntário aparece na lista (recarregou do banco)', /CARLA NOVA VOLUNTARIA/.test(txtFinal), txtFinal.slice(0, 400));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. CPF duplicado — erro amigável, não a mensagem crua do Postgres ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  await p.click('button:has-text("➕ Novo voluntário")');
  await p.waitForTimeout(200);
  await p.fill('#vl-nome', 'DUPLICADA DE ANA');
  await p.fill('#vl-cpf', '111.222.333-44'); // mesmo CPF de ANA VOLUNTARIA (v1)
  await p.check('#vl-func-qualquer');
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(200);

  const toast = await p.locator('.toast, #toast, [class*=toast]').last().textContent().catch(() => '');
  check('CPF duplicado mostra erro amigável (não "duplicate key" cru)', /Já existe um voluntário com esse CPF/.test(toast || ''), toast);
  check('modal continua aberto (não perdeu o que a pessoa digitou)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('nenhum voluntário novo foi de fato inserido', (await p.evaluate(() => window.__mock.sime_voluntarios.length)) === 2);

  await ctx.close();
}

// ── 4. Editar voluntário existente ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  await p.click('text=ANA VOLUNTARIA');
  await p.waitForTimeout(200);
  check('modal de edição abre com título certo', /Editar voluntário/.test(await p.locator('.m-title').textContent()));
  check('campos pré-preenchidos com o dado existente', (await p.inputValue('#vl-nome')) === 'ANA VOLUNTARIA');
  check('função específica já marcada (mesario)', await p.locator('.vl-func-especifica[value="mesario"]').isChecked());

  await p.fill('#vl-obs', 'Prefere trabalhar na própria seção');
  await p.click('#modal-body button:has-text("💾 Salvar")');
  await p.waitForTimeout(200);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_voluntarios' && e.op === 'update' && e.filtro.id === 'v1'));
  check('update gravado com a observação nova', !!upd && upd.payload.observacao === 'Prefere trabalhar na própria seção', JSON.stringify(upd));
  check('update usa sime_now() (updated_at preenchido), não Date.now/new Date', !!upd && upd.payload.updated_at === '2026-08-28T15:30:00.000Z');
  const rpcNow = await p.evaluate(() => window.__mock.rpcChamadas.some(r => r.name === 'sime_now'));
  check('sime_now() foi de fato chamado (nunca Date.now/new Date, regra do projeto)', rpcNow);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Clique dentro do modal NÃO fecha (guard do overlay compartilhado); clique no fundo fecha ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  await p.click('button:has-text("➕ Novo voluntário")');
  await p.waitForTimeout(200);
  await p.fill('#vl-nome', 'Não deve perder isso');
  await p.click('.m-title'); // clique dentro do modal, borbulha até #overlay
  await p.waitForTimeout(150);
  check('clique dentro do modal não fecha (overlay continua aberto)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('o que foi digitado continua lá (modal não recarregou)', (await p.inputValue('#vl-nome')) === 'Não deve perder isso');

  // Clique no backdrop (fora do .modal) fecha de verdade
  await p.evaluate(() => document.getElementById('overlay').click());
  await p.waitForTimeout(150);
  check('clique no backdrop fecha o modal', await p.evaluate(() => !document.getElementById('overlay').classList.contains('open')));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Status rápido (botões no card) + remover (soft-delete) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  const cardAna = p.locator('.import-card', { hasText: 'ANA VOLUNTARIA' });
  await cardAna.locator('button:has-text("📋 Convocado")').click();
  await p.waitForTimeout(200);
  const updStatus = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_voluntarios' && e.op === 'update' && e.filtro.id === 'v1' && e.payload.status === 'convocado'));
  check('botão rápido "Convocado" grava o status', !!updStatus, JSON.stringify(updStatus));
  const logStatus = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_logs' && e.payload.acao === 'voluntario_status'));
  check('log voluntario_status gravado', !!logStatus);

  await p.waitForTimeout(150);
  const cardAna2 = p.locator('.import-card', { hasText: 'ANA VOLUNTARIA' });
  await cardAna2.locator('button:has-text("✕ Remover")').click();
  await p.waitForTimeout(250);
  const softDelete = await p.evaluate(() => window.__mock.escritas.find(e => e.tabela === 'sime_voluntarios' && e.op === 'update' && e.filtro.id === 'v1' && e.payload.ativo === false));
  check('remover é soft-delete (ativo:false), nunca DELETE de verdade', !!softDelete);
  check('nenhum DELETE real disparado em sime_voluntarios', !(await p.evaluate(() => window.__mock.escritas.some(e => e.tabela === 'sime_voluntarios' && e.op === 'delete'))));

  const txtFinal = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('ANA some da lista depois de removida (ativo=false, filtro .eq ativo=true)', !/ANA VOLUNTARIA/.test(txtFinal), txtFinal.slice(0, 300));

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Copiar link do WhatsApp ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.click('#tab-voluntarios-btn');
  await p.waitForTimeout(300);

  await p.evaluate(() => {
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } } });
  });
  const cardAna = p.locator('.import-card', { hasText: 'ANA VOLUNTARIA' });
  await cardAna.locator('button[title="Copiar link do WhatsApp"]').click();
  await p.waitForTimeout(200);
  const copiado = await p.evaluate(() => window.__clipboardText);
  check('copiar link do WhatsApp monta link wa.me com o telefone da pessoa', (copiado || '').includes('5586999991111'), copiado);
  check('mensagem menciona o cadastro de voluntário', /volunt/i.test(decodeURIComponent(copiado || '')), copiado);

  check('nenhum erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const falhas = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'OK  ' : 'FAIL') + ' — ' + r.n + (r.ok ? '' : ('  [' + r.e + ']')));
console.log(`\n${results.length - falhas.length}/${results.length} passaram`);
if (falhas.length) process.exit(1);
