// Testa a aba "🔮 Previsão" de SIME_admin.html (08/09/2026) — pedido direto:
// "a cada nova informação de demora na seção, nova informação de
// recolhimento das midias com a chegada do motorista, a informação depois
// de 17h de demora na fila a rota ser redefinida, com isso teriamos
// previsão mais real do fim da eleição". Esclarecido via AskUserQuestion
// antes de construir: "a rota ser redefinida" é RECALCULAR uma previsão de
// horário (não reordenar paradas — isso continua manual no módulo 🗺️
// Rotas). Este painel é só leitura, recalcula sozinho.
//
// Cobre: (1) seção ainda dentro do horário normal de votação não conta fila
// ainda; (2) seção com fila depois do horário de encerramento entra na
// estimativa, seção sem fila "fecha a qualquer momento", seção já encerrada
// usa o horário real; (3) recolhimento de mídia por rota reaproveita
// horario_chegada_previsto do módulo de Rotas (não recalcula distância de
// novo), rota concluída não entra mais na previsão, rota sem previsão
// cadastrada avisa em vez de inventar, e o "fim da operação" é o pior entre
// votação e recolhimento pendente; (4) parâmetro minutos_por_eleitor_fila é
// editável e grava no banco.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

// HH:MM:SS de "agora + offsetMin" — computado no processo Node (mesmo
// relógio/fuso da máquina que roda o Chromium headless), pra comparar com o
// que a página calcula com `new Date()` de verdade (o painel não usa
// sime_now() aqui — é countdown de UI sobre timestamp já gravado, não uma
// ação sendo registrada).
function hhmm(offsetMin) {
  const agora = new Date();
  let d = new Date(agora.getTime() + offsetMin * 60000);
  // pvHojeComHora() (SIME_admin.html) sempre combina a hora com o dia de
  // HOJE — um offset que cruzasse a meia-noite (ex.: 18h + 6h) produziria
  // um horário que, combinado com "hoje", cairia ANTES de "agora" em vez de
  // depois, invertendo a intenção do teste. Nunca deixa sair do dia atual:
  // usa 23:59/00:00 como teto/piso, que ainda preserva "claramente depois"/
  // "claramente antes" de agora pra qualquer hora do dia em que o teste rodar.
  if (d.toDateString() !== agora.toDateString()) {
    d = new Date(agora);
    if (offsetMin >= 0) d.setHours(23, 59, 0, 0); else d.setHours(0, 0, 0, 0);
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { iso: `${hh}:${mm}:00`, label: `${hh}:${mm}` };
}
function isoParaLabel(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const STUB_SUPABASE_JS = `
class QB {
  constructor(t){ this.t=t; this.f={}; this._op=null; this._payload=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f['__in_'+c]=v; return this; }
  not(c,op,v){ this.f['__not_'+c]=v; return this; }
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
      if(k.startsWith('__not_')) return x[k.slice(6)] != null;
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
    rpc(name){
      if(name==='sime_now') return Promise.resolve({ data:new Date().toISOString(), error:null });
      return Promise.resolve({ data:null, error:null });
    },
    auth: {
      async getSession(){ return { data:{ session: ler() } }; },
      async getUser(){ const s=ler(); return { data:{ user: s?{ id:'auth-rafa' }:null } }; },
      async signInWithPassword({ email }){ const session={ user:{ id:'auth-rafa', email } }; localStorage.setItem('_mock_session', JSON.stringify(session)); return { data:{ session }, error:null }; },
    },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
  };
}
`;

function baseMock() {
  return {
    escritas: [],
    sime_usuarios: [{ id: 'u-rafa', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-rafa', telefone_whatsapp: null }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_logs: [],
    sime_atores: [],
    sime_empresas: [],
    // getSecoes() (sime_dados.js) trata array vazio como falha e cai no
    // fallback (null) — sem pelo menos 1 seção, iniciarMesaEstadoReal()
    // nunca roda e window.ELEICAO_ID/ELEICAO_ATIVA nunca são preenchidos.
    // Cada caso de teste sobrescreve isto com as seções que precisa.
    sime_secoes: [{ id: 's0', numero: 1, local_nome: 'Escola Base', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 100 }],
    sime_mesa_estado: [],
    sime_midias: [],
    sime_rotas: [],
    sime_rota_secoes: [],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026', horario_ab: '07:00:00', horario_enc: '17:00:00', minutos_por_eleitor_fila: 1 }],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await p.fill('#login-email', 'rafa@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(500);
  await p.click("button.nav-tab:has-text('Previsão')");
  await p.waitForTimeout(300);
  return { p, erros };
}

// ── 1. Ainda dentro do horário normal — fila não conta ainda ──
{
  const m = baseMock();
  const encFuturo = hhmm(6 * 60); // horário de encerramento daqui a 6h
  m.sime_eleicoes[0].horario_enc = encFuturo.iso;
  m.sime_secoes = [{ id: 's1', numero: 10, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 300 }];
  // fila=5, mas ainda estamos ANTES do horário oficial de encerramento —
  // não deveria contar como "atraso" nenhum.
  m.sime_mesa_estado = [{ secao_id: 's1', fila: 5, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' }];

  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, m);
  check('caso1: zero erros JS', erros.length === 0, erros.join('; '));

  const txtVotacao = (await p.locator('#prev-votacao').textContent()).replace(/\s+/g, ' ');
  check('caso1: previsão de votação usa o horário oficial (ainda sem atraso)', txtVotacao.includes(encFuturo.label), txtVotacao);
  const txtFilas = (await p.locator('#prev-filas').textContent()).replace(/\s+/g, ' ');
  check('caso1: nenhuma seção aparece com fila (ainda dentro do horário normal)', /Nenhuma seção com fila/.test(txtFilas), txtFilas);
  await ctx.close();
}

// ── 2. Depois do horário de encerramento: fila estima atraso, sem fila
//       fecha a qualquer momento, seção já encerrada usa o horário real ──
{
  const m = baseMock();
  const encPassado = hhmm(-30); // horário oficial já passou há 30min
  m.sime_eleicoes[0].horario_enc = encPassado.iso;
  m.sime_secoes = [
    { id: 's1', numero: 10, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 300 },
    { id: 's2', numero: 20, local_nome: 'Escola B', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 200 },
    { id: 's3', numero: 30, local_nome: 'Escola C', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 250 },
  ];
  m.sime_mesa_estado = [
    { secao_id: 's1', fila: 8, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' },
    { secao_id: 's2', fila: 0, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' }, // sem fila — fecha "a qualquer momento"
    { secao_id: 's3', fila: 0, encerrada: true, updated_at: '2026-06-15T14:30:00.000Z' }, // já encerrada de verdade
  ];

  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, m);
  check('caso2: zero erros JS', erros.length === 0, erros.join('; '));

  const txtFilas = (await p.locator('#prev-filas').textContent()).replace(/\s+/g, ' ');
  check('caso2: seção com fila (0010) aparece na lista, com a contagem certa', /Seção 0010/.test(txtFilas) && /8 na fila/.test(txtFilas), txtFilas);
  check('caso2: seção sem fila (0020) NÃO aparece na lista de filas', !/Seção 0020/.test(txtFilas), txtFilas);
  check('caso2: seção já encerrada (0030) NÃO aparece na lista de filas', !/Seção 0030/.test(txtFilas), txtFilas);

  const txtVotacao = (await p.locator('#prev-votacao').textContent()).replace(/\s+/g, ' ');
  check('caso2: pior previsão é a seção com fila (0010) — estimativa maior que "fecha a qualquer momento" ou já encerrada', /Seção mais lenta: 0010/.test(txtVotacao), txtVotacao);
  await ctx.close();
}

// ── 3. Recolhimento de mídia por rota — reaproveita previsão do módulo de
//       Rotas, concluída sai da previsão, sem previsão avisa, fim geral é
//       o pior entre votação e recolhimento pendente ──
{
  const m = baseMock();
  // Votação já com pior previsão claramente MAIS CEDO que a rota pendente
  // abaixo, pra garantir que o "fim da operação" seja ditado pela mídia,
  // não pela votação (comparação determinística, sem depender de minuto
  // exato do relógio da máquina de teste).
  const encPassado = hhmm(-10);
  m.sime_eleicoes[0].horario_enc = encPassado.iso;
  m.sime_secoes = [
    { id: 's1', numero: 10, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 300 },
    { id: 's10', numero: 100, local_nome: 'Escola X', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 100 },
    { id: 's11', numero: 101, local_nome: 'Escola X', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 100 },
    { id: 's12', numero: 102, local_nome: 'Escola Y', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 100 },
    { id: 's13', numero: 103, local_nome: 'Escola Z', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, eleitores: 100 },
  ];
  m.sime_mesa_estado = [
    { secao_id: 's1', fila: 1, encerrada: false, updated_at: '2020-01-01T00:00:00.000Z' }, // atraso pequeno — fecha logo
  ];
  const rotaFutura = hhmm(3 * 60); // rota pendente com previsão de chegada daqui a 3h — claramente pior que a votação
  m.sime_rotas = [
    { id: 'r1', codigo: '001', nome: 'Recolhimento A', tipos: ['recolhimento_midia'], ativo: true, horario_chegada_previsto: rotaFutura.iso },
    { id: 'r2', codigo: '002', nome: 'Recolhimento B (sem previsão)', tipos: ['recolhimento_midia'], ativo: true, horario_chegada_previsto: null },
    { id: 'r3', codigo: '003', nome: 'Recolhimento C (já concluída)', tipos: ['recolhimento_midia'], ativo: true, horario_chegada_previsto: hhmm(-60).iso },
    { id: 'r4', codigo: '004', nome: 'Distribuição (não é mídia)', tipos: ['distribuicao'], ativo: true, horario_chegada_previsto: hhmm(120).iso },
  ];
  m.sime_rota_secoes = [
    { rota_id: 'r1', secao_id: 's10', parada: 1 },
    { rota_id: 'r1', secao_id: 's11', parada: 2 },
    { rota_id: 'r2', secao_id: 's12', parada: 1 },
    { rota_id: 'r3', secao_id: 's13', parada: 1 },
  ];
  m.sime_midias = [
    { secao_id: 's10', status: 'coletada' },
    { secao_id: 's11', status: 'aguardando_encerramento' }, // r1: 1/2 — pendente
    { secao_id: 's12', status: 'pronta_para_coleta' },       // r2: 0/1 — pendente, sem previsão
    { secao_id: 's13', status: 'entregue_transmissao' },     // r3: 1/1 — concluída
  ];

  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, m);
  check('caso3: zero erros JS', erros.length === 0, erros.join('; '));

  const txtMidia = (await p.locator('#prev-midia').textContent()).replace(/\s+/g, ' ');
  check('caso3: rota 001 mostra progresso 1/2 e a previsão do módulo de Rotas', txtMidia.includes('Rota 001') && txtMidia.includes('1/2') && txtMidia.includes(rotaFutura.label), txtMidia);
  check('caso3: rota 002 (sem previsão cadastrada) avisa em vez de inventar horário', txtMidia.includes('Rota 002') && /Sem horário de chegada previsto cadastrado/.test(txtMidia), txtMidia);
  check('caso3: rota 003 (já concluída) aparece como concluída', txtMidia.includes('Rota 003') && /Recolhimento concluído/.test(txtMidia), txtMidia);
  check('caso3: rota 004 (só distribuição, não é recolhimento de mídia) NÃO aparece na lista', !txtMidia.includes('Rota 004'), txtMidia);

  const txtFim = (await p.locator('#prev-fim').textContent()).replace(/\s+/g, ' ');
  check('caso3: fim da operação é ditado pela rota de mídia pendente (mais tarde que a votação)', txtFim.includes(rotaFutura.label), txtFim);
  check('caso3: avisa que a previsão é parcial (rota 002 sem previsão cadastrada)', /Previsão parcial/.test(txtFim), txtFim);
  await ctx.close();
}

// ── 4. Parâmetro minutos_por_eleitor_fila é editável e grava no banco ──
{
  const m = baseMock();
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, m);

  const valorInicial = await p.locator('#prev-min-eleitor').inputValue();
  check('caso4: campo pré-preenchido com o valor salvo (default 1)', valorInicial === '1', valorInicial);

  await p.fill('#prev-min-eleitor', '2.5');
  await p.click('#tab-previsao button:has-text("Salvar")');
  await p.waitForTimeout(200);

  check('caso4: zero erros JS', erros.length === 0, erros.join('; '));
  const escritas = await p.evaluate(() => window.__mock.escritas);
  const upd = escritas.find((e) => e.op === 'update' && e.tabela === 'sime_eleicoes' && e.payload.minutos_por_eleitor_fila === 2.5);
  check('caso4: grava minutos_por_eleitor_fila=2.5 em sime_eleicoes', !!upd, JSON.stringify(escritas));
  check('caso4: filtra pelo id da eleição ativa', upd && upd.filtro.id === 'el7', JSON.stringify(upd));
  const logGravado = escritas.find((e) => e.op === 'insert' && e.tabela === 'sime_logs' && e.payload.acao === 'previsao_minutos_por_eleitor_atualizado');
  check('caso4: registra em sime_logs pra auditoria', !!logGravado, JSON.stringify(escritas));
  await ctx.close();
}

await b.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_previsao.mjs`);
falhas.forEach((f) => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
