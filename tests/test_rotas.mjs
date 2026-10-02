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
  await p.fill('#rt-placa', 'abc 1d23');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r2'));
  check('grava ponto_partida/destino', upd?.payload?.ponto_partida === 'Sede da 7ª Zona' && upd?.payload?.destino === 'Escola B', JSON.stringify(upd));
  check('grava horário de saída/chegada prevista', upd?.payload?.horario_saida === '06:30' && upd?.payload?.horario_chegada_previsto === '08:00', JSON.stringify(upd));
  check('grava o responsável escolhido', upd?.payload?.responsavel_ator_id === 'a1', JSON.stringify(upd));
  check('grava a placa normalizada (sem espaço, maiúscula)', upd?.payload?.placa === 'ABC1D23', JSON.stringify(upd));

  const txt = (await p.locator('.import-card:has-text("Rota 002")').textContent()).replace(/\s+/g, ' ');
  check('card mostra partida → destino', /Sede da 7ª Zona → Escola B/.test(txt), txt);
  check('card mostra horário de saída/chegada', /06:30/.test(txt) && /08:00/.test(txt), txt);
  check('card mostra o nome do responsável', /JOAO MOTORISTA/.test(txt), txt);
  check('card mostra a placa junto do responsável', /ABC1D23/.test(txt), txt);

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
  r1.placa = 'NHX1905';
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
  check('ficha mostra a placa do veículo junto do responsável', /NHX1905/.test(printHtml), printHtml);
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

  check('Partida vem sugerida com o 1º local da lista de paradas', (await p.locator('#rt-partida').inputValue()) === '30 — Grupo Escolar A, Campo Maior');
  check('Destino vem sugerido com o último local da lista de paradas', (await lerDestino(p)) === '63 — Escola B, Campo Maior');

  // Cartório digita um valor próprio por cima da sugestão de partida (ex.:
  // um endereço que não é local de votação nenhum) — a sugestão nunca é
  // forçada; o destino fica intocado, herdando a sugestão mesmo assim.
  await p.fill('#rt-partida', 'Cartório Eleitoral da 7ª Zona');
  await p.fill('#rt-tempo-parada', '10');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);

  const upd = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1'));
  check('grava o valor digitado, não a sugestão, pra partida', upd?.payload?.ponto_partida === 'Cartório Eleitoral da 7ª Zona', JSON.stringify(upd));
  check('grava o valor sugerido (nunca editado) pro destino', upd?.payload?.destino === '63 — Escola B, Campo Maior', JSON.stringify(upd));
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
  check('clicar em "↻" preenche de novo com a sugestão atual (1º local)', (await p.locator('#rt-partida').inputValue()) === '30 — Grupo Escolar A, Campo Maior');

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
  check('legenda também mostra a Partida (sugerida a partir da 1ª parada, com o número da seção)', /Partida: 30 — Grupo Escolar A, Campo Maior/.test(printHtml), printHtml);
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
// transmissão") — dropdown mostra os pontos fixos, pré-seleciona quando o
// valor salvo bate com um deles, cai em "Outro" com o texto preenchido
// quando não bate (preserva valor customizado já em produção), salva
// corretamente nos dois casos, e a sugestão (↻) — que quase nunca bate com
// um ponto fixo — cai em "Outro" com o nome do local sugerido.
// 28/09/2026 — RT_DESTINOS_CONHECIDOS trocada pela lista OFICIAL de pontos
// de transmissão trazida pelo cartório (menos o Patronato N.S. de Lourdes,
// que é só contingência) — os antigos "Creche Mamãe Lima"/"Escola
// Monsenhor Mateus"/"Escola da Baixinha" eram dedução informal, não a
// lista real; ver comentário de `RT_DESTINOS_CONHECIDOS`. ──
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
  check('dropdown lista os pontos de transmissão oficiais conhecidos', ['Cartório Eleitoral da 7ª Zona Eleitoral', 'Câmara de Vereadores de Sigefredo Pacheco', 'Grupo Escolar Manoel Francisco (Sigefredo Pacheco)', 'Escola do Reassentamento Corredores (Campo Maior)', 'SETI Francisco Luis (Jatobá do Piauí)'].every(d => opcoes.includes(d)), opcoes.join(' | '));
  check('dropdown também tem a opção "Outro (digitar)"', opcoes.includes('Outro (digitar)'), opcoes.join(' | '));

  check('valor salvo batendo com um ponto fixo vem pré-selecionado no <select>', (await p.locator('#rt-destino-select').inputValue()) === 'Cartório Eleitoral da 7ª Zona Eleitoral');
  check('campo "Outro" fica escondido quando o valor bate com um ponto fixo', await p.locator('#rt-destino-outro-wrap').evaluate(el => getComputedStyle(el).display) === 'none');

  // Troca pra outro ponto fixo e salva.
  await p.selectOption('#rt-destino-select', 'Câmara de Vereadores de Sigefredo Pacheco');
  await p.click('#modal-body button:has-text("Salvar")');
  await p.waitForTimeout(150);
  let upd = await p.evaluate(() => window.__mock.escritas.filter(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1').pop());
  check('salvar com um ponto fixo selecionado grava o texto exato dele', upd?.payload?.destino === 'Câmara de Vereadores de Sigefredo Pacheco', JSON.stringify(upd));

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
  check('campo "Outro" mostra o local sugerido (1º/último da lista de paradas)', (await p.locator('#rt-destino-outro').inputValue()) === '31 — Grupo Escolar A, Campo Maior');

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

// ── 35. Linha ligando as paradas por cima do mapa real (10/09/2026, pedido
// direto: "não conseguimos desenhar a rota?" — até aqui o mapa real só
// mostrava os pinos numerados, sem nada ligando eles, então não lia como uma
// rota desenhada, só pontos soltos. rtLinhaOverlaySVG() desenha um <svg>
// (polyline, mesma projeção Mercator dos pinos) por cima da imagem, na ordem
// das paradas geolocalizadas. Reaproveita o mesmo mock de "muitas paradas"
// do bloco 34 (10 paradas geolocalizadas: s1+s2+8 extras) pra garantir que a
// linha liga TODAS elas, não só as 2 de sempre. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  for (let i = 0; i < 8; i++) {
    const id = `sq${i}`;
    m.sime_secoes.push({ id, numero: 300 + i, local_nome: `Escola Extra ${i}`, municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83 - i * 0.01, longitude: -42.16 - i * 0.01 });
    m.sime_rota_secoes.push({ id: `rsq${i}`, rota_id: 'r1', secao_id: id, parada: 3 + i });
  }
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const pontos = await p.evaluate(() => {
    const linha = document.querySelector('#rt-mapa-real-wrap svg polyline');
    return linha ? linha.getAttribute('points').trim().split(/\s+/).length : null;
  });
  check('linha do trajeto desenhada sobre o mapa real, ligando todas as 10 paradas geolocalizadas', pontos === 10, `pontos=${pontos}`);

  const ordem = await p.evaluate(() => {
    const html = document.getElementById('rt-mapa-real-wrap').innerHTML;
    return { idxLinha: html.indexOf('<svg'), idxPino: html.indexOf('border-radius:50%') };
  });
  check('svg da linha entra ANTES dos pinos no DOM (pinos aparecem por cima da linha)', ordem.idxLinha !== -1 && ordem.idxPino !== -1 && ordem.idxLinha < ordem.idxPino, JSON.stringify(ordem));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// Rota com só 1 parada geolocalizada nunca ganha linha (não há trajeto de 1
// ponto só) — mesmo limiar de rtSvgMinimapa/rtStaticMapInfo (>=2), pra não
// desenhar um polyline degenerado.
{
  const ctx = await b.newContext();
  const m = mock();
  // s1 já tem geo por padrão; s2 continua sem (null/null) — só 1 geo'd.
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const svgExiste = await p.evaluate(() => !!document.querySelector('#rt-mapa-real-wrap svg polyline'));
  check('com só 1 parada geolocalizada, nenhuma linha é desenhada (sem trajeto de 1 ponto)', svgExiste === false);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 36. "📏 Calcular rota real" (Google Directions, 24/09/2026) — botão
// aparece com 2+ paradas com geo completa, chama o endpoint (mockado aqui
// via page.route, nunca a chave de verdade), cacheia em sime_rotas.rota_real_*,
// e a previsão de chegada passa a usar a distância/duração REAIS (em vez da
// estimativa em linha reta) enquanto o cache continuar válido pra ordem
// atual — cai de volta pra linha reta assim que a lista de paradas muda. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  // Escola B (s3) também ganha geo aqui de propósito — é a parada usada mais
  // abaixo pra "mudar a lista" e invalidar o cache; se ficasse sem geo, o
  // eta inteiro sumiria (rtChegadaEstimada exige geo em TODAS as paradas),
  // o que testaria outra coisa (ausência de geo) em vez da invalidação do
  // cache por mudança de conjunto, que é o que este bloco quer provar.
  m.sime_secoes.find(s => s.id === 's3').latitude = -4.829;
  m.sime_secoes.find(s => s.id === 's3').longitude = -42.159;
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.horario_saida = '07:00';
  r1.tempo_parada_min = 10;
  const { p, erros } = await abrir(ctx, m);
  await p.route('**/api/rotas-directions', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, distanciaM: 12000, duracaoS: 1200, polyline: [[-4.83, -42.16], [-4.831, -42.161]] }),
  }));
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('botão "📏 Calcular rota real (Google)" aparece com 2+ paradas geo completas', await p.locator('#rt-paradas-secao button:has-text("📏 Calcular rota real")').count() === 1);

  await p.click('#rt-paradas-secao button:has-text("📏 Calcular rota real")');
  await p.waitForTimeout(200);

  const updReal = await p.evaluate(() => window.__mock.escritas.find(e => e.op === 'update' && e.tabela === 'sime_rotas' && e.filtro.id === 'r1' && e.payload.rota_real_distancia_m != null));
  // Assinatura ganhou o sufixo "|ponto_partida|destino" em 02/10/2026 — r1
  // tem os dois null no mock, então vira "s1,s2||" (base + 2 separadores
  // vazios), não mais só "s1,s2".
  check('cacheia distância/duração/polyline/assinatura em sime_rotas', updReal?.payload?.rota_real_distancia_m === 12000 && updReal?.payload?.rota_real_duracao_s === 1200 && updReal?.payload?.rota_real_paradas_assinatura === 's1,s2||' && Array.isArray(updReal?.payload?.rota_real_polyline) && updReal.payload.rota_real_polyline.length === 2, JSON.stringify(updReal));

  const logReal = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_real_calculada'));
  check('grava log de auditoria com km/min calculados', logReal?.payload?.rota_id === 'r1' && logReal?.payload?.distancia_km === 12 && logReal?.payload?.duracao_min === 20, JSON.stringify(logReal));

  const resumoTxt = (await p.locator('#rt-paradas-secao').textContent()).replace(/\s+/g, ' ');
  check('resumo da rota real aparece na tela logo após calcular, sem precisar reabrir o modal', /Rota real \(Google\): 12\.0km, 20min/.test(resumoTxt), resumoTxt);

  // ETA (fora de #rt-paradas-secao) só recalcula quando o modal reabre —
  // mesmo comportamento de sempre pra previsão de chegada (nem reordenar
  // parada com ▲/▼ recalcula ela ao vivo, ver bloco 20).
  await p.click('#modal-body button:has-text("Cancelar")');
  await p.waitForTimeout(100);
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const modalTxtReal = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('previsão de chegada passa a citar "rota real do Google" em vez de "ESTIMADA"', /rota real do Google/.test(modalTxtReal) && !/ESTIMADA/.test(modalTxtReal), modalTxtReal);
  // 12km/20min de deslocamento + 2×10min parado = 40min após 07:00 → 07:40.
  check('previsão de chegada usa a distância/duração REAIS cacheadas (12.0km, 40min de deslocamento+parada) → 07:40', /12\.0km/.test(modalTxtReal) && /chega por volta de 07:40/.test(modalTxtReal), modalTxtReal);
  check('"Previsão de chegada" pré-preenchida com o horário calculado a partir da rota real', (await p.locator('#rt-hora-chegada').inputValue()) === '07:40');

  // Muda a lista de paradas (adiciona uma nova) — assinatura do cache não
  // bate mais com a lista atual, então some a rota real, tanto na tela
  // quanto na previsão de chegada.
  await p.click('#rt-paradas-secao button:has-text("+")');
  await p.fill('#rt-secao-busca', 'Escola B');
  await p.waitForTimeout(350);
  await p.click('#rt-paradas-secao .m-hist-item:has-text("Escola B")');
  await p.waitForTimeout(150);
  const resumoTxt2 = (await p.locator('#rt-paradas-secao').textContent()).replace(/\s+/g, ' ');
  check('lista de paradas mudou: avisa que a rota real ficou desatualizada', /Havia uma rota real calculada, mas a lista de paradas \(ou o ponto de partida\/destino\) mudou/.test(resumoTxt2), resumoTxt2);

  await p.click('#modal-body button:has-text("Cancelar")');
  await p.waitForTimeout(100);
  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  const modalTxtDepois = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('com o cache desatualizado, previsão de chegada volta a ser a estimativa em linha reta (ESTIMADA)', /ESTIMADA/.test(modalTxtDepois) && !/rota real do Google/.test(modalTxtDepois), modalTxtDepois);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 37. Ficha impressa usa o traçado REAL do Google (não a linha reta entre
// paradas) quando existe uma rota real cacheada e ainda válida pra ordem
// atual (24/09/2026) — inclusive pro enquadramento do mapa, que precisa
// caber o trajeto inteiro, não só as paradas. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  // Cache já calculado de propósito (evita depender do fluxo de clique) —
  // 4 pontos no traçado real, mais do que as 2 paradas, pra provar que o
  // desenho usa o POLYLINE real, não a contagem de paradas.
  r1.rota_real_polyline = [[-4.83, -42.16], [-4.8305, -42.1605], [-4.8308, -42.1608], [-4.831, -42.161]];
  r1.rota_real_distancia_m = 12000;
  r1.rota_real_duracao_s = 1200;
  r1.rota_real_paradas_assinatura = 's1,s2||'; // formato novo (02/10/2026) — ponto_partida/destino de r1 são null
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const pontosReais = await p.evaluate(() => {
    const linha = document.querySelector('#rt-mapa-real-wrap svg polyline');
    return linha ? linha.getAttribute('points').trim().split(/\s+/).length : null;
  });
  check('linha da ficha segue o traçado real do Google (4 pontos do polyline, não as 2 paradas)', pontosReais === 4, `pontos=${pontosReais}`);

  const legendaTxt = (await p.locator('#rt-mapa-real-wrap').textContent()).replace(/\s+/g, ' ');
  check('legenda deixa claro que a linha é o trajeto real calculado pelo Google', /trajeto REAL calculado pelo Google/.test(legendaTxt), legendaTxt);

  const infoTxt = (await p.locator('.rt-info').textContent()).replace(/\s+/g, ' ');
  check('ficha mostra a distância/tempo reais no bloco de informações', /Distância\/tempo de deslocamento \(Google, rota real\).*12\.0km, 20min/.test(infoTxt), infoTxt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 38. "🔀 Otimizar ordem" confirma com o Google (Directions) quando acha
// uma melhoria real (24/09/2026, pedido direto: "quero que o Otimizar ordem
// use o Google Directions também") — o algoritmo de sempre (linha reta)
// continua decidindo a ORDEM sugerida; o Google só confirma o km/tempo REAIS
// das duas ordens (atual e sugerida), e só quando há mesmo uma melhoria a
// aplicar (nunca gasta a API confirmando um "já está ótimo"). Mesma
// geometria do bloco 30 (s1 fixo, s5 a 1km, s2 a 2km — ordem ótima
// s1→s5→s2). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.83;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.14;
  m.sime_secoes.push({ id: 's5', numero: 77, local_nome: 'Escola X', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83, longitude: -42.15 });
  m.sime_rota_secoes.push({ id: 'rs5', rota_id: 'r1', secao_id: 's5', parada: 3 });
  const { p, erros } = await abrir(ctx, m);
  let chamadas = 0;
  await p.route('**/api/rotas-directions', async (route) => {
    chamadas++;
    const body = route.request().postDataJSON();
    // Distingue a ordem "atual" (s1,s2,s5) da "sugerida" (s1,s5,s2) pela
    // 2ª parada enviada — cada uma tem uma longitude diferente.
    const segunda = body.paradas[1];
    const ehOrdemAtual = Math.abs(segunda.lon - (-42.14)) < 1e-6; // s2 é a 2ª na ordem atual
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(ehOrdemAtual
        ? { ok: true, distanciaM: 3000, duracaoS: 300, polyline: [] }
        : { ok: true, distanciaM: 2000, duracaoS: 200, polyline: [] }),
    });
  });
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(400);

  check('confirma com o Google quando há melhoria de verdade (2 chamadas: ordem atual + sugerida)', chamadas === 2, `chamadas=${chamadas}`);
  const previewTxt3 = (await p.locator('#rt-paradas-secao .import-result.ir-ok').textContent()).replace(/\s+/g, ' ');
  check('mostra os números reais confirmados pelo Google ao lado da estimativa em linha reta', /Confirmado pelo Google \(rota real\): 3\.0km\/5min → 2\.0km\/3min/.test(previewTxt3), previewTxt3);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 39. Otimizar ordem — quando a ordem já é ótima (nada a aplicar), NÃO
