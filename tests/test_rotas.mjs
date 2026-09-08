// Testa o módulo novo SIME_rotas.html (04/09/2026) — cadastro de rotas de
// distribuição de urnas, recolhimento de urnas, recolhimento de mídias e
// instalação de seção, com atribuição de seções por rota. Cobre
// especificamente a escrita de mão-dupla pra sime_secoes.rota_id/parada
// (legado, lido por Motorista/Conferente/TV Distribuição) quando a rota tem
// tipo 'distribuicao'/'recolhimento_urna' — e a AUSÊNCIA dessa escrita
// quando a rota só tem 'recolhimento_midia'/'instalacao' (sem consumidor
// legado nenhum).
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
      if(name==='sime_now') return Promise.resolve({ data:'2026-09-04T15:00:00.000Z', error:null });
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
    escritas: [],
    sime_usuarios: [{ id: 'u-maria', nome: 'Maria', perfil: 'coordenador', zona_id: 'z7', ativo: true, auth_user_id: 'auth-maria' }],
    sime_zonas: [{ id: 'z7', numero: 7, estado: 'PI', municipio: 'Campo Maior' }],
    sime_eleicoes: [{ id: 'el7', zona_id: 'z7', turno: 1, ativa: true, nome: 'Eleições 2026' }],
    sime_logs: [],
    sime_secoes: [
      { id: 's1', numero: 30, local_nome: 'Grupo Escolar A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: 'r1', parada: 1, latitude: -4.83, longitude: -42.16 },
      { id: 's2', numero: 31, local_nome: 'Grupo Escolar A', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: 'r1', parada: 2, latitude: null, longitude: null },
      { id: 's3', numero: 63, local_nome: 'Escola B', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: null, longitude: null },
    ],
    sime_rotas: [
      { id: 'r1', zona_id: 'z7', codigo: '001', nome: 'Rota 001', municipios: ['Campo Maior'], tipos: ['distribuicao', 'recolhimento_urna'], itinerario: 'Escola A → Sede', urnas_estimadas: 5, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null },
      { id: 'r2', zona_id: 'z7', codigo: '002', nome: 'Rota 002 mídia', municipios: ['Campo Maior'], tipos: ['recolhimento_midia'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null },
      // Só recolhimento_urna, SEM distribuicao (04/09/2026, achado real:
      // recolhimento de urna é a distribuição invertida, em outro dia — não
      // é mais o mesmo cadastro; deixou de ser tipo "legado" pra sime_secoes.rota_id).
      { id: 'r4', zona_id: 'z7', codigo: '004', nome: 'Rota 004 recolhimento urna', municipios: ['Campo Maior'], tipos: ['recolhimento_urna'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null },
    ],
    sime_rota_secoes: [
      { id: 'rs1', rota_id: 'r1', secao_id: 's1', parada: 1 },
      { id: 'rs2', rota_id: 'r1', secao_id: 's2', parada: 2 },
    ],
    sime_atores: [
      { id: 'a1', nome_completo: 'JOAO MOTORISTA', zona_id: 'z7', ativo: true },
      { id: 'a2', nome_completo: 'MARIA COORDENADORA', zona_id: 'z7', ativo: true },
    ],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  // window.print() abriria um diálogo real do navegador (trava o teste
  // headless) — mesmo stub já usado em test_convocacao_mesarios.mjs, só
  // conta as chamadas.
  await p.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_rotas.html');
  await p.waitForTimeout(400);
  return { p, erros };
}
async function login(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── 1. Login + lista de rotas (tipos, contagem de seções, filtro, busca) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  check('cabeçalho mostra a zona', /7ª Zona/.test(await p.locator('#h-sub').textContent()));

  const txt = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('lista mostra as 2 rotas cadastradas', /Rota 001/.test(txt) && /Rota 002 mídia/.test(txt), txt.slice(0, 400));
  check('Rota 001 mostra os 2 tipos (distribuição + recolhimento de urna)', /Distribuição de urnas/.test(txt) && /Recolhimento de urnas/.test(txt), txt);
  check('Rota 001 mostra 2 seções vinculadas', /2 seção\(ões\) vinculada\(s\)/.test((await p.locator('.import-card:has-text("Rota 001")').textContent())));
  check('Rota 002 mostra 0 seções vinculadas (só tem tipo recolhimento_midia, staging vazio)', /0 seção\(ões\) vinculada\(s\)/.test((await p.locator('.import-card:has-text("Rota 002")').textContent())));
  check('Rota 001 mostra urnas estimadas', /Urnas estimadas: 5/.test(txt));

  await p.selectOption('#rt-filtro-tipo', 'recolhimento_midia');
  await p.waitForTimeout(100);
  const filtrado = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('filtro por tipo: só a Rota 002 (recolhimento de mídia)', /Rota 002/.test(filtrado) && !/Rota 001/.test(filtrado), filtrado.slice(0, 300));
  await p.selectOption('#rt-filtro-tipo', '');

  await p.fill('#rt-busca', '002');
  await p.waitForTimeout(350);
  const buscado = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('busca por código: só a Rota 002', /Rota 002/.test(buscado) && !/Rota 001/.test(buscado), buscado.slice(0, 300));
  await p.fill('#rt-busca', '');
  await p.waitForTimeout(350);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Criar nova rota (só tipo 'instalacao' — sem consumidor legado) ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.click('button:has-text("➕ Nova rota")');
  await p.waitForTimeout(100);
  check('modal de nova rota abre', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));

  await p.fill('#rt-codigo', '040');
  await p.fill('#rt-nome', 'Rota de Instalação Centro');
  await p.fill('#rt-municipios', 'Campo Maior, Jatobá do Piauí');
  await p.check('.rt-tipo-check[value="instalacao"]');
  await p.fill('#rt-itinerario', 'Escola X → Escola Y');
  await p.fill('#rt-urnas', '3');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const ins = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rotas'));
  check('grava a nova rota com zona_id e tipos certos', ins?.payload?.codigo === '040' && JSON.stringify(ins?.payload?.tipos) === JSON.stringify(['instalacao']) && ins?.payload?.zona_id === 'z7', JSON.stringify(ins));
  check('grava os municípios como array (split por vírgula, trimado)', JSON.stringify(ins?.payload?.municipios) === JSON.stringify(['Campo Maior', 'Jatobá do Piauí']), JSON.stringify(ins?.payload?.municipios));
  check('nasce ativa', ins?.payload?.ativo === true);
  // 08/09/2026, pedido direto: "quero poder cadastrar a rota... devendo
  // cadastrar cada um dos locais de votação" — salvar uma rota nova não
  // fecha mais o modal, reabre o MESMO modal já em modo edição (com o
  // título mudando pra "Editar Rota") pra já poder vincular os locais de
  // votação sem precisar reabrir nada.
  check('modal continua aberto, agora em modo edição', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('título do modal muda pra "Editar Rota 040"', /Editar Rota 040/.test(await p.locator('#modal-body .m-title').textContent()));
  check('seção de locais de votação já aparece, pronta pra usar', /Locais de votação/.test(await p.locator('#modal-body').textContent()));

  const txt = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('a rota nova aparece na lista recarregada', /Rota de Instalação Centro/.test(txt) && /Instalação de seção/.test(txt), txt.slice(0, 500));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2.5 Validação: sem tipo marcado, não salva ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);
  await p.click('button:has-text("➕ Nova rota")');
  await p.waitForTimeout(100);
  await p.fill('#rt-codigo', '050');
  await p.fill('#rt-nome', 'Sem tipo');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(100);
  const ins = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rotas' && e.payload.codigo === '050'));
  check('sem nenhum tipo marcado, não grava nada', !ins);
  check('modal continua aberto (não falha em silêncio)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Editar rota existente (troca tipos, desativa) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 002")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);
  check('modal de editar mostra o código no título', /Editar Rota 002/.test(await p.locator('#modal-body .m-title').textContent()));
  check('checkbox do tipo atual já vem marcado', await p.locator('.rt-tipo-check[value="recolhimento_midia"]').isChecked());

  await p.check('.rt-tipo-check[value="distribuicao"]');
  await p.uncheck('#rt-ativo');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r2'));
  check('grava os dois tipos marcados', JSON.stringify((upd?.payload?.tipos || []).sort()) === JSON.stringify(['distribuicao', 'recolhimento_midia']), JSON.stringify(upd?.payload?.tipos));
  check('grava ativo=false', upd?.payload?.ativo === false, JSON.stringify(upd));

  const txt = (await p.locator('.content').textContent());
  check('card mostra "Inativa" depois de desmarcar', /Inativa/.test(txt));
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Toggle ativo direto pelo botão do card ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);
  await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("🚫 Desativar")').click();
  await p.waitForTimeout(150);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1' && 'ativo' in e.payload));
  check('botão "Desativar" grava ativo=false', upd?.payload?.ativo === false, JSON.stringify(upd));
  check('card passa a mostrar "✓ Reativar"', await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("✓ Reativar")').count() === 1);
  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Locais de votação da rota (dentro do modal de Editar) — tipo COM
// consumidor legado (distribuição/recolhimento de urna): adicionar/remover/
// reordenar espelha em sime_secoes.rota_id/parada, pra Motorista/Conferente/
// TV Distribuição continuarem enxergando a mudança. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);
  const modalTxt = await p.locator('#modal-body').textContent();
  check('modal mostra as 2 seções já vinculadas', /30/.test(modalTxt) && /31/.test(modalTxt) && /Grupo Escolar A/.test(modalTxt));
  check('avisa que esta rota também é usada por Motorista/Conferente/TV Distribuição', /também usada por Motorista\/Conferente\/TV Distribuição/.test(modalTxt));

  // Adicionar a seção 63 (ainda sem rota nenhuma).
  await p.fill('#rt-secao-busca', '63');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("63")').click();
  await p.waitForTimeout(200);

  const insJuncao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rota_secoes' && e.payload.secao_id === 's3'));
  check('grava a junção rota↔seção com a próxima parada (3)', insJuncao?.payload?.rota_id === 'r1' && insJuncao?.payload?.parada === 3, JSON.stringify(insJuncao));
  const updLegado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's3'));
  check('ESPELHA em sime_secoes.rota_id/parada (rota tem tipo distribuição/recolhimento de urna)', updLegado?.payload?.rota_id === 'r1' && updLegado?.payload?.parada === 3, JSON.stringify(updLegado));

  const modalTxt2 = await p.locator('#modal-body').textContent();
  check('modal recarregado mostra as 3 seções agora', /63/.test(modalTxt2) && (modalTxt2.match(/✕/g) || []).length >= 3, modalTxt2.replace(/\s+/g, ' ').slice(0, 400));

  // Reordenar: muda a parada da seção 30 pra 9.
  await p.locator('.m-hist-item:has-text("30")').locator('input[type=number]').fill('9');
  await p.locator('.m-hist-item:has-text("30")').locator('input[type=number]').blur();
  await p.waitForTimeout(150);
  const updParadaJuncao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rota_secoes' && e.filtro.secao_id === 's1' && e.payload.parada === 9));
  check('reordenar grava a nova parada na junção', !!updParadaJuncao, JSON.stringify(updParadaJuncao));
  const updParadaLegado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's1' && e.payload.parada === 9));
  check('reordenar também espelha a nova parada no campo legado', !!updParadaLegado, JSON.stringify(updParadaLegado));

  // Remover a seção 31.
  await p.locator('.m-hist-item:has-text("31")').locator('button:has-text("✕")').click();
  await p.waitForTimeout(200);
  const delJuncao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'delete' && e.tabela === 'sime_rota_secoes' && e.filtro.secao_id === 's2'));
  check('remover apaga da junção', !!delJuncao, JSON.stringify(delJuncao));
  const updLimpaLegado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's2' && e.payload.rota_id === null));
  check('remover também limpa rota_id/parada no campo legado', !!updLimpaLegado && updLimpaLegado.payload.parada === null, JSON.stringify(updLimpaLegado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Seções da rota — tipo SEM consumidor legado (recolhimento de
// mídia/instalação): adicionar NÃO deve tocar em sime_secoes.rota_id — essa
// rota não tem relação nenhuma com Motorista/Conferente/TV Distribuição. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 002")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);
  check('não avisa nada sobre Motorista/Conferente (tipo sem consumidor legado)', !/também usada por Motorista/.test(await p.locator('#modal-body').textContent()));

  await p.fill('#rt-secao-busca', '63');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("63")').click();
  await p.waitForTimeout(200);

  const insJuncao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rota_secoes' && e.payload.rota_id === 'r2'));
  check('grava a junção rota↔seção mesmo assim', insJuncao?.payload?.secao_id === 's3', JSON.stringify(insJuncao));
  const updLegado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's3'));
  check('NÃO mexe em sime_secoes (rota só tem recolhimento_midia, sem consumidor legado)', !updLegado, JSON.stringify(updLegado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Mover uma seção de uma rota legada pra OUTRA rota legada avisa que
// ela saiu de onde estava (nunca falha silenciosamente sobre um clobber). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas.push({ id: 'r3', zona_id: 'z7', codigo: '003', nome: 'Rota 003', municipios: ['Campo Maior'], tipos: ['distribuicao'], itinerario: null, urnas_estimadas: null, ativo: true });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  // s1 já está na Rota 001 (r1) — move pra Rota 003 (r3).
  await p.locator('.import-card:has-text("Rota 003")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);
  await p.fill('#rt-secao-busca', '30');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("30")').click();
  await p.waitForTimeout(200);

  const toast = await p.locator('#toast').textContent();
  check('avisa que a seção foi movida de outra rota de distribuição/recolhimento', /estava em outra rota de distribuição\/recolhimento de urna/.test(toast), toast);
  const updLegado = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's1').pop());
  check('sime_secoes.rota_id passa a apontar pra rota nova (r3)', updLegado?.payload?.rota_id === 'r3', JSON.stringify(updLegado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 8. Rota SÓ com tipo recolhimento_urna (sem distribuicao) — 04/09/2026,
// achado real: recolhimento de urna é a rota de distribuição invertida, em
// OUTRO DIA, não a mesma linha — deixou de escrever em sime_secoes.rota_id
// (só 'distribuicao' continua sendo tipo legado). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 004")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);
  check('rota só recolhimento_urna NÃO avisa nada sobre Motorista/Conferente', !/também usada por Motorista/.test(await p.locator('#modal-body').textContent()));

  await p.fill('#rt-secao-busca', '63');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("63")').click();
  await p.waitForTimeout(200);

  const insJuncao = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rota_secoes' && e.payload.rota_id === 'r4'));
  check('grava a junção rota↔seção mesmo assim', insJuncao?.payload?.secao_id === 's3', JSON.stringify(insJuncao));
  const updLegado = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's3'));
  check('NÃO mexe em sime_secoes.rota_id (recolhimento_urna sozinho não é mais tipo legado)', !updLegado, JSON.stringify(updLegado));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 9. Campos novos: partida/destino/horário/responsável — salvar, exibir
// no card, e o <select> de responsável lista os atores da zona. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 002")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);

  const opcoesResponsavel = await p.locator('#rt-responsavel').textContent();
  check('select de responsável lista os atores da zona', /JOAO MOTORISTA/.test(opcoesResponsavel) && /MARIA COORDENADORA/.test(opcoesResponsavel), opcoesResponsavel);

  await p.fill('#rt-partida', 'Sede da 7ª Zona');
  await p.fill('#rt-destino', 'Escola B');
  await p.fill('#rt-hora-saida', '06:30');
  await p.fill('#rt-hora-chegada', '08:00');
  await p.selectOption('#rt-responsavel', 'a1');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r2'));
  check('grava ponto_partida/destino', upd?.payload?.ponto_partida === 'Sede da 7ª Zona' && upd?.payload?.destino === 'Escola B', JSON.stringify(upd));
  check('grava horário de saída/chegada prevista', upd?.payload?.horario_saida === '06:30' && upd?.payload?.horario_chegada_previsto === '08:00', JSON.stringify(upd));
  check('grava o responsável escolhido', upd?.payload?.responsavel_ator_id === 'a1', JSON.stringify(upd));

  const txt = (await p.locator('.import-card:has-text("Rota 002")').textContent()).replace(/\s+/g, ' ');
  check('card mostra partida → destino', /Sede da 7ª Zona → Escola B/.test(txt), txt);
  check('card mostra horário de saída/chegada', /06:30/.test(txt) && /08:00/.test(txt), txt);
  check('card mostra o nome do responsável', /JOAO MOTORISTA/.test(txt), txt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 10. Georreferência: link "Ver no mapa" só aparece pra seção com
// latitude/longitude preenchidas, apontando pro Google Maps certo. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);

  const linkMapa = p.locator('.m-hist-item:has-text("30") a[title="Ver no mapa"]');
  check('seção COM latitude/longitude ganha o link "Ver no mapa"', await linkMapa.count() === 1);
  check('link aponta pro Google Maps com as coordenadas certas', (await linkMapa.getAttribute('href')) === 'https://www.google.com/maps?q=-4.83,-42.16', await linkMapa.getAttribute('href'));
  check('seção SEM latitude/longitude não ganha o link', await p.locator('.m-hist-item:has-text("31") a[title="Ver no mapa"]').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 11. Aviso de conflito de responsável — mesma pessoa escalada em duas
// rotas ATIVAS com horário sobreposto ganha aviso; sem sobreposição, ou
// rota inativa, não avisa. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas.push(
    { id: 'r5', zona_id: 'z7', codigo: '005', nome: 'Rota 005', municipios: ['Campo Maior'], tipos: ['recolhimento_midia'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: '07:00', horario_chegada_previsto: '09:00', responsavel_ator_id: 'a1' },
    { id: 'r6', zona_id: 'z7', codigo: '006', nome: 'Rota 006', municipios: ['Campo Maior'], tipos: ['recolhimento_midia'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: '08:00', horario_chegada_previsto: '10:00', responsavel_ator_id: 'a1' },
    { id: 'r7', zona_id: 'z7', codigo: '007', nome: 'Rota 007', municipios: ['Campo Maior'], tipos: ['recolhimento_midia'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: '10:00', horario_chegada_previsto: '11:00', responsavel_ator_id: 'a1' },
  );
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  // Comparado no texto da página inteira (não por card) — o próprio aviso
  // de conflito de UM card cita o código do OUTRO, então filtrar cards por
  // ".import-card:has-text('Rota 005')" colide com o card da Rota 006
  // (que também menciona "Rota 005" no seu próprio aviso).
  const txt = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('Rota 005 avisa conflito com a Rota 006 (07-09 x 08-10, mesmo responsável)', /Rota 005 — Rota 005[\s\S]*?também está escalado na Rota 006/.test(txt), txt.slice(0, 700));
  check('Rota 007 (10-11, sem sobreposição) não entra em nenhum aviso de conflito', !/também está escalado na Rota 007/.test(txt), txt.slice(0, 700));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 12. Painel de seções sem rota, por tipo — só considera tipos com
// alguma rota ATIVA já cadastrada (instalação, sem nenhuma rota no
// fixture, nunca aparece). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  const txt = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('painel aparece com "Seções sem rota, por tipo"', /Seções sem rota, por tipo/.test(txt), txt.slice(0, 300));
  check('recolhimento de mídia (r2, 0 seção vinculada): 3 sem rota', /Recolhimento de mídias: 3 seção/.test(txt), txt);
  check('distribuição (r1, 2 de 3 seções vinculadas): 1 sem rota', /Distribuição de urnas: 1 seção/.test(txt), txt);
  check('instalação (nenhuma rota cadastrada) NÃO aparece no painel', !/Instalação de seção: \d/.test(txt), txt);

  await p.click(`div[onclick*="rtToggleOrfas('recolhimento_midia')"]`);
  await p.waitForTimeout(100);
  const aberto = (await p.locator('.content').textContent()).replace(/\s+/g, ' ');
  check('expandir mostra a lista de seções órfãs', /63 — Escola B/.test(aberto), aberto.slice(0, 500));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 13. "Ver rota completa no mapa" — só aparece com pelo menos 2 paradas
// com geo, com origin/destination/waypoints corretos. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("✏️ Editar")').click();
  await p.waitForTimeout(100);

  const link = p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")');
  check('link "Ver rota completa" aparece com as 2 paradas geolocalizadas', await link.count() === 1);
  const href = await link.getAttribute('href');
  check('URL usa a 1ª parada como origin e a última como destination', href.includes('origin=-4.83,-42.16') && href.includes('destination=-4.831,-42.161'), href);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 14. Gerador de rota de recolhimento a partir de uma rota de
// distribuição — abre rascunho pré-preenchido (partida/destino invertidos),
// e salvar copia as paradas da origem em ordem INVERTIDA. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.ponto_partida = 'Sede da 7ª Zona'; r1.destino = 'Escola A';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  check('Rota 001 (tipo distribuição) tem o botão de gerar recolhimento', await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("🔄 Gerar rota de recolhimento")').count() === 1);
  await p.locator('.import-card:has-text("Rota 001")').locator('button:has-text("🔄 Gerar rota de recolhimento")').click();
  await p.waitForTimeout(100);

  check('abre como "Nova rota", com o aviso de rascunho gerado', /Nova rota/.test(await p.locator('#modal-body .m-title').textContent()) && /Rascunho de recolhimento gerado a partir da Rota 001/.test(await p.locator('#modal-body').textContent()));
  check('nome pré-preenchido referenciando a rota de origem', (await p.locator('#rt-nome').inputValue()) === 'Recolhimento — Rota 001');
  check('partida/destino vêm INVERTIDOS (destino da origem vira partida, e vice-versa)', (await p.locator('#rt-partida').inputValue()) === 'Escola A' && (await p.locator('#rt-destino').inputValue()) === 'Sede da 7ª Zona');
  check('tipo "recolhimento_urna" já vem marcado', await p.locator('.rt-tipo-check[value="recolhimento_urna"]').isChecked());

  await p.fill('#rt-codigo', '099');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(200);

  const insRota = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rotas' && e.payload.codigo === '099'));
  check('grava rota_origem_id apontando pra Rota 001 (r1)', insRota?.payload?.rota_origem_id === 'r1', JSON.stringify(insRota));

  const insParadas = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'insert' && e.tabela === 'sime_rota_secoes' && Array.isArray(e.payload)));
  check('copia as 2 paradas da origem em lote', insParadas?.payload?.length === 2, JSON.stringify(insParadas));
  const paradaS1 = insParadas?.payload?.find(x => x.secao_id === 's1');
  const paradaS2 = insParadas?.payload?.find(x => x.secao_id === 's2');
  check('ordem INVERTIDA: s2 (última da origem) vira a 1ª parada do retorno, s1 vira a última', paradaS2?.parada === 1 && paradaS1?.parada === 2, JSON.stringify({ paradaS1, paradaS2 }));

  check('modal reabre em modo edição da rota nova, já mostrando as 2 paradas copiadas', /Editar Rota 099/.test(await p.locator('#modal-body .m-title').textContent()) && /2 local\(is\) nesta rota/.test(await p.locator('#modal-body').textContent()));

  // "Rota 001" sozinho agora casa com DOIS cards (o original e "Rota 099 —
  // Recolhimento — Rota 001", que contém a mesma substring) — filtra pelo
  // título completo do card original pra não colidir.
  const cardOrigem = p.locator('.import-card:has-text("Rota 001 — Rota 001")');
  check('card da Rota 001 passa a avisar que já tem recolhimento gerado', /Já tem recolhimento gerado: Rota 099/.test(await cardOrigem.textContent()));
  check('e o botão de gerar some da Rota 001 (evita gerar duas vezes)', await cardOrigem.locator('button:has-text("🔄 Gerar rota de recolhimento")').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 15. Impressão da rota pro motorista — ficha com paradas em ordem,
// coordenadas (quando têm geo) e contato do responsável; sem popup
// (window.print() direto), com log de auditoria. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.responsavel_ator_id = 'a1';
  r1.ponto_partida = 'Sede da 7ª Zona'; r1.destino = 'Escola A';
  r1.horario_saida = '06:30'; r1.horario_chegada_previsto = '08:00';
  m.sime_atores.find(a => a.id === 'a1').telefone_whatsapp = '5586999998888';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  check('imprimir a ficha chama window.print()', await p.evaluate(() => window.__printCalls) === 1);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('ficha mostra código e nome da rota', /Ficha de Rota — 001 — Rota 001/.test(printHtml), printHtml.slice(0, 300));
  check('ficha mostra partida/destino/horários', /Sede da 7ª Zona/.test(printHtml) && /06:30/.test(printHtml) && /Escola A/.test(printHtml) && /08:00/.test(printHtml), printHtml);
  check('ficha mostra o responsável com telefone formatado', /JOAO MOTORISTA/.test(printHtml) && /\(86\) 99999-8888/.test(printHtml), printHtml);
  check('ficha lista as 2 paradas em ordem, com coordenadas de quem tem geo', /Grupo Escolar A[\s\S]*?-4\.83, -42\.16[\s\S]*?Grupo Escolar A[\s\S]*?sem geo/.test(printHtml.replace(/\s+/g, ' ')), printHtml);

  const logImpressao = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_ficha_impressa'));
  check('grava log de auditoria da impressão', logImpressao?.payload?.rota_id === 'r1' && logImpressao?.payload?.codigo === '001' && logImpressao?.payload?.quantidade === 2, JSON.stringify(logImpressao));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 16. Status operacional de Dia D (sime_rotas_estado/sime_rotas_urnas,
// gravado por Conferente/TV Distribuição) — só leitura, mostrado no card
// quando existe uma linha pra rota+eleição ativa; rota sem estado nenhum
// não mostra nada (nunca fabrica um "aguardando" que ninguém registrou). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas_estado = [
    { id: 're1', eleicao_id: 'el7', rota_id: 'r1', status: 'embarcando', conferente_nome: 'CARLOS CONFERENTE', ts_aberta: '2026-09-08T09:00:00.000Z', ts_pronta: null, ts_saiu: null, alerta: false },
  ];
  m.sime_rotas_urnas = [
    { id: 'u1', rota_estado_id: 're1', secao_id: 's1', embarcada: true },
    { id: 'u2', rota_estado_id: 're1', secao_id: 's2', embarcada: false },
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  const cardR1 = await p.locator('.import-card:has-text("Rota 001 — Rota 001")').textContent();
  check('Rota 001 mostra o status operacional (Embarcando)', /Embarcando/.test(cardR1), cardR1);
  check('mostra contagem de embarque (1 de 2 seções)', /1\/2 embarcada\(s\)/.test(cardR1), cardR1);
  check('mostra o nome do conferente', /Conferente: CARLOS CONFERENTE/.test(cardR1), cardR1);
  check('mostra o marco "aberta HH:MM"', /aberta \d{2}:\d{2}/.test(cardR1), cardR1);

  const cardR2 = await p.locator('.import-card:has-text("Rota 002")').textContent();
  check('Rota 002 (sem sime_rotas_estado) não mostra status operacional nenhum', !/Dia D:/.test(cardR2), cardR2);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
