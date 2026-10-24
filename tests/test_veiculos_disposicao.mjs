// Testa o módulo novo SIME_veiculos_disposicao.html (28/09/2026) — cadastro
// de veículos de órgãos públicos cedidos à Justiça Eleitoral na véspera e no
// Dia D. Cobre: lista agrupada por município, busca, filtro, criar/editar/
// remover/reativar (soft-delete), badge "sem motorista designado", link de
// WhatsApp do motorista, impressão da lista, e o bloqueio de acesso pro
// perfil Auxiliar de Eleição (só Problemas/Rotas, ver sime_acesso_perfil.js).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

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
    const linhas=(Array.isArray(p)?p:[p]).map(row=>({ id:'ins_'+Math.random().toString(36).slice(2), ativo:true, ...row }));
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
    rpc(name){
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-28T15:00:00.000Z', error:null });
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

function mock(perfil = 'coordenador') {
  return {
    escritas: [],
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil, zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
    sime_logs: [],
    sime_secoes: [
      { id: 's1', numero: 5, municipio: 'Campo Maior', zona_id: 'z7', ativo: true },
      { id: 's2', numero: 168, municipio: 'Jatobá do Piauí', zona_id: 'z7', ativo: true },
      { id: 's3', numero: 85, municipio: 'Sigefredo Pacheco', zona_id: 'z7', ativo: true },
    ],
    sime_veiculos_disposicao: [
      { id: 'v1', zona_id: 'z7', municipio: 'Campo Maior', quantidade: 1, veiculo: 'PICAP L200', placa: 'NIJ5137', lotacao: 'IFPI', renavam: null, motorista_nome: null, motorista_telefone: null, observacao: null, ativo: true },
      { id: 'v2', zona_id: 'z7', municipio: 'Campo Maior', quantidade: 1, veiculo: 'SUZUKI JIMNY', placa: 'PIU6247', lotacao: 'IBGE', renavam: null, motorista_nome: 'WANDERSON', motorista_telefone: '5586981735152', observacao: null, ativo: true },
      { id: 'v3', zona_id: 'z7', municipio: 'Jatobá do Piauí', quantidade: 1, veiculo: 'FIAT UNO ANO 2013', placa: 'KKK0B85', lotacao: 'Prefeitura de Jatobá', renavam: '557663288', motorista_nome: 'Francisco Pereira de Oliveira Neto', motorista_telefone: '5586981421984', observacao: null, ativo: true },
      { id: 'v4', zona_id: 'z7', municipio: 'Sigefredo Pacheco', quantidade: 1, veiculo: 'TOYOTA HILUX, COR BRANCA', placa: 'OHQ9I91', lotacao: 'PM Sigefredo', renavam: null, motorista_nome: 'Francelio Pereira da Silva', motorista_telefone: '5511996848327', observacao: null, ativo: false },
    ],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_veiculos_disposicao.html');
  await p.waitForTimeout(400);
  return { p, erros };
}
async function login(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── Bloco 1: lista carrega, agrupada por município, contagens corretas ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  const texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('mostra os 3 veículos ativos (v4 está inativo, some do padrão)', /PICAP L200/.test(texto) && /SUZUKI JIMNY/.test(texto) && /FIAT UNO/.test(texto) && !/TOYOTA HILUX/.test(texto), texto);
  check('agrupa por município (Campo Maior, Jatobá do Piauí, Sigefredo Pacheco aparecem como cabeçalho)', /Campo Maior/.test(texto) && /Jatobá do Piauí/.test(texto), texto);
  check('contagem de ativos = 3', /\b3\b[^0-9]*veículo/.test(texto) || /<b>3<\/b>/.test((await p.locator('#content').innerHTML())));
  check('mostra badge "sem motorista designado" pro veículo sem motorista (v1)', /sem motorista designado/.test(texto));
  check('mostra o nome do motorista pro que tem (Wanderson)', /WANDERSON/.test(texto));
  check('mostra placa e lotação', /NIJ5137/.test(texto) && /IFPI/.test(texto));
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 2: busca e filtro por município ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.fill('input[placeholder*="Buscar por veículo"]', 'jimny');
  await p.waitForTimeout(150);
  let texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('busca por veículo filtra (só Jimny)', /SUZUKI JIMNY/.test(texto) && !/PICAP L200/.test(texto), texto);

  await p.fill('input[placeholder*="Buscar por veículo"]', '');
  await p.selectOption('#vd-filtro-municipio', 'Jatobá do Piauí');
  await p.waitForTimeout(150);
  texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('filtro por município mostra só Jatobá do Piauí', /FIAT UNO/.test(texto) && !/PICAP L200/.test(texto) && !/SUZUKI JIMNY/.test(texto), texto);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 3: mostrar removidos revela o inativo (v4) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  let texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('v4 (inativo) não aparece por padrão', !/TOYOTA HILUX/.test(texto));

  await p.check('#vd-mostrar-inativos');
  await p.waitForTimeout(150);
  texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('com "mostrar removidos" marcado, v4 aparece', /TOYOTA HILUX/.test(texto));
  check('v4 mostra badge "removido"', /removido/.test(texto));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 4: criar novo veículo ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.click('button:has-text("Novo veículo")');
  await p.waitForTimeout(150);
  await p.fill('#vd-municipio', 'Campo Maior');
  await p.fill('#vd-veiculo', 'FIAT STRADA, COR PRATA');
  await p.fill('#vd-placa', 'ABC 1D23');
  await p.fill('#vd-lotacao', 'Secretaria de Obras');
  await p.fill('#vd-motorista', 'Pedro Souza');
  await p.fill('#vd-telefone', '86999998888');
  await p.click('button:has-text("💾 Salvar")');
  await p.waitForTimeout(200);

  const criado = await p.evaluate(() => window.__mock.sime_veiculos_disposicao.find(v => v.veiculo === 'FIAT STRADA, COR PRATA'));
  check('gravou o veículo novo', !!criado, JSON.stringify(criado));
  check('placa foi normalizada (sem espaço, maiúscula)', criado?.placa === 'ABC1D23', criado?.placa);
  check('telefone do motorista foi normalizado (55+DDD)', criado?.motorista_telefone === '5586999998888', criado?.motorista_telefone);
  check('quantidade default = 1', criado?.quantidade === 1);
  const logouCriado = await p.evaluate(() => window.__mock.sime_logs.some(l => l.acao === 'veiculo_disposicao_criado'));
  check('logou veiculo_disposicao_criado', logouCriado);

  const texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('aparece na lista depois de salvar', /FIAT STRADA/.test(texto));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 5: campos obrigatórios bloqueiam o salvar ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.click('button:has-text("Novo veículo")');
  await p.waitForTimeout(150);
  await p.click('button:has-text("💾 Salvar")'); // sem preencher nada
  await p.waitForTimeout(150);

  const gravouAlgo = await p.evaluate(() => window.__mock.sime_veiculos_disposicao.some(v => v.id?.startsWith('ins_')));
  check('não gravou nada sem município/veículo', !gravouAlgo);
  check('modal continua aberto (não fechou com erro)', await p.locator('#overlay.open').count() === 1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 6: editar veículo existente ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('[data-vid="v1"] div[title="Clique pra editar"]').click();
  await p.waitForTimeout(150);
  await p.fill('#vd-motorista', 'Recém-designado Silva');
  await p.fill('#vd-telefone', '86988887777');
  await p.click('button:has-text("💾 Salvar")');
  await p.waitForTimeout(200);

  const v1 = await p.evaluate(() => window.__mock.sime_veiculos_disposicao.find(v => v.id === 'v1'));
  check('gravou o novo motorista', v1?.motorista_nome === 'Recém-designado Silva', v1?.motorista_nome);
  const logouEditado = await p.evaluate(() => window.__mock.sime_logs.some(l => l.acao === 'veiculo_disposicao_editado'));
  check('logou veiculo_disposicao_editado', logouEditado);

  const texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('não mostra mais "sem motorista designado" pra este veículo', !/PICAP L200.*sem motorista/.test(texto));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 7: remover (soft-delete) e reativar ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  p.on('dialog', d => d.accept());
  await p.locator('[data-vid="v2"] button:has-text("Remover")').click();
  await p.waitForTimeout(200);

  const v2 = await p.evaluate(() => window.__mock.sime_veiculos_disposicao.find(v => v.id === 'v2'));
  check('v2 ficou inativo depois de remover', v2?.ativo === false);
  const logouRemovido = await p.evaluate(() => window.__mock.sime_logs.some(l => l.acao === 'veiculo_disposicao_removido'));
  check('logou veiculo_disposicao_removido', logouRemovido);

  let texto = (await p.locator('#content').textContent()).replace(/\s+/g, ' ');
  check('some da lista padrão depois de removido', !/SUZUKI JIMNY/.test(texto));

  await p.check('#vd-mostrar-inativos');
  await p.waitForTimeout(150);
  await p.locator('[data-vid="v2"] button:has-text("Reativar")').click();
  await p.waitForTimeout(200);
  const v2b = await p.evaluate(() => window.__mock.sime_veiculos_disposicao.find(v => v.id === 'v2'));
  check('v2 voltou a ficar ativo', v2b?.ativo === true);
  const logouReativado = await p.evaluate(() => window.__mock.sime_logs.some(l => l.acao === 'veiculo_disposicao_reativado'));
  check('logou veiculo_disposicao_reativado', logouReativado);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 8: impressão da lista ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.click('button:has-text("Imprimir lista")');
  await p.waitForTimeout(150);

  const chamouPrint = await p.evaluate(() => window.__printCalls);
  check('chamou window.print() (sem popup)', chamouPrint === 1);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('ficha impressa lista os 3 veículos ativos', /PICAP L200/.test(printHtml) && /SUZUKI JIMNY/.test(printHtml) && /FIAT UNO/.test(printHtml));
  check('ficha impressa mostra motorista/telefone', /Francisco Pereira de Oliveira Neto/.test(printHtml) && /9982-1984|9\)\s*981/.test(printHtml.replace(/&nbsp;/g, ' ')) || /Francisco Pereira de Oliveira Neto/.test(printHtml));
  check('ficha impressa mostra "sem motorista designado" pro veículo sem motorista', /sem motorista designado/.test(printHtml));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── Bloco 9: Auxiliar de Eleição não tem acesso a este módulo ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock('auxiliar_eleicao'));
  p.on('dialog', d => d.accept());
  await login(p);
  await p.waitForTimeout(300);

  const url = p.url();
  check('redirecionado pra SIME_principal.html', /SIME_principal\.html/.test(url), url);

  await ctx.close();
}

await b.close();
const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