// chama o Google (evita gastar a API confirmando um no-op). Mesma geometria
// do bloco 33. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.83;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.14;
  m.sime_secoes.push({ id: 's6', numero: 88, local_nome: 'Escola Y', municipio: 'Campo Maior', zona_id: 'z7', ativo: true, rota_id: null, parada: null, latitude: -4.83, longitude: -42.15 });
  m.sime_rota_secoes.push({ id: 'rs6', rota_id: 'r1', secao_id: 's6', parada: 2 });
  m.sime_rota_secoes.find(rs => rs.rota_id === 'r1' && rs.secao_id === 's2').parada = 3;
  const { p, erros } = await abrir(ctx, m);
  let chamadas2 = 0;
  await p.route('**/api/rotas-directions', (route) => { chamadas2++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, distanciaM: 1, duracaoS: 1, polyline: [] }) }); });
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);
  await p.click('#rt-paradas-secao button:has-text("🔀 Otimizar ordem")');
  await p.waitForTimeout(300);

  check('ordem já ótima: nenhuma chamada ao Google', chamadas2 === 0, `chamadas=${chamadas2}`);
  const previewTxt4 = (await p.locator('#rt-paradas-secao .import-result.ir-ok').textContent()).replace(/\s+/g, ' ');
  check('continua mostrando só a mensagem de "já é a mais curta"', /já é a mais curta/.test(previewTxt4), previewTxt4);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 40. Previsão de encerramento por parada (27/09/2026,
// sime_secoes.horario_encerramento_previsto — planilha real do cartório
// "Tempo de Transmissão", ver sql/SIME_secoes_horario_encerramento_
// previsto.sql) — mostrada por parada MESMO sem horário de saída/tempo por
// parada preenchidos (informativo, não depende do cálculo em cascata);
// seção sem previsão cadastrada não mostra nada. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').horario_encerramento_previsto = '07:45:00';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  const listaTxt = (await p.locator('#rt-paradas-secao').textContent()).replace(/\s+/g, ' ');
  check('parada com previsão cadastrada mostra "previsão de encerramento: 07:45" mesmo sem horário de saída', /previsão de encerramento: 07:45/.test(listaTxt), listaTxt);
  const linhaS1 = await p.locator('.m-hist-item:has-text("30")').textContent();
  check('parada sem previsão cadastrada (seção 30) não mostra nenhuma linha de horário', !/previsão de encerramento/.test(linhaS1) && !/chega/.test(linhaS1), linhaS1);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 41. Sugestão de horário de saída a partir da previsão de encerramento
// da 1ª parada ("↻" ao lado de Horário de saída) — mesmo padrão de
// sugestão de partida/destino/chegada: nunca sobrescreve sozinho, só
// preenche por clique explícito. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's1').horario_encerramento_previsto = '08:00:00';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('botão "↻" de horário de saída aparece (1ª parada tem previsão cadastrada)', await p.locator('#rt-saida-sugerir').count() === 1);
  check('campo de horário de saída começa vazio', (await p.locator('#rt-hora-saida').inputValue()) === '');
  await p.click('#rt-saida-sugerir');
  check('clicar preenche com a previsão de encerramento da 1ª parada (08:00)', (await p.locator('#rt-hora-saida').inputValue()) === '08:00');

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 42. Aviso quando o horário de saída SALVO é mais cedo do que a
// previsão de encerramento da 1ª parada — nunca bloqueia, só avisa
// (mesma filosofia de sempre); sem esse conflito, mostra só a nota
// informativa (sem o tom de alerta). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's1').horario_encerramento_previsto = '08:00:00';
  m.sime_rotas.find(r => r.id === 'r1').horario_saida = '07:00';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  const avisoTxt = (await p.locator('.import-result.ir-warn').textContent()).replace(/\s+/g, ' ');
  check('avisa que a saída salva (07:00) é antes da previsão de encerramento da 1ª parada (08:00)', /07:00/.test(avisoTxt) && /08:00/.test(avisoTxt), avisoTxt);
  await ctx.close();
}
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's1').horario_encerramento_previsto = '08:00:00';
  m.sime_rotas.find(r => r.id === 'r1').horario_saida = '08:30'; // depois do piso — sem conflito
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('sem conflito, não mostra o aviso de alerta', await p.locator('.import-result.ir-warn').count() === 0);
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('mostra só a nota informativa da previsão de encerramento', /Previsão de encerramento da 1ª parada[\s\S]*?08:00/.test(modalTxt), modalTxt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 43. Espera em cascata — o veículo não sai de uma parada antes da
// previsão de encerramento dela; a espera empurra a chegada nas paradas
// seguintes e entra no total da previsão de chegada. ──
{
  const ctx = await b.newContext();
  const m = mock();
  // Mesmas coordenadas do bloco 20 — deslocamento em linha reta arredonda
  // pra 0min a 40km/h, isolando o efeito da espera do efeito de viagem.
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  m.sime_secoes.find(s => s.id === 's2').horario_encerramento_previsto = '07:45:00'; // depois da chegada natural (07:10)
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.horario_saida = '07:00';
  r1.tempo_parada_min = 10;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  // Sem espera: saída 07:00 + 20min parado (2×10) + ~0min de deslocamento =
  // chegaria às 07:20; com a espera de 35min na 2ª parada (chega 07:10,
  // só libera às 07:45), o total passa a ser 07:55.
  check('"Previsão de chegada" já soma a espera (07:55, não os 07:20 de antes)', (await p.locator('#rt-hora-chegada').inputValue()) === '07:55');
  const modalTxt = (await p.locator('#modal-body').textContent()).replace(/\s+/g, ' ');
  check('nota menciona os 35min de espera', /35min de espera/.test(modalTxt), modalTxt);

  const linhaS1 = (await p.locator('.m-hist-item:has-text("30")').textContent()).replace(/\s+/g, ' ');
  check('1ª parada (sem previsão cadastrada): chega 07:00 e sai 07:10, sem espera', /chega ~07:00/.test(linhaS1) && /sai 07:10/.test(linhaS1) && !/espera/.test(linhaS1), linhaS1);
  const linhaS2 = (await p.locator('.m-hist-item:has-text("31")').textContent()).replace(/\s+/g, ' ');
  check('2ª parada: chega 07:10, espera 35min até fechar às 07:45, sai 07:55', /chega ~07:10/.test(linhaS2) && /espera 35min/.test(linhaS2) && /fecha 07:45/.test(linhaS2) && /sai 07:55/.test(linhaS2), linhaS2);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 44. Ficha impressa mostra chegada/espera/saída estimadas (ou só a
// previsão de encerramento, sem o cálculo completo) por baixo do nome de
// cada local — nunca sobrescreve a coluna "Chegada" (em branco, pro
// motorista anotar o horário real em campo). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  m.sime_secoes.find(s => s.id === 's2').horario_encerramento_previsto = '07:45:00';
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.horario_saida = '07:00';
  r1.tempo_parada_min = 10;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const printHtml = (await p.locator('#print-area').innerHTML()).replace(/\s+/g, ' ');
  check('ficha mostra chega/sai estimados da 1ª parada', /chega ~07:00 · sai 07:10/.test(printHtml), printHtml);
  check('ficha mostra a espera até o encerramento previsto da 2ª parada', /chega ~07:10 · espera até 07:45 · sai 07:55/.test(printHtml), printHtml);
  check('coluna "Chegada" continua em branco (sem estimativa sobrescrevendo o campo de anotação manual)', /<td class="rt-col-chegada"><\/td>/.test(printHtml), printHtml);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 45. Piso de encerramento NUNCA se aplica a rota só de `distribuicao`
// (ou só `instalacao`) — bug real achado recalculando em lote as rotas da
// 7ª Zona: essas rodam ANTES da votação fechar (D-1/D-X), então a previsão
// de encerramento (que é sobre o Dia D) não tem nenhum sentido ali —
// aplicá-la produzia "esperas" de mais de 10 horas numa rota que sai às
// 5h da manhã. Só rota com `recolhimento_urna`/`recolhimento_midia` no
// tipo usa o piso. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_secoes.find(s => s.id === 's1').horario_encerramento_previsto = '18:00:00';
  m.sime_secoes.find(s => s.id === 's2').latitude = -4.831;
  m.sime_secoes.find(s => s.id === 's2').longitude = -42.161;
  m.sime_secoes.find(s => s.id === 's2').horario_encerramento_previsto = '18:30:00';
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.tipos = ['distribuicao']; // só distribuição, sem recolhimento_urna/midia
  r1.horario_saida = '05:00';
  r1.tempo_parada_min = 10;
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('div[title="Clique pra editar"]').click();
  await p.waitForTimeout(100);

  check('sem botão "↻" de horário de saída (rota de distribuição não usa piso)', await p.locator('#rt-saida-sugerir').count() === 0);
  check('sem aviso nem nota de previsão de encerramento sobre o horário de saída', await p.locator('.import-result.ir-warn').count() === 0 && !/Previsão de encerramento da 1ª parada/.test((await p.locator('#modal-body').textContent())));
  check('"Previsão de chegada" continua a estimativa simples (05:20 = 20min parado, sem espera nenhuma)', (await p.locator('#rt-hora-chegada').inputValue()) === '05:20');
  // Chegada/saída (viagem + tempo parado) continuam mostradas normalmente
  // — são úteis pra qualquer rota; só o PISO (previsão de encerramento/
  // espera) que nunca aparece pra distribuição/instalação.
  const listaTxt = (await p.locator('#rt-paradas-secao').textContent()).replace(/\s+/g, ' ');
  check('mostra chega/sai normalmente (05:00→05:10, 05:10→05:20 — sem espera)', /chega ~05:00 · sai 05:10/.test(listaTxt) && /chega ~05:10 · sai 05:20/.test(listaTxt), listaTxt);
  check('mas nunca menciona previsão de encerramento nem espera (rota de distribuição)', !/previsão de encerramento/.test(listaTxt) && !/espera/.test(listaTxt), listaTxt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 46. "🖨️ Imprimir todas (tipo)" (30/09/2026, pedido direto: "quero um
// botão para imprimir todas as rotas de uma vez, mas por tipo") — imprime,
// numa impressão só, a ficha de toda rota ATIVA do tipo escolhido no
// filtro de sempre; nunca aparece com "Todos os tipos" (nunca mistura
// tipos diferentes no mesmo lote). Mock tem 2 rotas ativas com
// 'recolhimento_urna' (r1 e r4) e 1 com 'recolhimento_midia' (r2). ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.responsavel_ator_id = 'a1';
  m.sime_atores.find(a => a.id === 'a1').telefone_whatsapp = '5586999998888';
  // r4 não tem parada nenhuma vinculada no mock — sem ponto_partida/destino
  // e sem nenhuma parada geolocalizada, rtMapsUrl() devolve null (nada pra
  // rotear), o que faria a ficha dela nascer sem QR nenhum (mesmo
  // comportamento correto de sempre — não é falta de suffixação de id).
  // Pra este teste de fato exercitar "2 QRs sem colidir", ela precisa ter
  // partida/destino de texto que resolvam pra alguma rota — reaproveita o
  // padrão real da 7ª Zona (destino = Cartório da zona, cai no fallback de
  // endereço postal quando cadastrado).
  const r4 = m.sime_rotas.find(r => r.id === 'r4');
  r4.ponto_partida = 'Escola B'; r4.destino = 'Cartório Eleitoral da 7ª Zona Eleitoral';
  const zona = m.sime_zonas.find(z => z.id === 'z7');
  zona.remetente_endereco = 'Rua Benjamin Constant, 948'; zona.remetente_municipio = 'Campo Maior'; zona.remetente_uf = 'PI';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  check('sem tipo escolhido no filtro, o botão de imprimir em lote não aparece', await p.locator('button:has-text("🖨️ Imprimir todas")').count() === 0);

  await p.selectOption('#rt-filtro-tipo', 'recolhimento_urna');
  await p.waitForTimeout(100);
  const botaoTxt = await p.locator('button:has-text("🖨️ Imprimir todas")').textContent();
  check('com "Recolhimento de urnas" escolhido, botão aparece com a contagem ATIVA certa (r1+r4=2, não conta rota inativa nenhuma)', /Recolhimento de urnas.*2 rota/.test(botaoTxt), botaoTxt);

  await p.click('button:has-text("🖨️ Imprimir todas")');
  await p.waitForTimeout(200);

  check('imprime numa chamada só de window.print()', await p.evaluate(() => window.__printCalls) === 1);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('ficha das duas rotas (001 e 004) saem concatenadas no print-area', /Ficha de Rota — 001 — Rota 001/.test(printHtml) && /Ficha de Rota — 004 — Rota 004 recolhimento urna/.test(printHtml), printHtml.slice(0, 400));
  check('a rota 002 (recolhimento de mídia, outro tipo) NUNCA entra no lote', !/Rota 002 mídia/.test(printHtml));

  const paginasCount = await p.locator('.rt-pagina-ficha').count();
  check('2 páginas de ficha no DOM, uma por rota do tipo', paginasCount === 2, String(paginasCount));

  const qrCanvases = await p.locator('[id^="rt-ficha-qr-"] canvas').count();
  check('cada ficha ganha seu próprio QR (2 canvas, ids sufixados sem colisão)', qrCanvases === 2, String(qrCanvases));

  const logLote = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_ficha_impressa_lote'));
  check('log de auditoria em lote com tipo/quantidade/códigos certos', logLote?.payload?.tipo === 'recolhimento_urna' && logLote?.payload?.quantidade === 2 && (logLote?.payload?.rotas || []).sort().join(',') === '001,004', JSON.stringify(logLote));

  // Verificação de paginação FÍSICA de verdade — mesmo critério já usado
  // pro AR de Correspondência/ficha de rota única: innerHTML/contagem de
  // .rt-pagina-ficha não garante que o PDF de fato sai em páginas
  // separadas (é a paginação lógica, não a física do motor de impressão).
  // Contagem via regex global (String.match cuida dos índices sozinha —
  // nunca um laço manual de indexOf, que arrisca reiniciar do zero se um
  // dos dois padrões nunca bater e ficar reatribuindo idx=-1 pra sempre).
  await p.emulateMedia({ media: 'print' });
  const pdf = await p.pdf();
  const pdfStr = pdf.toString('latin1');
  const paginasFisicas = (pdfStr.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  // 02/10/2026: cada rota agora sai com 3 páginas físicas (capa + folha em
  // branco + ficha, ver rtHtmlCapa/rtHtmlFolhaBranca) — 2 rotas no lote = 6
  // páginas, não mais 2.
  check('PDF de verdade sai com 6 páginas (capa+branca+ficha por rota, 2 rotas no lote)', paginasFisicas === 6, `paginasFisicas=${paginasFisicas} pdfBytes=${pdf.length}`);
  await p.emulateMedia({ media: 'screen' });

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 46b. Botão ignora rota INATIVA do mesmo tipo; avisa em vez de imprimir
// quando não há nenhuma rota ativa desse tipo; avisa (sem chamar
// window.print()) quando chamado sem tipo escolhido. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas.find(r => r.id === 'r4').ativo = false; // só r1 fica ativa em recolhimento_urna
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.selectOption('#rt-filtro-tipo', 'recolhimento_urna');
  await p.waitForTimeout(100);
  const botaoTxt = await p.locator('button:has-text("🖨️ Imprimir todas")').textContent();
  check('rota desativada não entra na contagem do botão (só r1 = 1 rota)', /1 rota/.test(botaoTxt), botaoTxt);

  await p.click('button:has-text("🖨️ Imprimir todas")');
  await p.waitForTimeout(150);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('a rota 004 (desativada) nunca sai impressa, mesmo sendo do mesmo tipo', !/Rota 004/.test(printHtml), printHtml.slice(0, 300));
  check('só 1 página de ficha (a rota ativa)', await p.locator('.rt-pagina-ficha').count() === 1);

  await p.selectOption('#rt-filtro-tipo', 'instalacao'); // nenhuma rota deste tipo no mock
  await p.waitForTimeout(100);
  const printCallsAntes = await p.evaluate(() => window.__printCalls);
  await p.evaluate(() => window.rtImprimirTodasPorTipo());
  await p.waitForTimeout(150);
  check('sem nenhuma rota ativa do tipo, avisa por toast em vez de imprimir vazio', /Nenhuma rota ativa desse tipo/.test(await p.locator('#toast').textContent()));
  check('e não chama window.print() nesse caso', await p.evaluate(() => window.__printCalls) === printCallsAntes);

  await p.evaluate(() => { rtFiltroTipo = ''; });
  await p.evaluate(() => window.rtImprimirTodasPorTipo());
  await p.waitForTimeout(150);
  check('chamado sem tipo escolhido, avisa pra escolher um tipo primeiro', /Escolha um tipo de rota/.test(await p.locator('#toast').textContent()));
  check('e também não chama window.print()', await p.evaluate(() => window.__printCalls) === printCallsAntes);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 47. Capa da ficha impressa (02/10/2026, pedido direto: "ao imprimir as
// informações de rota, inclua uma capa com informações bem grande... inclua
// o QRCODE e token, se for de distribuição de urna deve ter o qrcode da
// rota de distribuição se for rota de instalação o qrcode da rota de
// instalação"). ──
{
  const ctx = await b.newContext();
  const m = mock(); // r1 (001) tem tipos distribuicao+recolhimento_urna, sem token cadastrado em sime_tokens
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const capaTxt = (await p.locator('.rt-pagina-capa').first().innerText()).replace(/\s+/g, ' ');
  check('capa mostra "Rota de" com os tipos da rota, SEM emoji (capa institucional, sóbria)', /Rota de Distribuição de urnas · Recolhimento de urnas/.test(capaTxt), capaTxt);
  check('capa mostra "Rota nº" com o nome da rota', /Rota nº Rota 001/.test(capaTxt), capaTxt);
  check('sem token de Motorista cadastrado pra esta rota, capa avisa em vez de inventar QR', /Nenhum token de Motorista cadastrado/.test(capaTxt), capaTxt);
  check('nenhum canvas de QR da capa é desenhado sem token', await p.locator('#rt-capa-qr canvas, #rt-capa-qr table').count() === 0);

  // Revisão institucional (02/10/2026, pedido direto: "coloque a imagem da
  // eleição 2026 na capa e a informação da 7ª Zona... capa sobria e
  // institucional") — logo da campanha + identificação da zona, mesmo
  // padrão de `raHtmlTimbre()` (sime_recibo_alimentacao.js).
  check('capa mostra a identificação da zona (número + "Zona Eleitoral do Piauí")', /7ª Zona Eleitoral do Piauí/.test(capaTxt), capaTxt);
  check('capa mostra o município da zona', /Campo Maior — PI/.test(capaTxt), capaTxt);
  const logoSrc = await p.locator('.rt-pagina-capa img.rt-capa-logo').first().getAttribute('src');
  check('capa usa a imagem oficial da campanha "Eleições 2026" como marca', /logo_eleicoes2026\.png/.test(logoSrc || ''), logoSrc);

  // Folha em branco entre capa e ficha (02/10/2026, pedido direto: "após a
  // capa da rota adicione uma folha em branco") — sem conteúdo nenhum, e na
  // ordem certa no DOM: capa, depois branca, depois ficha.
  check('existe exatamente 1 folha em branco', await p.locator('.rt-pagina-branca').count() === 1);
  check('a folha em branco está mesmo vazia (sem texto)', (await p.locator('.rt-pagina-branca').innerText()).trim() === '');
  const ordemPaginas = await p.evaluate(() => [...document.querySelectorAll('#print-area > div')].map(d => d.className));
  check('ordem das páginas é capa → branca → ficha', JSON.stringify(ordemPaginas) === JSON.stringify(['rt-pagina-capa', 'rt-pagina-branca', 'rt-pagina-ficha']), JSON.stringify(ordemPaginas));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 47b. Com token de Motorista cadastrado pro código da rota — QR + token/
// PIN aparecem na capa; a URL do QR usa window.ZONA_NUMERO (resolvido da
// zona do usuário) e o módulo certo (SIME_motorista.html). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_tokens = [{ id: 'tok1', eleicao_id: 'el7', token: 'XYZ98765', pin: '1234', tipo: 'motorista', rotas: ['001'] }];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  // Espiona o texto que vira o payload do QR, sem depender de decodificar o
  // canvas de verdade — mesmo tipo de wrapper já usado noutras partes do
  // projeto pra espiar window.print() (ver abrir()).
  await p.evaluate(() => {
    const Orig = window.QRCode;
    window.__qrTextos = [];
    window.QRCode = function (el, opts) { window.__qrTextos.push(opts.text); return new Orig(el, opts); };
    window.QRCode.CorrectLevel = Orig.CorrectLevel;
  });

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const capaTxt = (await p.locator('.rt-pagina-capa').first().innerText()).replace(/\s+/g, ' ');
  check('capa mostra o token e o PIN do motorista desta rota', /XYZ98765/.test(capaTxt) && /1234/.test(capaTxt), capaTxt);
  check('nenhum aviso de "sem token" quando o token existe', !/Nenhum token/.test(capaTxt), capaTxt);
  check('QR da capa é desenhado (canvas ou tabela, conforme a lib)', await p.locator('#rt-capa-qr canvas, #rt-capa-qr table').count() === 1);

  const qrTextos = await p.evaluate(() => window.__qrTextos);
  check('URL do QR da capa usa a zona real (7) e o módulo do Motorista', qrTextos.some(t => t.includes('/z/7/SIME_motorista.html?token=XYZ98765')), JSON.stringify(qrTextos));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 47c. Rota de instalação busca o token de INSTALADOR, não o de motorista
// — mesmo com os dois cadastrados pro mesmo código, nunca mistura os dois
// papéis. ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas.push({ id: 'r9', zona_id: 'z7', codigo: '009', nome: 'Rota 009 instalação', municipios: ['Campo Maior'], tipos: ['instalacao'], itinerario: null, urnas_estimadas: null, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null });
  m.sime_tokens = [
    { id: 'tok-mot', eleicao_id: 'el7', token: 'MOTOR0001', pin: '1111', tipo: 'motorista', rotas: ['009'] },
    { id: 'tok-ins', eleicao_id: 'el7', token: 'INST0002', pin: '2222', tipo: 'instalador', rotas: ['009'] },
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 009 — Rota 009 instalação")').locator('button:has-text("🖨️ Imprimir ficha")').click();
  await p.waitForTimeout(150);

  const capaTxt = (await p.locator('.rt-pagina-capa').first().innerText()).replace(/\s+/g, ' ');
  check('capa de rota de instalação mostra o tipo certo', /Rota de .*Instalação de seção/.test(capaTxt), capaTxt);
  check('capa usa o token de INSTALADOR (não o de motorista, mesmo os dois existindo pro mesmo código)', /INST0002/.test(capaTxt) && /2222/.test(capaTxt) && !/MOTOR0001/.test(capaTxt), capaTxt);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 47d. Impressão em lote ("Imprimir todas (tipo)") gera uma capa por rota,
// cada uma com o token certo pro seu próprio código — nunca colide entre
// rotas diferentes (é o bug real corrigido em SIME_tokens.html no mesmo dia:
// extrair só os dígitos do código perdia o prefixo de letra, UR7→007 por
// exemplo, casando com a rota errada; aqui as duas rotas do lote têm código
// puramente numérico, mas o teste cobre que cada ficha usa SEU PRÓPRIO
// token, não o da outra). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_tokens = [
    { id: 'tok1', eleicao_id: 'el7', token: 'ROTA001TK', pin: '0001', tipo: 'motorista', rotas: ['001'] },
    { id: 'tok4', eleicao_id: 'el7', token: 'ROTA004TK', pin: '0004', tipo: 'motorista', rotas: ['004'] },
  ];
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.selectOption('#rt-filtro-tipo', 'recolhimento_urna');
  await p.waitForTimeout(100);
  await p.click('button:has-text("🖨️ Imprimir todas")');
  await p.waitForTimeout(200);

  const paginasCapa = await p.locator('.rt-pagina-capa').count();
  check('1 capa por rota no lote (2 rotas)', paginasCapa === 2, String(paginasCapa));

  const capaTextos = await p.locator('.rt-pagina-capa').allInnerTexts();
  const capa001 = capaTextos.find(t => /Rota 001/.test(t)) || '';
  const capa004 = capaTextos.find(t => /Rota 004/.test(t)) || '';
  check('capa da Rota 001 mostra o token dela, não o da 004', /ROTA001TK/.test(capa001) && !/ROTA004TK/.test(capa001), capa001.replace(/\s+/g, ' '));
  check('capa da Rota 004 mostra o token dela, não o da 001', /ROTA004TK/.test(capa004) && !/ROTA001TK/.test(capa004), capa004.replace(/\s+/g, ' '));

  const qrCapaCanvases = await p.locator('[id^="rt-capa-qr-"] canvas, [id^="rt-capa-qr-"] table').count();
  check('cada capa do lote ganha seu próprio QR, ids sufixados sem colisão', qrCapaCanvases === 2, String(qrCapaCanvases));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 48. "📋 Protocolo de entrega" e "✅ Check list do veículo" (02/10/2026,
// pedido direto: "inclua o relatório no sime, para imprimir junto com as
// rotas", depois separados em 3 relatórios independentes: "faça 3
// relatório separados, o de rotas, os protocolos e o checklist de modo que
// o checklist que tem mais folhas possa ser impresso em frente e verso") —
// os dois botões só aparecem pra rota com tipo 'distribuicao' (r1): r2 (só
// recolhimento_midia) e r4 (só recolhimento_urna, sem distribuicao) nunca
// mostram nenhum dos dois. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  const cardR1 = p.locator('.import-card:has-text("Rota 001 — Rota 001")');
  check('rota com tipo distribuicao mostra "Protocolo de entrega"', await cardR1.locator('button:has-text("📋 Protocolo de entrega")').count() === 1);
  check('rota com tipo distribuicao mostra "Check list do veículo"', await cardR1.locator('button:has-text("✅ Check list do veículo")').count() === 1);

  const cardR2 = p.locator('.import-card:has-text("Rota 002")');
  check('rota só de recolhimento_midia NUNCA mostra nenhum dos dois botões', await cardR2.locator('button:has-text("Protocolo de entrega"), button:has-text("Check list do veículo")').count() === 0);

  const cardR4 = p.locator('.import-card:has-text("Rota 004")');
  check('rota só de recolhimento_urna (sem distribuicao) NUNCA mostra nenhum dos dois botões', await cardR4.locator('button:has-text("Protocolo de entrega"), button:has-text("Check list do veículo")').count() === 0);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 49. "📋 Protocolo de entrega" imprime SÓ o protocolo (seções agrupadas
// por endereço, total de urnas, datas 03/10→04/10, motorista/placa/
// veículo/ano) — nunca o checklist (relatório separado agora, ver bloco
// 49b), numa chamada só de window.print(), com log de auditoria. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.responsavel_ator_id = 'a1';
  r1.placa = 'NHX1905'; r1.veiculo_descricao = 'GM/Classic Life'; r1.veiculo_ano = '2008 / 2008'; r1.veiculo_cor = 'Prata';
  r1.urnas_estimadas = 5;
  // s1/s2 no mesmo endereço — devem sair numa única linha agrupada
  // ("30, 31"), mesmo critério já usado no script avulso que este botão
  // substitui (ver sql/SIME_rotas_protocolo_entrega_checklist.sql).
  m.sime_secoes.find(s => s.id === 's1').endereco = 'Povoado Água Branca, S/N - Zona Rural';
  m.sime_secoes.find(s => s.id === 's2').endereco = 'Povoado Água Branca, S/N - Zona Rural';
  const a1 = m.sime_atores.find(a => a.id === 'a1');
  a1.telefone_whatsapp = '5586999998888'; a1.cnh_numero = '0237167878'; a1.cnh_categoria = 'D';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("📋 Protocolo de entrega")').click();
  await p.waitForTimeout(150);

  check('imprime numa chamada só de window.print()', await p.evaluate(() => window.__printCalls) === 1);
  const printHtml = await p.locator('#print-area').innerHTML();
  check('protocolo mostra "ROTA 01" (número curto a partir do código)', /ROTA 01/.test(printHtml), printHtml.slice(0, 400));
  check('protocolo agrupa as 2 seções do mesmo endereço numa linha só, com a quantidade certa', /30, 31[\s\S]{0,200}Povoado Água Branca/.test(printHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')), printHtml);
  check('total de urnas vem de urnas_estimadas', /TOTAL[\s\S]{0,80}5/.test(printHtml), printHtml);
  check('mostra motorista/telefone/placa/veículo/ano', /JOAO MOTORISTA/.test(printHtml) && /\(86\) 99999-8888/.test(printHtml) && /NHX1905/.test(printHtml) && /GM\/Classic Life/.test(printHtml) && /2008 \/ 2008/.test(printHtml), printHtml);
  check('mostra as datas fixas de entrega (03/10) e recolhimento (04/10)', /03\/10\/2026/.test(printHtml) && /04\/10\/2026/.test(printHtml), printHtml);
  check('NUNCA imprime o checklist junto (0 páginas .cl-pagina)', await p.locator('.cl-pagina').count() === 0);
  check('só 1 página .pe-pagina (1 rota)', await p.locator('.pe-pagina').count() === 1);

  const log = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_protocolo_entrega_impresso'));
  check('log de auditoria com rota/código/quantidade certos', log?.payload?.rota_id === 'r1' && log?.payload?.codigo === '001' && log?.payload?.quantidade === 2, JSON.stringify(log));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 49b. "✅ Check list do veículo" imprime SÓ o checklist, SEMPRE em 2
// páginas fixas (.cl-pagina-a com dados fixos 1-6, .cl-pagina-b com as
// vistorias 7-13) — nunca o protocolo — pronto pra duplex: a página A é a
// frente, a B o verso da mesma folha. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.responsavel_ator_id = 'a1';
  r1.placa = 'NHX1905'; r1.veiculo_descricao = 'GM/Classic Life'; r1.veiculo_ano = '2008 / 2008'; r1.veiculo_cor = 'Prata';
  const a1 = m.sime_atores.find(a => a.id === 'a1');
  a1.telefone_whatsapp = '5586999998888'; a1.cnh_numero = '0237167878'; a1.cnh_categoria = 'D';
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("✅ Check list do veículo")').click();
  await p.waitForTimeout(150);

  check('imprime numa chamada só de window.print()', await p.evaluate(() => window.__printCalls) === 1);
  check('NUNCA imprime o protocolo junto (0 páginas .pe-pagina)', await p.locator('.pe-pagina').count() === 0);
  check('sempre exatamente 2 páginas fixas (cl-pagina-a + cl-pagina-b)', await p.locator('.cl-pagina').count() === 2);

  const pagina1 = await p.locator('.cl-pagina-a').innerHTML();
  check('página 1 (frente) tem os dados fixos: contrato/contratada/motorista/CNH/veículo', /Contrato TRE-PI/.test(pagina1) && /JOAO MOTORISTA/.test(pagina1) && /0237167878/.test(pagina1) && />D</.test(pagina1) && /<td class="cl-v">GM<\/td>/.test(pagina1) && /Classic Life/.test(pagina1) && /Prata/.test(pagina1), pagina1);
  check('página 1 NÃO tem as seções de vistoria (7-13)', !/PNEUS|RETROVISORES|OBSERVAÇÕES/.test(pagina1), pagina1);

  const pagina2 = await p.locator('.cl-pagina-b').innerHTML();
  check('página 2 (verso) tem as 5 seções de vistoria + observações + identificação', /PNEUS/.test(pagina2) && /FARÓIS/.test(pagina2) && /LANTERNAS DE PISCA-ALERTA/.test(pagina2) && /LUZES E BUZINA/.test(pagina2) && /RETROVISORES/.test(pagina2) && /OBSERVAÇÕES/.test(pagina2) && /IDENTIFICAÇÃO DOS ENVOLVIDOS/.test(pagina2), pagina2);
  check('página 2 NÃO repete os dados fixos da página 1', !/Contrato TRE-PI/.test(pagina2), pagina2);

  // 02/10/2026, pedido direto com o PDF oficial anexado: "no check lista
  // quero que contenha os campos" — as 5 seções de vistoria tinham só
  // caixas em branco antes; viraram os campos reais do formulário.
  check('PNEUS tem os 3 estados (dianteiros/traseiros¹/traseiros²) com Novo/Meia-vida/Careca, direito e esquerdo', (pagina2.match(/Novo \(&nbsp;\)/g) || []).length === 6 && /Estado dos dianteiros/.test(pagina2) && /Estado dos traseiros¹/.test(pagina2) && /Estado dos traseiros²/.test(pagina2) && /Meia-vida/.test(pagina2) && /Careca/.test(pagina2), pagina2);
  check('FARÓIS tem Alto/Baixo/Meia-luz × direito/esquerdo com Aprovado/Desaprovado', /Alto/.test(pagina2) && /Baixo/.test(pagina2) && (pagina2.match(/Aprovado \(&nbsp;\)/g) || []).length >= 6, pagina2);
  check('LANTERNAS DE PISCA-ALERTA tem Dianteira/Traseira × direito/esquerdo com Aprovada/Desaprovada', /Dianteira/.test(pagina2) && /Traseira/.test(pagina2) && (pagina2.match(/Aprovada \(&nbsp;\)/g) || []).length >= 4, pagina2);
  check('LUZES E BUZINA tem Ré/Freio (direita+esquerda) e Placas/Buzina', />Ré</.test(pagina2) && />Freio</.test(pagina2) && />Placas</.test(pagina2) && />Buzina</.test(pagina2) && /direita/.test(pagina2) && /esquerda/.test(pagina2), pagina2);
  check('RETROVISORES tem direito/esquerdo com Aprovado/Desaprovado', /RETROVISORES[\s\S]*direito[\s\S]*esquerdo/.test(pagina2), pagina2);

  const log = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_checklist_veiculo_impresso'));
  check('log de auditoria com rota/código certos', log?.payload?.rota_id === 'r1' && log?.payload?.codigo === '001', JSON.stringify(log));

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 50. Sem veículo cadastrado (CRLV indisponível na planilha-fonte) — o
// protocolo mostra "— (sem CRLV disponível)" e o checklist avisa (na
// página 2, junto das vistorias), sem travar nem inventar marca/modelo/CNH
// nenhum. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.responsavel_ator_id = 'a1';
  // veiculo_descricao/ano/cor/placa continuam null (default do mock) —
  // a1 sem cnh_numero/cnh_categoria também.
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("📋 Protocolo de entrega")').click();
  await p.waitForTimeout(150);
  const printHtmlProtocolo = await p.locator('#print-area').innerHTML();
  check('protocolo mostra "sem CRLV disponível" no lugar do tipo de veículo', /sem CRLV disponível/.test(printHtmlProtocolo), printHtmlProtocolo);

  await p.locator('.import-card:has-text("Rota 001 — Rota 001")').locator('button:has-text("✅ Check list do veículo")').click();
  await p.waitForTimeout(150);
  const printHtmlChecklist = await p.locator('#print-area').innerHTML();
  check('checklist mostra o aviso de CRLV indisponível', /CRLV dispon[ií]vel.*confirmados na própria vistoria|Este veículo não tinha CRLV/.test(printHtmlChecklist), printHtmlChecklist);
  check('checklist nunca inventa CNH — mostra travessão', /CNH nº:<\/td><td class="cl-v">—<\/td>/.test(printHtmlChecklist), printHtmlChecklist);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 51. Botões em lote ("📋 Imprimir protocolos" e "✅ Imprimir checklists
// (frente e verso)") só aparecem com o filtro em "Distribuição de urnas" —
// nunca com outro tipo escolhido — e imprimem as rotas ATIVAS de
// distribuição concatenadas, ignorando mídia/recolhimento_urna-sem-
// distribuicao, cada um no SEU PRÓPRIO job de impressão (nunca juntos).
// Mock ganha r5, 2ª rota de distribuição, pra testar concatenação de
// verdade (r1 sozinha não provaria que o lote itera mais de uma). ──
{
  const ctx = await b.newContext();
  const m = mock();
  m.sime_rotas.push({ id: 'r5', zona_id: 'z7', codigo: '005', nome: 'Rota 005', municipios: ['Campo Maior'], tipos: ['distribuicao'], itinerario: null, urnas_estimadas: 3, ativo: true, ponto_partida: null, destino: null, horario_saida: null, horario_chegada_previsto: null, responsavel_ator_id: null });
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  check('sem filtro de tipo, nenhum dos dois botões de lote aparece', await p.locator('button:has-text("Imprimir protocolos"), button:has-text("Imprimir checklists")').count() === 0);

  await p.selectOption('#rt-filtro-tipo', 'recolhimento_midia');
  await p.waitForTimeout(100);
  check('com outro tipo escolhido (recolhimento_midia), os dois continuam ausentes', await p.locator('button:has-text("Imprimir protocolos"), button:has-text("Imprimir checklists")').count() === 0);

  await p.selectOption('#rt-filtro-tipo', 'distribuicao');
  await p.waitForTimeout(100);
  const botaoProtocolos = await p.locator('button:has-text("📋 Imprimir protocolos")').textContent();
  check('com "Distribuição de urnas" escolhido, "Imprimir protocolos" aparece com a contagem certa (r1+r5=2)', /2 rota/.test(botaoProtocolos), botaoProtocolos);
  const botaoChecklists = await p.locator('button:has-text("✅ Imprimir checklists")').textContent();
  check('"Imprimir checklists (frente e verso)" também aparece com a contagem certa', /frente e verso.*2 rota/.test(botaoChecklists), botaoChecklists);

  await p.click('button:has-text("📋 Imprimir protocolos")');
  await p.waitForTimeout(200);
  check('protocolos: imprime numa chamada só de window.print()', await p.evaluate(() => window.__printCalls) === 1);
  let printHtml = await p.locator('#print-area').innerHTML();
  check('protocolo das 2 rotas de distribuição saem concatenados', /ROTA 01/.test(printHtml) && /ROTA 05/.test(printHtml), printHtml.slice(0, 400));
  check('só páginas de protocolo (2), nunca checklist junto', await p.locator('.pe-pagina').count() === 2 && await p.locator('.cl-pagina').count() === 0);
  let log = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_protocolo_entrega_impresso_lote'));
  check('log em lote (protocolos) com quantidade/códigos certos', log?.payload?.quantidade === 2 && (log?.payload?.rotas || []).sort().join(',') === '001,005', JSON.stringify(log));

  await p.click('button:has-text("✅ Imprimir checklists")');
  await p.waitForTimeout(200);
  check('checklists: imprime numa chamada só de window.print() (2ª chamada da sessão)', await p.evaluate(() => window.__printCalls) === 2);
  printHtml = await p.locator('#print-area').innerHTML();
  check('checklist das 2 rotas de distribuição saem concatenados', /Rota 01 —/.test(printHtml) && /Rota 05 —/.test(printHtml), printHtml.slice(0, 400));
  check('só páginas de checklist (4 = 2 rotas × 2 páginas fixas), nunca protocolo junto', await p.locator('.cl-pagina').count() === 4 && await p.locator('.pe-pagina').count() === 0);
  check('2 páginas A (frente) + 2 páginas B (verso), uma de cada por rota', await p.locator('.cl-pagina-a').count() === 2 && await p.locator('.cl-pagina-b').count() === 2);
  log = await p.evaluate(() => window.__mock.sime_logs.find(l => l.acao === 'rota_checklist_veiculo_impresso_lote'));
  check('log em lote (checklists) com quantidade/códigos certos', log?.payload?.quantidade === 2 && (log?.payload?.rotas || []).sort().join(',') === '001,005', JSON.stringify(log));

  // Verificação de paginação FÍSICA de verdade (mesmo critério já usado em
  // todo o resto do módulo) — é o que de fato prova que "frente e verso"
  // funciona: 2 rotas × 2 páginas fixas = 4 páginas físicas, nunca 3 nem 5
  // (o que indicaria overflow/corte no meio de uma rota, quebrando o
  // alinhamento duplex entre folhas).
  await p.emulateMedia({ media: 'print' });
  const pdf = await p.pdf();
  const pdfStr = pdf.toString('latin1');
  const paginasFisicas = (pdfStr.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  check('PDF de verdade sai com exatamente 4 páginas (2 rotas × 2 páginas fixas, pronto pra duplex)', paginasFisicas === 4, `paginasFisicas=${paginasFisicas} pdfBytes=${pdf.length}`);
  await p.emulateMedia({ media: 'screen' });

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 51b. Os dois botões em lote somem sozinhos sem nenhuma rota de
// distribuição ATIVA (nunca inventam um lote vazio); avisam por toast e não
// chamam window.print(), cada um com a mesma mensagem. ──
{
  const ctx = await b.newContext();
  const m = mock();
  const r1 = m.sime_rotas.find(r => r.id === 'r1');
  r1.ativo = false; // única rota de distribuição do mock, agora inativa
  const { p, erros } = await abrir(ctx, m);
  await login(p);
  await p.waitForTimeout(200);

  await p.selectOption('#rt-filtro-tipo', 'distribuicao');
  await p.waitForTimeout(100);
  const botaoProtocolos = await p.locator('button:has-text("📋 Imprimir protocolos")').textContent();
  check('contagem de protocolos zera quando a única rota de distribuição está inativa', /0 rota/.test(botaoProtocolos), botaoProtocolos);
  const botaoChecklists = await p.locator('button:has-text("✅ Imprimir checklists")').textContent();
  check('contagem de checklists também zera', /0 rota/.test(botaoChecklists), botaoChecklists);

  await p.click('button:has-text("📋 Imprimir protocolos")');
  await p.waitForTimeout(150);
  check('não chama window.print() (protocolos) sem nenhuma rota ativa', await p.evaluate(() => window.__printCalls) === 0);
  let toast = await p.locator('.toast').textContent().catch(() => '');
  check('avisa por toast em vez de imprimir protocolo vazio', /[Nn]enhuma rota de distribui[cç][aã]o ativa/.test(toast), toast);

  await p.click('button:has-text("✅ Imprimir checklists")');
  await p.waitForTimeout(150);
  check('não chama window.print() (checklists) sem nenhuma rota ativa', await p.evaluate(() => window.__printCalls) === 0);
  toast = await p.locator('.toast').textContent().catch(() => '');
  check('avisa por toast em vez de imprimir checklist vazio', /[Nn]enhuma rota de distribui[cç][aã]o ativa/.test(toast), toast);

  check('zero erros JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();
const falhou = results.filter(r => !r.ok);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.n}${r.e ? `  [${r.e}]` : ''}`));
console.log(`\n${results.length - falhou.length} passed, ${falhou.length} failed`);
process.exit(falhou.length ? 1 : 0);
