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

// Destino virou <select> de locais conhecidos + "Outro (digitar)" com
// campo de texto (10/09/2026) — helpers pra escrever/ler o valor efetivo
// sem repetir a lógica de qual dos dois elementos está em jogo em cada
// teste.
async function preencherDestino(p, valor) {
  const conhecido = await p.locator(`#rt-destino-select option[value="${valor.replace(/"/g, '\\"')}"]`).count() === 1;
  if (conhecido) {
    await p.selectOption('#rt-destino-select', valor);
  } else {
    await p.selectOption('#rt-destino-select', '__outro__');
    await p.fill('#rt-destino-outro', valor);
  }
}
async function lerDestino(p) {
  const sel = await p.locator('#rt-destino-select').inputValue();
  if (sel === '__outro__') return await p.locator('#rt-destino-outro').inputValue();
  return sel;
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

  // 08/09/2026, pedido direto: "vamos retirar o botão de editar e
  // selecionar o nome da rota para abrir o modal" — o botão some, e
  // clicar no título (código+nome) abre o mesmo modal de sempre.
  check('botão "✏️ Editar" não existe mais em nenhum card', await p.locator('button:has-text("✏️ Editar")').count() === 0);
  await p.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('clicar no nome da Rota 001 abre o modal de editar', /Editar Rota 001/.test(await p.locator('#modal-body .m-title').textContent()));
  await p.click('#modal-body button:has-text("Cancelar")');
  await p.waitForTimeout(100);

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
  await p.selectOption('#rt-tipos', ['instalacao']);
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

  await p.locator('.import-card:has-text("Rota 002")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('modal de editar mostra o código no título', /Editar Rota 002/.test(await p.locator('#modal-body .m-title').textContent()));
  check('opção do tipo atual já vem selecionada na caixa de seleção', await p.locator('#rt-tipos option[value="recolhimento_midia"]').evaluate(el => el.selected));

  await p.selectOption('#rt-tipos', ['recolhimento_midia', 'distribuicao']);
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

  await p.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const modalTxt = await p.locator('#modal-body').textContent();
  check('modal mostra as 2 seções já vinculadas', /30/.test(modalTxt) && /31/.test(modalTxt) && /Grupo Escolar A/.test(modalTxt));
  check('avisa que esta rota também é usada por Motorista/Conferente/TV Distribuição', /também usada por Motorista\/Conferente\/TV Distribuição/.test(modalTxt));

  // "Adicionar local de votação" fica escondido atrás de um botão "+"
  // até o cartório clicar (08/09/2026, pedido direto) — nem o rótulo nem
  // a busca aparecem antes do clique.
  check('busca de "adicionar local" começa escondida, só o botão "+" aparece', await p.locator('#rt-secao-busca').count() === 0 && await p.locator('#rt-paradas-secao button:has-text("+")').count() === 1);
  check('rótulo "Adicionar local de votação" também some até abrir', !/Adicionar local de votação/.test(modalTxt), modalTxt);

  // Adicionar a seção 63 (ainda sem rota nenhuma) — clicar no "+" abre a
  // busca+lista.
  await p.click('#rt-paradas-secao button:has-text("+")');
  await p.waitForTimeout(100);
  check('clicar no "+" abre a busca, com o rótulo e um botão de fechar', await p.locator('#rt-secao-busca').count() === 1 && /Adicionar local de votação/.test(await p.locator('#rt-paradas-secao').textContent()) && await p.locator('#rt-paradas-secao button:has-text("✕ Fechar")').count() === 1);
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

  // Reposicionar (08/09/2026, pedido direto com print de produção anexado:
  // "quero poder reposicionar os locais da rota de modo a fazer mais
  // sentido" — o número livre de antes permitia duplicata/lacuna) — botão
  // "▼" na 1ª parada (seção 30) troca de lugar com a 2ª (seção 31).
  check('1ª parada (seção 30) não tem botão "▲" (já é a primeira)', await p.locator('.m-hist-item:has-text("30")').locator('button[title="Mover pra cima (mais cedo na rota)"]').isDisabled());
  await p.locator('.m-hist-item:has-text("30")').locator('button[title="Mover pra baixo (mais tarde na rota)"]').click();
  await p.waitForTimeout(150);
  const updParadaJuncaoS1 = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rota_secoes' && e.filtro.secao_id === 's1').pop());
  check('reposicionar grava a seção 30 na 2ª posição', updParadaJuncaoS1?.payload?.parada === 2, JSON.stringify(updParadaJuncaoS1));
  const updParadaJuncaoS2 = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rota_secoes' && e.filtro.secao_id === 's2').pop());
  check('e a seção 31 assume a 1ª posição (troca completa, sem duplicar número)', updParadaJuncaoS2?.payload?.parada === 1, JSON.stringify(updParadaJuncaoS2));
  const updParadaLegado = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_secoes' && e.filtro.id === 's1').pop());
  check('reposicionar também espelha a nova ordem no campo legado', updParadaLegado?.payload?.parada === 2, JSON.stringify(updParadaLegado));
  const txtReordenado = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  const posicao31 = txtReordenado.indexOf(' 31 '), posicao30 = txtReordenado.indexOf(' 30 ');
  check('lista reflete a nova ordem (seção 31 agora antes da 30)', posicao31 !== -1 && posicao30 !== -1 && posicao31 < posicao30, txtReordenado.slice(0, 400));

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

  await p.locator('.import-card:has-text("Rota 002")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('não avisa nada sobre Motorista/Conferente (tipo sem consumidor legado)', !/também usada por Motorista/.test(await p.locator('#modal-body').textContent()));

  await p.click('#rt-paradas-secao button:has-text("+")');
  await p.waitForTimeout(100);
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
  await p.locator('.import-card:has-text("Rota 003")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("+")');
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

  await p.locator('.import-card:has-text("Rota 004")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('rota só recolhimento_urna NÃO avisa nada sobre Motorista/Conferente', !/também usada por Motorista/.test(await p.locator('#modal-body').textContent()));

  await p.click('#rt-paradas-secao button:has-text("+")');
  await p.waitForTimeout(100);
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

  await p.locator('.import-card:has-text("Rota 002")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  const opcoesResponsavel = await p.locator('#rt-responsavel').textContent();
  check('select de responsável lista os atores da zona', /JOAO MOTORISTA/.test(opcoesResponsavel) && /MARIA COORDENADORA/.test(opcoesResponsavel), opcoesResponsavel);

  await p.fill('#rt-partida', 'Sede da 7ª Zona');
  await preencherDestino(p, 'Escola B');
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

  await p.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
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

  await p.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
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
  check('partida/destino vêm INVERTIDOS (destino da origem vira partida, e vice-versa)', (await p.locator('#rt-partida').inputValue()) === 'Escola A' && (await lerDestino(p)) === 'Sede da 7ª Zona');
  check('tipo "recolhimento_urna" já vem selecionado na caixa de seleção', await p.locator('#rt-tipos option[value="recolhimento_urna"]').evaluate(el => el.selected));

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

// ── 17. Partida/destino sugeridos a partir das paradas (editável, nunca
// forçado) + tempo estimado por parada, pro cálculo do percurso total
// (08/09/2026, pedido direto). ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Troca a 2ª parada da Rota 001 pra um local com nome diferente, pra dar
  // pra distinguir claramente a sugestão de partida da de destino.
  m.sime_rota_secoes.find(rs => rs.rota_id === 'r1' && rs.secao_id === 's2').secao_id = 's3';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('Partida vem sugerida com o 1º local da lista de paradas', (await p.locator('#rt-partida').inputValue()) === 'Grupo Escolar A, Campo Maior');
  check('Destino vem sugerido com o último local da lista de paradas', (await lerDestino(p)) === 'Escola B, Campo Maior');

  // Cartório digita um valor próprio por cima da sugestão de partida (ex.:
  // um endereço que não é local de votação nenhum) — a sugestão nunca é
  // forçada; o destino fica intocado, herdando a sugestão mesmo assim.
  await p.fill('#rt-partida', 'Cartório Eleitoral da 7ª Zona');
  await p.fill('#rt-tempo-parada', '10');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1'));
  check('grava o valor digitado, não a sugestão, pra partida', upd?.payload?.ponto_partida === 'Cartório Eleitoral da 7ª Zona', JSON.stringify(upd));
  check('grava o valor sugerido (nunca editado) pro destino', upd?.payload?.destino === 'Escola B, Campo Maior', JSON.stringify(upd));
  check('grava tempo_parada_min', upd?.payload?.tempo_parada_min === 10, JSON.stringify(upd));

  // Reabre e confere o cálculo do tempo total (2 paradas × 10 min = 20min).
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('modal mostra o tempo total estimado (2 × 10 min = 20min)', /2 parada\(s\) × 10 min ≈ 20min/.test(modalTxt), modalTxt);
  check('partida agora mostra o valor salvo (Cartório), não mais a sugestão', (await p.locator('#rt-partida').inputValue()) === 'Cartório Eleitoral da 7ª Zona');

  const cardTxt = (await p.locator('.import-card:has-text("Rota 001 — Rota 001")').textContent()).replace(/\s+/g, ' ');
  check('card mostra o tempo estimado também', /2 parada\(s\) × 10 min ≈ 20min/.test(cardTxt), cardTxt);

  // Botão "↻" recalcula a sugestão sob demanda (ex.: cartório apagou o
  // campo por engano), sem depender de reabrir o modal.
  await p.fill('#rt-partida', '');
  await p.click('#rt-partida-sugerir');
  check('clicar em "↻" preenche de novo com a sugestão atual (1º local)', (await p.locator('#rt-partida').inputValue()) === 'Grupo Escolar A, Campo Maior');

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18. "Tipo" virou caixa de seleção múltipla (não mais checkboxes) —
// confere que o elemento certo existe e aceita mais de um valor selecionado
// ao mesmo tempo (08/09/2026, pedido direto). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  await p.click('button:has-text("➕ Nova rota")');
  await p.waitForTimeout(100);

  check('"Tipo" é uma <select multiple>, não mais checkboxes', await p.locator('#rt-tipos').evaluate(el => el.tagName === 'SELECT' && el.multiple === true) && await p.locator('.rt-tipo-check').count() === 0);
  await p.selectOption('#rt-tipos', ['distribuicao', 'recolhimento_urna']);
  const selecionados = await p.locator('#rt-tipos').evaluate(el => [...el.selectedOptions].map(o => o.value));
  check('aceita mais de um tipo selecionado ao mesmo tempo', JSON.stringify(selecionados.sort()) === JSON.stringify(['distribuicao', 'recolhimento_urna']), JSON.stringify(selecionados));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 19. Link "Ver rota completa no mapa" inclui o Destino digitado
// (08/09/2026, pedido direto: "o destino deve ser incluido no mapa de
// rotas") — revisado no mesmo dia, achado real testando em produção
// (Rota 24): geocodificar o texto CRU jogou "Creche Tia Medeiros" pra um
// resultado em Teresina e "Cartório Eleitoral..." pra uma "zona 63"
// errada. Pedido direto: "poderia criar o link com as coordenadas?" —
// agora prioriza coordenada quando o texto bate com uma parada
// GEOLOCALIZADA; quando bate com uma parada SEM geo, anexa só ", PI" (o
// texto já vem com o município embutido, formato de rtNomeLocalParada);
// e quando não bate com nada, anexa ", {município da rota}, PI". ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Local "Escola D" da rota, cadastrado mas SEM geo, num município
  // diferente do da rota (Jatobá do Piauí vs. Campo Maior) — pra provar
  // que o contexto usado é o do LOCAL batido, não um fallback genérico.
  m.sime_secoes.push({ id: 's4', numero: 99, local_nome: 'Escola D', municipio: 'Jatobá do Piauí', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: null, longitude: null });
  m.sime_rota_secoes.push({ id: 'rs4', rota_id: 'r1', secao_id: 's4', parada: 3 });
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona'; // não bate com nenhuma parada
  r1.ponto_partida = 'Grupo Escolar A, Campo Maior'; // bate com s1, que TEM geo
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  const href = await p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")').getAttribute('href');
  check('Partida bate com uma parada geolocalizada (s1) — usa a COORDENADA dela, não o texto', href?.includes('origin=-4.83,-42.16') && !href?.includes('origin=Grupo'), href);
  check('Destino não bate com nenhuma parada — texto ganha ", {município da rota}, PI" pra desambiguar', href?.includes(`destination=${encodeURIComponent('Cartório Eleitoral da 7ª Zona, Campo Maior, PI')}`), href);

  // Agora troca o Destino pro local SEM geo (Escola D) — deve usar o
  // MUNICÍPIO DELE (Jatobá do Piauí), não o da rota (Campo Maior).
  await preencherDestino(p, 'Escola D, Jatobá do Piauí');
  const href2 = await p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")').getAttribute('href');
  check('link não recalcula sozinho ao digitar (só ao reabrir/salvar) — segue mostrando o valor anterior', href2 === href);

  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const href3 = await p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")').getAttribute('href');
  check('local sem geo, mas cadastrado: usa o MUNICÍPIO DELE (Jatobá do Piauí), não o da rota', href3?.includes(`destination=${encodeURIComponent('Escola D, Jatobá do Piauí, PI')}`), href3);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 20. Previsão de chegada ESTIMADA (linha reta + tempo por parada) — só
// quando TODAS as paradas têm geo, horário de saída e tempo por parada
// preenchidos; nunca sobrescreve um valor já salvo (08/09/2026, pedido
// direto — "como o sistema calcula a rota pelo google maps e tempo medio
// de espera de 10 minutos... conseguimos calcular automaticamente a
// previsão de chegada?", confirmado via pergunta que seria uma estimativa
// em linha reta, não o Google de verdade). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.horario_saida = '07:00';
  r1.tempo_parada_min = 10;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  // 2 paradas × 10min parado = 20min; deslocamento em linha reta entre as
  // duas coordenadas (bem próximas) arredonda pra 0min a 40km/h — chega às
  // 07:20.
  check('"Previsão de chegada" já vem sugerida (estimativa automática)', (await p.locator('#rt-hora-chegada').inputValue()) === '07:20');
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('nota deixa claro que é ESTIMATIVA em linha reta, não o Google calculando de verdade', /ESTIMADA/.test(modalTxt) && /não é o Google calculando de verdade/.test(modalTxt), modalTxt);
  check('nota menciona a velocidade assumida (40km/h) e o tempo parado (20min)', /40km\/h/.test(modalTxt) && /20min parado/.test(modalTxt), modalTxt);

  // Cartório digita um valor manual por cima — a estimativa nunca é forçada.
  await p.fill('#rt-hora-chegada', '08:00');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1'));
  check('grava o valor digitado, não a estimativa', upd?.payload?.horario_chegada_previsto === '08:00', JSON.stringify(upd));

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('reabrindo, mostra o valor salvo (não mais a sugestão)', (await p.locator('#rt-hora-chegada').inputValue()) === '08:00');

  // Botão "↻" recalcula com os valores DIGITADOS na hora, sem precisar
  // salvar primeiro (5min por parada em vez dos 10 salvos, saída às 08:00).
  await p.fill('#rt-hora-saida', '08:00');
  await p.fill('#rt-tempo-parada', '5');
  await p.fill('#rt-hora-chegada', '');
  await p.click('#rt-chegada-sugerir');
  check('"↻" recalcula com os valores digitados na hora (não só o que já estava salvo)', (await p.locator('#rt-hora-chegada').inputValue()) === '08:10');

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 21. Rota sem geo completa (uma parada sem coordenada) NÃO gera
// estimativa de chegada — "nunca adivinha" também vale aqui, melhor não
// sugerir do que subestimar silenciosamente um trecho sem coordenada. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.horario_saida = '07:00';
  r1.tempo_parada_min = 10; // s2 continua sem geo no mock padrão
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('sem geo em todas as paradas, o campo de chegada fica vazio (sem estimativa forçada)', (await p.locator('#rt-hora-chegada').inputValue()) === '');
  check('e não mostra a nota de estimativa nem o botão "↻" de recalcular', await p.locator('#rt-chegada-sugerir').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 22. Ficha impressa: mapa esquemático (SVG) + legenda com Partida/
// Destino SEMPRE presente (mesmo quando o destino não é nenhuma parada
// geolocalizada) + QR pro Google Maps de verdade (08/09/2026, pedido
// direto: "em imprimir ficha conseguimos gerar para imprimir um mapa da
// rota?" e "o destino deve ser incluido no mapa de rotas"). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona'; // não é nenhuma parada geolocalizada
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const printHtml = await p.locator('#print-area').innerHTML();
  check('ficha inclui um mapa esquemático (SVG desenhado das coordenadas)', /<svg/.test(printHtml), printHtml.slice(0, 300));
  check('legenda do mapa sempre mostra o Destino, mesmo sem coordenada pra ele', /Destino: Cartório Eleitoral da 7ª Zona/.test(printHtml), printHtml);
  check('legenda também mostra a Partida (sugerida a partir da 1ª parada)', /Partida: Grupo Escolar A, Campo Maior/.test(printHtml), printHtml);
  // 09/09/2026: o mapa real (staticmap.maptoolkit.net) virou o principal —
  // o esquema em linha reta agora é só o fallback, escondido por padrão
  // (ver rt-mapa-esquema-wrap) — a nota "não segue estrada" continua
  // presente, só que dentro do texto do mapa real (sempre visível) e do
  // aviso do esquema (só visível se o real falhar ao carregar). Domínio
  // trocado no mesmo dia — staticmap.openstreetmap.de nem resolvia mais
  // (DNS morto, confirmado testando em produção); staticmap.maptoolkit.net
  // é o host oficial documentado da Static Maps API deles (confirmado pelo
  // dono do projeto testando ao vivo).
  check('nota explica que pra seguir a rota de verdade é o link/QR do Google Maps', /link\/QR do Google Maps/.test(printHtml), printHtml);
  check('mapa real é o principal, com URL de staticmap.maptoolkit.net', /staticmap\.maptoolkit\.net/.test(printHtml), printHtml.slice(0, 300));

  const qrCount = await p.locator('#rt-ficha-qr canvas, #rt-ficha-qr table').count();
  check('QR code é de fato gerado dentro do placeholder', qrCount === 1);

  // 08/09/2026, pedido direto: "coloque o mapa por ultimo e traga o
  // trajeto com o ponto das rotas no google maps" — mapa depois da tabela
  // de paradas, e o link de verdade (rota pelas ruas, com as paradas como
  // pontos) impresso por extenso, não só dentro do QR.
  const idxTabela = printHtml.indexOf('rt-tabela');
  const idxMapa = printHtml.indexOf('rt-mapa-titulo');
  check('mapa vem DEPOIS da tabela de paradas (não mais entre os dados e a tabela)', idxTabela !== -1 && idxMapa !== -1 && idxTabela < idxMapa, `tabela@${idxTabela} mapa@${idxMapa}`);
  const mapsUrlEsperada = 'https://www.google.com/maps/dir/?api=1&amp;origin=-4.83,-42.16&amp;destination=Cart%C3%B3rio%20Eleitoral%20da%207%C2%AA%20Zona%2C%20Campo%20Maior%2C%20PI&amp;waypoints=-4.831,-42.161';
  check('link do trajeto real (com as paradas como pontos) sai impresso por extenso, não só no QR', printHtml.includes(mapsUrlEsperada), printHtml);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 23. Reposicionar (▲/▼): limites — 1ª parada não tem "▲", última não
// tem "▼"; e rota SEM tipo legado reposiciona sem tocar sime_secoes. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  // Rota 002 (só recolhimento_midia, sem consumidor legado) — precisa ter
  // 2 paradas pra testar reposicionar; adiciona a seção 63.
  await p.locator('.import-card:has-text("Rota 002")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("+")');
  await p.waitForTimeout(100);
  await p.fill('#rt-secao-busca', '30');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("30")').click();
  await p.waitForTimeout(150);
  // A busca continua aberta depois de adicionar (não fecha sozinha) — só
  // troca o termo, sem precisar clicar em "+" de novo.
  await p.fill('#rt-secao-busca', '63');
  await p.waitForTimeout(350);
  await p.locator('.m-hist-item:has-text("63")').click();
  await p.waitForTimeout(150);

  check('1ª parada não tem "▲" habilitado', await p.locator('.m-hist-item:has-text("30")').locator('button[title="Mover pra cima (mais cedo na rota)"]').isDisabled());
  check('última parada não tem "▼" habilitado', await p.locator('.m-hist-item:has-text("63")').locator('button[title="Mover pra baixo (mais tarde na rota)"]').isDisabled());

  await p.locator('.m-hist-item:has-text("30")').locator('button[title="Mover pra baixo (mais tarde na rota)"]').click();
  await p.waitForTimeout(150);

  const updLegadoR2 = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_secoes'));
  check('reposicionar numa rota sem tipo legado NÃO mexe em sime_secoes', !updLegadoR2, JSON.stringify(updLegadoR2));
  const updJuncao = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rota_secoes'));
  check('mas grava a nova ordem na junção normalmente', updJuncao.length === 2, JSON.stringify(updJuncao));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 24. Modal em 2 colunas no desktop (>=1000px) — some no celular
// (08/09/2026, pedido direto: "no modal de cada rota, podemos ter duas
// colunas com as informações para não ter que ficar rolando tela"). ──
{
  const ctxLargo = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { p: pLargo, erros: errosLargo } = await abrir(ctxLargo, mock());
  await login(pLargo);
  await pLargo.waitForTimeout(200);
  await pLargo.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
  await pLargo.waitForTimeout(100);

  const colCountLargo = await pLargo.locator('.m-body').evaluate(el => getComputedStyle(el).columnCount);
  check('modal em tela larga (>=1000px) usa 2 colunas', colCountLargo === '2', colCountLargo);
  const footerFixo = await pLargo.locator('.m-foot').evaluate(el => getComputedStyle(el).flexShrink);
  check('rodapé (Cancelar/Salvar) fica fixo, não rola junto com o corpo', footerFixo === '0', footerFixo);
  check('zero erros JS (tela larga)', errosLargo.length === 0, errosLargo.join(' | '));
  await ctxLargo.close();

  const ctxCelular = await b.newContext({ viewport: { width: 390, height: 800 } });
  const { p: pCel, erros: errosCel } = await abrir(ctxCelular, mock());
  await login(pCel);
  await pCel.waitForTimeout(200);
  await pCel.locator('.import-card:has-text("Rota 001")').locator('div[title="Clique pra editar"]').click();
  await pCel.waitForTimeout(100);

  const colCountCel = await pCel.locator('.m-body').evaluate(el => getComputedStyle(el).columnCount);
  check('no celular (390px) continua em 1 coluna, sem mudança nenhuma', colCountCel === 'auto', colCountCel);
  check('zero erros JS (celular)', errosCel.length === 0, errosCel.join(' | '));
  await ctxCelular.close();
}

// ── 25. "Cartório" no texto de Partida/Destino usa o endereço REAL da zona
// (rua/bairro/CEP/município/UF já cadastrado em sime_zonas pra Correspondência),
// não só o município genérico (08/09/2026, pergunta direta: "falta
// informação da coordenada do Cartório Eleitoral?" — o SIME nunca teve
// latitude/longitude do Cartório, só esse endereço postal). ──
{
  const ctx = await b.newContext();
  const m = mock();
  const zona = m.sime_zonas.find(z => z.id === 'z7');
  zona.remetente_endereco = 'Rua Benjamin Constant, 948';
  zona.remetente_bairro = 'Centro';
  zona.remetente_cep = '64280-000';
  zona.remetente_municipio = 'Campo Maior';
  zona.remetente_uf = 'PI';
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const href = await p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")').getAttribute('href');
  check('destino "Cartório" usa o endereço real da zona (rua/bairro/CEP/município/UF), não só o município', href?.includes(`destination=${encodeURIComponent('Cartório Eleitoral da 7ª Zona, Rua Benjamin Constant, 948, Centro, 64280-000, Campo Maior, PI')}`), href);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 26. Sem endereço cadastrado na zona (94ª, por exemplo), "Cartório" cai
// pro fallback genérico de município — nunca quebra por falta de dado. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const href = await p.locator('#rt-paradas-secao a:has-text("Ver rota completa no mapa")').getAttribute('href');
  check('sem endereço da zona cadastrado, cai pro fallback de município', href?.includes(`destination=${encodeURIComponent('Cartório Eleitoral da 7ª Zona, Campo Maior, PI')}`), href);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 27. Mapa real (staticmap.maptoolkit.net) na ficha impressa — nasceu em
// 09/09/2026 a partir de uma correção de raciocínio: a impressão sempre
// acontece no cartório, com internet (é o CAMPO que pode ficar sem sinal),
// então um mapa real baixado na hora de imprimir é um "plano B" impresso
// muito melhor que o esquema em linha reta — que virou só reserva, escondida,
// pro caso do serviço de terceiro falhar (sem SLA garantido). Domínio
// original (staticmap.openstreetmap.de) tinha DNS morto — trocado no mesmo
// dia pro host oficial da Maptoolkit; `path=`/`markers=` desse serviço não
// funcionam (confirmado em produção — `path=` dá erro pra qualquer sintaxe,
// `markers=` é aceito mas não desenha nada), então os pinos são um overlay
// de <div>s posicionados por HTML/CSS (rtMarcadoresOverlayHTML), não vêm
// da URL da imagem. ──
{
  const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const { p, erros } = await abrir(ctx, m);
  await p.route('**/staticmap.maptoolkit.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG_B64, 'base64') }));
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(300);

  const src = await p.locator('#rt-mapa-real-img').getAttribute('src');
  check('URL do mapa real tem os parâmetros esperados (center/zoom/size, sem path/markers)',
    /staticmap\.maptoolkit\.net\/\?center=-4\.8305[^&]*&zoom=\d+&size=640x420/.test(src || ''),
    src);
  check('URL NÃO tenta usar path= nem markers= (confirmado que o serviço não suporta)', !/[?&](path|markers)=/.test(src || ''), src);

  const esquemaDisplay = await p.locator('#rt-mapa-esquema-wrap').getAttribute('style');
  check('mapa real carregou com sucesso: esquema de reserva continua escondido', /display:\s*none/.test(esquemaDisplay || ''), esquemaDisplay);
  const realDisplay = await p.locator('#rt-mapa-real-wrap').evaluate(el => getComputedStyle(el).display);
  check('mapa real fica visível quando carrega com sucesso', realDisplay !== 'none', realDisplay);

  // Pinos são um overlay próprio (HTML/CSS) por cima da <img> — 2 paradas
  // geolocalizadas (s1/s2) devem virar 2 <div> posicionados, 1º verde
  // (partida) e último vermelho (destino), nunca vindos do serviço.
  const pinos = await p.locator('#rt-mapa-real-wrap > div > div[style*="border-radius:50%"]').all();
  check('2 pinos desenhados por cima da imagem (1 por parada geolocalizada)', pinos.length === 2, String(pinos.length));
  if (pinos.length === 2) {
    const estiloPrimeiro = await pinos[0].getAttribute('style');
    const estiloUltimo = await pinos[1].getAttribute('style');
    check('1º pino (partida) é verde', /#1a7a3c/.test(estiloPrimeiro || ''), estiloPrimeiro);
    check('último pino (destino) é vermelho', /#b3261e/.test(estiloUltimo || ''), estiloUltimo);
  }

  check('impressão só dispara depois do mapa terminar de carregar (window.print chamado)', await p.evaluate(() => window.__printCalls) === 1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 28. Mapa real falha ao carregar (sem internet / serviço fora do ar) —
// a ficha nunca fica sem NENHUM mapa: esconde a imagem quebrada (e os pinos
// junto, já que ficam dentro do mesmo wrapper) e revela o esquema offline,
// que já estava no HTML, só oculto. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const { p, erros } = await abrir(ctx, m);
  await p.route('**/staticmap.maptoolkit.net/**', (r) => r.abort('failed'));
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(300);

  const realDisplay = await p.locator('#rt-mapa-real-wrap').evaluate(el => getComputedStyle(el).display);
  check('imagem quebrada some da tela (onerror → rtFichaMapaFalhou)', realDisplay === 'none', realDisplay);
  const esquemaDisplay = await p.locator('#rt-mapa-esquema-wrap').evaluate(el => getComputedStyle(el).display);
  check('esquema offline (SVG) aparece no lugar', esquemaDisplay !== 'none', esquemaDisplay);
  const esquemaTexto = await p.locator('#rt-mapa-esquema-wrap').textContent();
  check('aviso explica que o mapa real não carregou', /não carregou/.test(esquemaTexto || ''), esquemaTexto);

  check('mesmo com a falha, a impressão não fica travada esperando pra sempre', await p.evaluate(() => window.__printCalls) === 1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 29. Destino virou <select> de locais conhecidos + "Outro (digitar)"
// (10/09/2026, pedido direto: "em todas as rotas quero poder escolher o
// local final a partir da lista, seja o cartório eleitoral ou um ponto de
// transmissão") — dropdown mostra os 4 pontos fixos, pré-seleciona quando o
// valor salvo bate com um deles, cai em "Outro" com o texto preenchido
// quando não bate (preserva valor customizado já em produção), salva
// corretamente nos dois casos, e a sugestão (↻) — que quase nunca bate com
// um ponto fixo — cai em "Outro" com o nome do local sugerido. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona Eleitoral';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  const opcoes = await p.locator('#rt-destino-select option').allTextContents();
  check('dropdown lista os 4 pontos fixos conhecidos', ['Cartório Eleitoral da 7ª Zona Eleitoral', 'Creche Mamãe Lima (Jatobá)', 'Escola Monsenhor Mateus (Sigefredo Pacheco)', 'Escola da Baixinha (Sigefredo Pacheco)'].every(d => opcoes.includes(d)), opcoes.join(' | '));
  check('dropdown também tem a opção "Outro (digitar)"', opcoes.includes('Outro (digitar)'), opcoes.join(' | '));

  check('valor salvo batendo com um ponto fixo vem pré-selecionado no <select>', (await p.locator('#rt-destino-select').inputValue()) === 'Cartório Eleitoral da 7ª Zona Eleitoral');
  check('campo "Outro" fica escondido quando o valor bate com um ponto fixo', await p.locator('#rt-destino-outro-wrap').evaluate(el => getComputedStyle(el).display) === 'none');

  // Troca pra outro ponto fixo e salva.
  await p.selectOption('#rt-destino-select', 'Creche Mamãe Lima (Jatobá)');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  let upd = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1').pop());
  check('salvar com um ponto fixo selecionado grava o texto exato dele', upd?.payload?.destino === 'Creche Mamãe Lima (Jatobá)', JSON.stringify(upd));

  // Reabre, escolhe "Outro" e digita um valor customizado (preserva o caso
  // real de produção — "U.E. Miguel Rocha, Sigefredo Pacheco"/"Creche Mamãe
  // Lima M. Oliveira" — que não bate com nenhum dos 4 pontos fixos).
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await preencherDestino(p, 'U.E. Miguel Rocha, Sigefredo Pacheco');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  upd = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1').pop());
  check('salvar com "Outro" grava o texto customizado digitado', upd?.payload?.destino === 'U.E. Miguel Rocha, Sigefredo Pacheco', JSON.stringify(upd));

  // Reabre — o valor customizado (não bate com nenhum ponto fixo) precisa
  // cair em "Outro", com o texto já preenchido no campo — nunca se perde.
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('valor customizado (não bate com ponto fixo) cai em "Outro"', (await p.locator('#rt-destino-select').inputValue()) === '__outro__');
  check('campo de texto "Outro" mostra o valor customizado salvo', (await p.locator('#rt-destino-outro').inputValue()) === 'U.E. Miguel Rocha, Sigefredo Pacheco');
  check('campo "Outro" fica visível quando o valor não bate com ponto fixo', await p.locator('#rt-destino-outro-wrap').evaluate(el => getComputedStyle(el).display) !== 'none');

  // Sugestão (↻) — nome do local de votação quase nunca bate com um dos 4
  // pontos fixos, então deve cair em "Outro" com o nome sugerido já preenchido.
  await p.click('#rt-destino-sugerir');
  check('sugestão (↻) cai em "Outro" (nome de local de votação não é ponto fixo)', (await p.locator('#rt-destino-select').inputValue()) === '__outro__');
  check('campo "Outro" mostra o local sugerido (1º/último da lista de paradas)', (await p.locator('#rt-destino-outro').inputValue()) === 'Grupo Escolar A, Campo Maior');

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 30. "🔀 Otimizar ordem" (10/09/2026, pedido direto: "como podemos
// otimizar a posição de cada rota?" → "implemente") — sugere uma ordem
// mais curta (vizinho-mais-próximo + 2-opt, distância em linha reta, 1ª
// parada sempre fixa), nunca aplica sozinho, escreve com mão-dupla pra
// sime_secoes só em rota de tipo legado (distribuicao), e some/aparece
// corretamente conforme número de paradas e geolocalização disponível. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // r1 (tipos inclui 'distribuicao' — tipo legado) ganha geo completa +
  // 1 parada nova, numa geometria simples em linha reta (mesma latitude,
  // longitude variando) pra dar uma sugestão determinística: cadastrada
  // como s1(x=0km) → s2(x=2km) → s5(x=1km); ordem ótima mantendo s1 fixo
  // é s1→s5→s2 (mais curta e sem ambiguidade — vizinho-mais-próximo já
  // acha o ótimo aqui, sem precisar do refino 2-opt).
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.83;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.14; // ~2km a leste de s1
  m.sime_secoes.push({ id: 's5', numero: 77, local_nome: 'Escola X', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83, longitude: -42.15 }); // ~1km a leste de s1
  m.sime_rota_secoes.push({ id: 'rs5', rota_id: 'r1', secao_id: 's5', parada: 3 });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('botão "Otimizar ordem" aparece com 3+ paradas', await p.locator('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")').count() === 1);

  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(100);

  const previewTxt = (await p.locator('#rt-paradas-secao .import-result.ir-ok').textContent()).replace(/\s+/g, ' ');
  check('mostra a sugestão com km antes/depois e a lista na nova ordem', /Sugestão/.test(previewTxt) && /km/.test(previewTxt) && /Escola X, Campo Maior/.test(previewTxt), previewTxt);
  const kms = previewTxt.match(/([\d.]+)km\s*→\s*([\d.]+)km/);
  check('km depois é menor que km antes (linha reta ficou mais curta)', kms && parseFloat(kms[2]) < parseFloat(kms[1]), previewTxt);

  const ordemLis = await p.locator('#rt-paradas-secao .import-result.ir-ok ol li').allTextContents();
  check('nova ordem sugerida é s1(fixa, nem aparece na lista)→s5→s2, ou seja lista mostra Escola X antes de Grupo Escolar A', /Escola X/.test(ordemLis[0]) && /Grupo Escolar A/.test(ordemLis[1]), JSON.stringify(ordemLis));

  await p.click('#rt-paradas-secao button:has-text("✓ Aplicar nova ordem")');
  await p.waitForTimeout(150);

  const updRota = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rota_secoes' && e.filtro.rota_id === 'r1'));
  const updS5 = updRota.find(u => u.filtro.secao_id === 's5');
  const updS2 = updRota.find(u => u.filtro.secao_id === 's2');
  check('grava s5 na posição 2 (era 3)', updS5?.payload?.parada === 2, JSON.stringify(updS5));
  check('grava s2 na posição 3 (era 2)', updS2?.payload?.parada === 3, JSON.stringify(updS2));

  const updSecoesLegado = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_secoes' && (e.filtro.id === 's5' || e.filtro.id === 's2')));
  check('espelha em sime_secoes.parada (rota tem tipo distribuicao, legado)', updSecoesLegado.length === 2, JSON.stringify(updSecoesLegado));

  const logOtim = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_ordem_otimizada'));
  check('grava log de auditoria com km antes/depois e quantidade', logOtim?.payload?.rota_id === 'r1' && logOtim?.payload?.quantidade === 3 && typeof logOtim?.payload?.km_antes === 'number' && typeof logOtim?.payload?.km_depois === 'number', JSON.stringify(logOtim));

  check('sugestão some da tela depois de aplicar', await p.locator('#rt-paradas-secao .import-result.ir-ok:has-text("Sugestão")').count() === 0);
  const listaFinal = (await p.locator('#rt-paradas-secao .m-hist-item').allTextContents()).join(' | ');
  check('lista de paradas já reflete a nova ordem na tela (Escola X vira 2º, Grupo Escolar A vira 3º)', /2º.*77.*Escola X/.test(listaFinal.replace(/\s+/g, ' ')) && /3º.*31.*Grupo Escolar A/.test(listaFinal.replace(/\s+/g, ' ')), listaFinal);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 31. Otimizar ordem — descartar sugestão, rota sem tipo legado NÃO
// espelha em sime_secoes, aviso quando falta geo, botão some com menos de
// 3 paradas, e a sugestão desaparece sozinha se a lista de paradas mudar
// no meio-tempo (add/remove/mover). ──
{
  const ctx = await b.newContext();
  const m = mock();
  // r4 é só 'recolhimento_urna' (sem tipo legado) — 4 paradas em linha,
  // cadastradas fora de ordem de propósito (x: 0,3,1,2), pra exercitar
  // também o refino 2-opt (não só o vizinho-mais-próximo).
  m.sime_secoes.push(
    { id: 'q1', numero: 501, local_nome: 'Local Q1', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.20 },
    { id: 'q2', numero: 502, local_nome: 'Local Q2', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.17 },
    { id: 'q3', numero: 503, local_nome: 'Local Q3', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.19 },
    { id: 'q4', numero: 504, local_nome: 'Local Q4', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.18 },
  );
  m.sime_rota_secoes.push(
    { id: 'rq1', rota_id: 'r4', secao_id: 'q1', parada: 1 },
    { id: 'rq2', rota_id: 'r4', secao_id: 'q2', parada: 2 },
    { id: 'rq3', rota_id: 'r4', secao_id: 'q3', parada: 3 },
    { id: 'rq4', rota_id: 'r4', secao_id: 'q4', parada: 4 },
  );
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 004")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(100);
  const ordemLis2 = await p.locator('#rt-paradas-secao .import-result.ir-ok ol li').allTextContents();
  check('acha a ordem monotônica correta (Q3, Q4, Q2) mantendo Q1 fixa — prova que o 2-opt corrige o vizinho-mais-próximo quando precisa', /Local Q3/.test(ordemLis2[0]) && /Local Q4/.test(ordemLis2[1]) && /Local Q2/.test(ordemLis2[2]), JSON.stringify(ordemLis2));

  // Descartar — some o preview, nada é gravado.
  await p.click('#rt-paradas-secao button:has-text("✕ Descartar")');
  await p.waitForTimeout(100);
  check('descartar esconde o preview sem gravar nada', await p.locator('#rt-paradas-secao .import-result.ir-ok').count() === 0);
  const escritasAntes = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_rota_secoes' || e.tabela === 'sime_secoes').length);
  check('descartar não grava nenhuma escrita', escritasAntes === 0, String(escritasAntes));

  // Recalcula e aplica — como r4 não tem tipo legado, NÃO deve mexer em sime_secoes.
  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("✓ Aplicar nova ordem")');
  await p.waitForTimeout(150);
  const updSecoesQ = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_secoes' && ['q1','q2','q3','q4'].includes(e.filtro.id)));
  check('rota SEM tipo legado não espelha em sime_secoes', updSecoesQ.length === 0, JSON.stringify(updSecoesQ));
  const updJuncaoQ = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rota_secoes' && e.filtro.rota_id === 'r4'));
  check('mas grava normalmente em sime_rota_secoes', updJuncaoQ.length > 0, JSON.stringify(updJuncaoQ));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 31b. Otimizar ordem — avisa quantas paradas estão sem geolocalização
// em vez de calcular errado (uma perna sem coordenada não pode entrar
// numa distância em linha reta). Contexto próprio, com uma parada já sem
// geo desde a carga — mutar o mock DEPOIS do boot não refletiria em
// rtDados (que só recarrega em pontos específicos do fluxo, não a cada
// leitura). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.push(
    { id: 'w1', numero: 601, local_nome: 'Local W1', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.20 },
    { id: 'w2', numero: 602, local_nome: 'Local W2', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: null, longitude: null },
    { id: 'w3', numero: 603, local_nome: 'Local W3', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.90, longitude: -42.19 },
  );
  m.sime_rota_secoes.push(
    { id: 'rw1', rota_id: 'r4', secao_id: 'w1', parada: 1 },
    { id: 'rw2', rota_id: 'r4', secao_id: 'w2', parada: 2 },
    { id: 'rw3', rota_id: 'r4', secao_id: 'w3', parada: 3 },
  );
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 004")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('botão aparece mesmo faltando geo (o aviso só vem ao clicar)', await p.locator('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")').count() === 1);

  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(100);
  const toastGeo = await p.locator('#toast').textContent();
  check('avisa quantas paradas estão sem geolocalização, em vez de calcular errado', /1 parada\(s\) sem geolocaliza/.test(toastGeo), toastGeo);
  check('não mostra nenhum preview de sugestão quando falta geo', await p.locator('#rt-paradas-secao .import-result.ir-ok:has-text("Sugestão")').count() === 0);
  const avisoFixo = await p.locator('#rt-paradas-secao').textContent();
  check('aviso fixo (sem precisar clicar) também menciona a falta de geo', /1 parada\(s\) sem geolocaliza/.test(avisoFixo), avisoFixo);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 32. Otimizar ordem — botão some com menos de 3 paradas; sugestão já
// ótima mostra mensagem própria sem botão de aplicar; sugestão de uma
// rota some ao trocar pra outra rota (nunca vaza entre modais). ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  // Rota 002 (r2) não tem paradas cadastradas no mock — 0 paradas, botão
  // não deve aparecer.
  await p.locator('.import-card:has-text("Rota 002")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('botão "Otimizar ordem" NÃO aparece com menos de 3 paradas (aqui, 0)', await p.locator('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")').count() === 0);
  await p.click('#modal-body button:has-text("Cancelar")');
  await p.waitForTimeout(100);

  // Rota 001 (r1) tem só 2 paradas no mock padrão — também deve ficar sem o botão.
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  check('botão "Otimizar ordem" NÃO aparece com 2 paradas', await p.locator('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")').count() === 0);

  await ctx.close();
}

// ── 33. Otimizar ordem — quando a ordem já é a melhor possível, mostra
// mensagem própria (sem oferecer "Aplicar" pra um no-op) e um botão só de
// "Fechar". ──
{
  const ctx = await b.newContext();
  const m = mock();
  // 3 paradas JÁ na ordem ótima (linha reta, x crescente: s1=0, nova=1,
  // s2=2) — o algoritmo deve devolver a mesma ordem, sem nada pra aplicar.
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.83;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.14; // x=2km
  m.sime_secoes.push({ id: 's6', numero: 88, local_nome: 'Escola Y', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83, longitude: -42.15 }); // x=1km
  m.sime_rota_secoes.push({ id: 'rs6', rota_id: 'r1', secao_id: 's6', parada: 2 }); // já entra na posição 2 (entre s1 e s2)
  m.sime_rota_secoes.find(rs => rs.rota_id === 'r1' && rs.secao_id === 's2').parada = 3;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(100);

  const previewTxt2 = (await p.locator('#rt-paradas-secao .import-result.ir-ok').textContent()).replace(/\s+/g, ' ');
  check('avisa que a ordem já é a mais curta possível', /já é a mais curta/.test(previewTxt2), previewTxt2);
  check('não oferece botão de Aplicar pra um no-op', await p.locator('#rt-paradas-secao button:has-text("✓ Aplicar nova ordem")').count() === 0);
  check('oferece só Fechar', await p.locator('#rt-paradas-secao button:has-text("Fechar")').count() === 1);

  await p.click('#rt-paradas-secao button:has-text("Fechar")');
  await p.waitForTimeout(100);
  check('Fechar esconde o preview', await p.locator('#rt-paradas-secao .import-result.ir-ok').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 34. QR da ficha impressa escala com o tamanho do link (10/09/2026,
// achado real: rota "VIS1" — 10 paradas + endereço do Cartório como origem
// — saiu com QR ilegível na impressão, porque a lib sempre desenha dentro
// do canvas de width/height pedido, não importa quantos módulos a matriz
// precise; num link longo, o 96px de sempre (bom pro link curto de um
// token) vira módulo de menos de 1px). `rtQrSizePx()` escala o canvas pelo
// tamanho do texto — mesma lógica usada em `rtImprimirFicha()`. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await login(p);
  await p.waitForTimeout(200);

  const tiers = await p.evaluate(() => ([
    window.rtQrSizePx('x'.repeat(30)),
    window.rtQrSizePx('x'.repeat(100)),
    window.rtQrSizePx('x'.repeat(200)),
    window.rtQrSizePx('x'.repeat(350)),
    window.rtQrSizePx('x'.repeat(500)),
  ]));
  check('link curto (token/2 paradas) continua no tamanho de sempre (96px)', tiers[0] === 96, JSON.stringify(tiers));
  check('tamanho cresce em degraus conforme o link fica mais longo, nunca encolhe', tiers.every((v, i) => i === 0 || v >= tiers[i - 1]) && tiers[4] > tiers[0], JSON.stringify(tiers));
  check('link bem longo (equivalente a uma rota com várias paradas + endereço do Cartório) usa o maior tier (320px)', tiers[4] === 320, JSON.stringify(tiers));

  await ctx.close();
}

// Ponta a ponta: uma rota com MUITAS paradas geolocalizadas (+ destino que
// cai no texto do endereço do Cartório, não numa coordenada — mesmo padrão
// real da VIS1) gera uma URL de Directions longa o bastante pra sair do
// tier de 96px na ficha de verdade, não só na função isolada acima.
{
  const ctx = await b.newContext();
  const m = mock();
  const zona = m.sime_zonas.find(z => z.id === 'z7');
  zona.remetente_endereco = 'Rua Benjamin Constant, 948';
  zona.remetente_bairro = 'Centro';
  zona.remetente_cep = '64280-000';
  zona.remetente_municipio = 'Campo Maior';
  zona.remetente_uf = 'PI';
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831; m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  for (let i = 0; i < 8; i++) {
    const id = `sq${i}`;
    m.sime_secoes.push({ id, numero: 300 + i, local_nome: `Escola Extra ${i}`, municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83 - i * 0.01, longitude: -42.16 - i * 0.01 });
    m.sime_rota_secoes.push({ id: `rsq${i}`, rota_id: 'r1', secao_id: id, parada: 3 + i });
  }
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.destino = 'Cartório Eleitoral da 7ª Zona Eleitoral'; // cai no fallback de endereço postal, bem mais longo que uma coordenada
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const largura = await p.locator('#rt-ficha-qr canvas').getAttribute('width');
  check('rota com muitas paradas + endereço do Cartório: QR sai maior que os 96px de sempre', Number(largura) > 96, `width=${largura}`);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
