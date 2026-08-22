// Testa a aba "Disparo em massa" do SIME_atores.html — populamos
// sime_campanhas_confirmacao, a fila que o Hermes Agent (bot WhatsApp, fora
// deste repo) já está preparado para consumir e enviar (respeitando 5
// msgs/min, só quando DISPATCH_ATIVO estiver ligado no Hermes).
//
// O que precisa estar certo:
//   - modelo "alerta anti-golpe" pré-preenchido, editável;
//   - contagem de destinatários reflete o filtro por função (só ativos com
//     telefone), e trocar o filtro não apaga o que a pessoa já escreveu;
//   - confirmação (irreversível o suficiente pra pedir) antes de enfileirar;
//   - zona vem do usuário logado, nunca de um campo na tela;
//   - sem sessão, a aba não oferece um formulário que falharia.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
let __idSeq = 0;
class QB {
  constructor(t){ this.t=t; this.f={}; this._insertPayload=null; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  insert(p){
    window.__mock.escritas.push({ op:'insert', tabela:this.t, payload:p });
    this._insertPayload = p;
    return this;
  }
  // Encadeado só depois de insert() nesta stub — ex.: sime_campanhas.insert({...}).select('id').single()
  // (criarNovaCampanhaDisparo). Gera um id novo e devolve como se o banco tivesse gerado.
  single(){
    const id = 'novo-' + (++__idSeq);
    const linha = { id, ...(this._insertPayload||{}) };
    (window.__mock[this.t] ||= []).push(linha);
    return Promise.resolve({ data:{ id }, error:null });
  }
  maybeSingle(){ const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v)); return Promise.resolve({ data:r[0]??null, error:null }); }
  then(res){
    if(this._insertPayload) return res({ error:null }); // insert simples (sem .select().single() encadeado)
    const r=(window.__mock[this.t]||[]).filter(x=>Object.entries(this.f).every(([k,v])=>x[k]===v)); return res({ data:r, error:null });
  }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(){ const c={ on(){return c;}, subscribe(){return c;} }; return c; },
    removeChannel(){},
    rpc(){ return Promise.resolve({ data:null, error:null }); },
    auth: {
      async getSession(){ return { data:{ session: window.__mock.semSessao ? null : { user:{ id:'auth-maria' } } } }; },
      async getUser(){ return { data:{ user:{ id:'auth-maria' } } }; },
    },
  };
}
`;

function mock({ semSessao = false } = {}) {
  return {
    escritas: [], semSessao,
    sime_usuarios: [{ id:'u-maria', nome:'Maria', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' }],
    sime_secoes: [{ id:'s63', numero:63, local_nome:'G.E. Treze de Março', municipio:'Campo Maior' }],
    sime_contatos_externos: [],
    sime_atores: [
      { id:'a1', nome_completo:'ANA SOUSA',     telefone_whatsapp:'5586999996666', funcao:'mesario', funcao_mesa:'Presidente', secao_id:'s63', confirmacao:'pendente', ativo:true },
      { id:'a2', nome_completo:'BRUNO DIAS',    telefone_whatsapp:'5586988887777', funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:'s63', confirmacao:'pendente', ativo:true },
      { id:'a3', nome_completo:'CARLA TÉCNICA', telefone_whatsapp:'5586977776666', funcao:'tecnico', funcao_mesa:null, secao_id:null, confirmacao:'pendente', ativo:true },
      { id:'a4', nome_completo:'DÉBORA INATIVA',telefone_whatsapp:'5586966665555', funcao:'mesario', funcao_mesa:'1º Mesário', secao_id:'s63', confirmacao:'recusou', ativo:false },
      { id:'a5', nome_completo:'SEM TELEFONE',  telefone_whatsapp:'',              funcao:'mesario', funcao_mesa:'1º Secretário', secao_id:'s63', confirmacao:'pendente', ativo:true },
    ],
    // 21/08/2026: campanha agora é obrigatória em qualquer disparo (não só
    // "script") — uma já 'ativa' pronta pra testes que não são sobre criar
    // campanha nova.
    sime_campanhas: [
      { id:'camp-ativa', nome:'Campanha de teste', status:'ativa', zona_id:'z7', created_at:'2026-08-01T00:00:00Z' },
    ],
  };
}

async function abrir(ctx, m) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((x) => { window.__mock = x; }, m);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_atores.html');
  await p.waitForTimeout(600);
  await p.click('#tab-disparo-btn');
  await p.waitForTimeout(300);
  return { p, erros };
}

// ── 1. Modelo anti-golpe pré-preenchido; contagem correta (3 de 5: ativos+telefone) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  const msg = await p.inputValue('#dp-msg');
  check('mensagem pré-preenchida com o alerta anti-golpe', msg.includes('AVISO IMPORTANTE'), msg.slice(0, 40));
  const contagem = await p.textContent('#dp-contagem');
  check('contagem ignora inativos e sem telefone (3 de 5)', contagem.includes('3'), contagem);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Trocar o filtro de função não apaga a mensagem já editada ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.fill('#dp-msg', 'Mensagem customizada pelo cartório');
  await p.selectOption('#dp-funcao', 'tecnico');
  await p.waitForTimeout(150);
  const msg = await p.inputValue('#dp-msg');
  check('mensagem editada continua lá após trocar destinatário', msg === 'Mensagem customizada pelo cartório', msg);
  const contagem = await p.textContent('#dp-contagem');
  check('contagem atualiza pro filtro (1 técnico ativo)', contagem.includes('1'), contagem);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Trocar de modelo pra "livre" limpa a mensagem (esperado) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.selectOption('#dp-tipo', 'livre');
  await p.waitForTimeout(150);
  const msg = await p.inputValue('#dp-msg');
  check('modelo livre começa vazio', msg === '', JSON.stringify(msg));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Sem campanha escolhida, "Enfileirar" não abre o modal (validação) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.click('#dp-btn-enviar');
  await p.waitForTimeout(150);
  check('modal de confirmação não abriu sem campanha', await p.locator('#confirmacao-ok-btn').count() === 0);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Com campanha escolhida, confirmar dispara o insert com zona/mensagem/destinatários/campanha_id corretos ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.selectOption('#dp-campanha', 'camp-ativa');
  await p.waitForTimeout(150);
  await p.click('#dp-btn-enviar');
  await p.waitForTimeout(150);
  await p.click('#confirmacao-ok-btn'); // modal customizado (não mais confirm() nativo)
  await p.waitForTimeout(300);

  const escritas = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_campanhas_confirmacao'));
  check('1 chamada de insert', escritas.length === 1, JSON.stringify(escritas));
  const linhas = escritas[0]?.payload || [];
  check('3 linhas (ativos com telefone)', linhas.length === 3, JSON.stringify(linhas));
  check('todas com status pendente', linhas.every(l => l.status === 'pendente'), JSON.stringify(linhas));
  check('todas com a mesma mensagem (o template)', linhas.every(l => l.mensagem_enviada.includes('AVISO IMPORTANTE')));
  check('zona vem do usuário logado (z7), não de campo na tela', linhas.every(l => l.zona_id === 'z7'), JSON.stringify(linhas));
  check('telefone e ator_id batem com o cadastro', linhas.some(l => l.ator_id === 'a1' && l.telefone_whatsapp === '5586999996666'), JSON.stringify(linhas));
  check('toda linha carrega o campanha_id escolhido', linhas.every(l => l.campanha_id === 'camp-ativa'), JSON.stringify(linhas));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5b. "+ Nova campanha" cria a campanha (status ativa) e já fica selecionada ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.selectOption('#dp-campanha', '__nova__');
  await p.waitForTimeout(150);
  await p.fill('#dp-campanha + div input[type="text"]', 'Campanha nova de teste');
  await p.click('#dp-campanha + div >> text=Criar');
  await p.waitForTimeout(300);

  const escritasCampanha = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_campanhas'));
  check('criou a campanha com status ativa', escritasCampanha.length === 1 && escritasCampanha[0].payload.status === 'ativa', JSON.stringify(escritasCampanha));

  await p.click('#dp-btn-enviar');
  await p.waitForTimeout(150);
  await p.click('#confirmacao-ok-btn');
  await p.waitForTimeout(300);
  const escritasFila = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_campanhas_confirmacao'));
  const novoId = escritasCampanha[0]?.payload ? (await p.evaluate(() => window.__mock.sime_campanhas.find(c => c.nome === 'Campanha nova de teste')?.id)) : null;
  check('a campanha recém-criada já ficou selecionada pro enfileiramento', escritasFila[0]?.payload.every(l => l.campanha_id === novoId), JSON.stringify({ novoId, payload: escritasFila[0]?.payload }));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Cancelar a confirmação não enfileira nada ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());
  await p.selectOption('#dp-campanha', 'camp-ativa');
  await p.waitForTimeout(150);
  await p.click('#dp-btn-enviar');
  await p.waitForTimeout(150);
  await p.click('#modal-body .btn-out'); // "Cancelar" no modal customizado
  await p.waitForTimeout(300);
  const escritas = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_campanhas_confirmacao'));
  check('cancelar não enfileira nada', escritas.length === 0, JSON.stringify(escritas));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Sem sessão: não oferece o botão de enviar ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock({ semSessao: true }));
  check('sem sessão: sem botão de enviar', await p.locator('#dp-btn-enviar').count() === 0);
  check('sem sessão: avisa pra entrar com a conta', (await p.textContent('#content')).includes('Entre com a conta'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 8. Reforço perto do Dia D: dois modelos novos, disparo manual (sob demanda) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, mock());

  await p.selectOption('#dp-tipo', 'lembrete_vespera');
  await p.waitForTimeout(150);
  const msgVespera = await p.inputValue('#dp-msg');
  check('lembrete de véspera pré-preenchido', /D-1 é amanhã|Dia D|amanhã/i.test(msgVespera) && msgVespera.includes('{nome}'), msgVespera.slice(0, 80));

  await p.selectOption('#dp-tipo', 'confirmacao_diad');
  await p.waitForTimeout(150);
  const msgDiaD = await p.inputValue('#dp-msg');
  check('confirmação de presença do Dia D pré-preenchida', /confirmado/i.test(msgDiaD) && msgDiaD.includes('{secao}'), msgDiaD.slice(0, 80));

  await p.selectOption('#dp-campanha', 'camp-ativa');
  await p.waitForTimeout(150);
  await p.click('#dp-btn-enviar');
  await p.waitForTimeout(150);
  await p.click('#confirmacao-ok-btn');
  await p.waitForTimeout(300);
  const escritas = await p.evaluate(() => window.__mock.escritas.filter(e => e.tabela === 'sime_campanhas_confirmacao'));
  check('enfileira normalmente, mesmo motor dos outros modelos', escritas.length === 1 && escritas[0].payload.every(l => l.status === 'pendente'), JSON.stringify(escritas));
  check('mensagem enfileirada já personalizada (sem chaves sobrando)', escritas[0]?.payload.every(l => !l.mensagem_enviada.includes('{nome}')), JSON.stringify(escritas[0]?.payload));

  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
