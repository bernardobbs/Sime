// Testa SIME_problemas.html — a tela de trabalho sobre um problema.
//
// O que ela precisa acertar, na ordem em que importa no dia 4:
//   1. O contato oferecido é FUNÇÃO DO TIPO do problema. Faltou luz → Equatorial;
//      urna com defeito → auxiliar de eleição (contratado do TRE que faz
//      manutenção de urna); faltou mesário → a própria mesa. Oferecer o
//      contato errado custa minutos que a seção não tem.
//   2. Quem assume cuida até o fim — assumir o que já tem dono não pode
//      trocar o responsável em silêncio; para isso existe delegar, com motivo.
//   3. Filtro Meus/Todos, com as órfãs sempre visíveis nos dois.
//   4. Prioridade declarada manda na ordem de exibição, editável a
//      qualquer momento — não só "na abertura" (a maioria nasce pelo
//      gatilho automático do campo, sem nenhum humano no instante).
//   5. "Aguardando terceiro" distingue quem está trabalhando de quem só
//      espera resposta de fora, sem virar um status novo.
//   6. Chamado resolvido continua consultável pela busca dedicada, mesmo
//      tendo saído da lista principal de ativos.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const STUB_SUPABASE_JS = `
function rowsFor(t) { return (window.__mock[t] || []); }
function match(row, f) { return Object.entries(f).every(([k,v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v); }
class QB {
  constructor(t){ this.t=t; this.f={}; }
  select(){ return this; }
  eq(c,v){ this.f[c]=v; return this; }
  in(c,v){ this.f[c]=v; return this; }
  order(){ return this; }
  limit(){ return this; }
  maybeSingle(){ const r=rowsFor(this.t).filter(x=>match(x,this.f)); return Promise.resolve({ data:r[0]??null, error:null }); }
  then(res){ const r=rowsFor(this.t).filter(x=>match(x,this.f)); return res({ data:r, error:null }); }
}
export function createClient(){
  return {
    from(t){ return new QB(t); },
    channel(){ const c={ on(){return c;}, subscribe(){return c;} }; return c; },
    removeChannel(){},
    rpc(nome, params){
      window.__mock.rpcCalls.push({ nome, params });
      const erro = window.__mock.rpcErros?.[nome];
      if (erro) return Promise.resolve({ data:null, error:{ message: erro } });
      return Promise.resolve({ data:{}, error:null });
    },
    auth: {
      async signInWithPassword(){ return { error:null }; },
      async getSession(){ return { data:{ session:{ user:{ id:'auth-maria' } } } }; },
      async getUser(){ return { data:{ user:{ id:'auth-maria' } } }; },
      async signOut(){ return {}; },
    },
  };
}
`;

const SEC_63 = 'sec-63', SEC_99 = 'sec-99';

function baseMock({ tipo = 'energia', responsavel = null, nivel = 0, externos = true, auxiliar = true } = {}) {
  return {
    rpcCalls: [], rpcErros: {},
    sime_usuarios: [
      { id:'u-maria', nome:'Maria Gomes', perfil:'coordenador', zona_id:'z7', ativo:true, auth_user_id:'auth-maria' },
      { id:'u-joao',  nome:'João Silva',  perfil:'gestor_prob', zona_id:'z7', ativo:true, auth_user_id:'auth-joao' },
      // Token de TV entra como observador — não é gente pra quem se delega.
      { id:'u-tv',    nome:'Token tv',    perfil:'observador',  zona_id:'z7', ativo:true, auth_user_id:'auth-tv' },
    ],
    sime_zonas: [{ id:'z7', numero:7, municipio:'Campo Maior' }],
    sime_eleicoes: [{ id:'ele-1', zona_id:'z7', turno:1, ativa:true }],
    sime_secoes: [
      { id:SEC_63, numero:63, local_nome:'G.E. Treze de Março', municipio:'Campo Maior' },
      // Mesmo LOCAL da 63: é onde se prova que auxiliar e acessibilidade são
      // encontrados pelo local, não pela seção exata.
      { id:SEC_99, numero:99, local_nome:'G.E. Treze de Março', municipio:'Campo Maior' },
    ],
    sime_atores: [
      { nome_completo:'Ana Paula Sousa', telefone_whatsapp:'5586999996666', funcao:'mesario', funcao_mesa:'Presidente', secao_id:SEC_63, ativo:true },
      { nome_completo:'Bruno Dias',      telefone_whatsapp:'86988887777',   funcao:'mesario', funcao_mesa:'2º Mesário', secao_id:SEC_63, ativo:true },
      { nome_completo:'Juiz Fulano',     telefone_whatsapp:'86911112222',   funcao:'junta_eleitoral', funcao_mesa:'Presidente', secao_id:SEC_63, ativo:true },
      { nome_completo:'Carlos Coord',    telefone_whatsapp:'86955554444',   funcao:'coord_acessibilidade', funcao_mesa:null, secao_id:SEC_99, ativo:true },
      ...(auxiliar ? [{ nome_completo:'Pedro Técnico', telefone_whatsapp:'86933332222', funcao:'auxiliar_eleicao', funcao_mesa:null, secao_id:SEC_99, ativo:true }] : []),
    ],
    sime_contatos_externos: externos ? [
      { tipo:'energia', nome:'Equatorial — plantão Campo Maior', municipio:'Campo Maior', telefone:'8632221111', whatsapp:true, ativo:true },
      { tipo:'energia', nome:'Equatorial — geral da zona', municipio:null, telefone:'0800111222', whatsapp:false, ativo:true },
      { tipo:'pm', nome:'PM — 3º Pelotão Campo Maior', municipio:'Campo Maior', telefone:'8632223333', whatsapp:false, ativo:true },
    ] : [],
    sime_ocorrencias: [
      { id:'oc-1', numero:7, secao_id:SEC_63, tipo, status: responsavel ? 'assumida' : 'aberta',
        descricao:null, responsavel_id: responsavel, aberta_em: new Date(Date.now()-14*60000).toISOString(),
        assumida_em: responsavel ? new Date().toISOString() : null, nivel_escalonamento: nivel, origem:'mesario' },
    ],
    sime_ocorrencia_eventos: [
      { acao:'abriu', detalhe:null, autor_id:null, criado_em:new Date(Date.now()-14*60000).toISOString() },
    ],
  };
}

async function abrir(ctx, mock) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.addInitScript((m) => { window.__mock = m; }, mock);
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status:200, contentType:'application/javascript', body: STUB_SUPABASE_JS }));
  await p.goto('http://localhost:8917/modules/SIME_problemas.html');
  await p.waitForTimeout(700);
  return { p, erros };
}

// ── 1. Faltou luz → Equatorial em primeiro lugar ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'energia' }));
  check('lista mostra o problema', await p.locator('.prob').count() === 1);

  // Número de chamado — pedido direto: "cada problema pode receber um
  // número tipo um chamado?" (sime_ocorrencias.numero, gerado no banco).
  const cardTxt = await p.locator('.prob-sec').first().textContent();
  check('card mostra o número do chamado (#007)', cardTxt.includes('#007'), cardTxt);

  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);

  const shTxt = await p.locator('.sh-t1').textContent();
  check('detalhe também mostra o número do chamado', shTxt.includes('#007'), shTxt);

  const papeis = await p.locator('.ct-papel').allTextContents();
  check('energia: Equatorial é o primeiro contato', papeis[0] === 'Equatorial', papeis.join(' | '));
  check('energia: mesário continua disponível como apoio', papeis.includes('Presidente'), papeis.join(' | '));

  const destaque = await p.locator('.ct.destaque .ct-nome').textContent();
  check('energia: contato do município da seção vence o geral da zona',
    destaque.includes('Campo Maior'), destaque);

  const linkMsg = await p.locator('.ct.destaque').getAttribute('href');
  check('link de contato inclui o número do chamado na mensagem pré-pronta',
    decodeURIComponent(linkMsg).includes('Chamado #007'), linkMsg);

  // Botões só-ícone sem aria-label (achado "baixo") + alvo de toque do fechar
  check('botão de fechar o detalhe tem aria-label', await p.locator('.sh-x[aria-label="Fechar"]').count() === 1);
  const fecharBox = await p.locator('.sh-x').first().evaluate(el => el.getBoundingClientRect());
  check('botão de fechar tem alvo de toque ≥44px', fecharBox.width >= 44 && fecharBox.height >= 44, JSON.stringify(fecharBox));
  check('login tem labels associadas (não só placeholder)',
    await p.locator('label[for="login-email"]').count() === 1 && await p.locator('label[for="login-pass"]').count() === 1);

  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2. Urna com problema → auxiliar de eleição (contratado do TRE) ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'urna' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);

  const papeis = await p.locator('.ct-papel').allTextContents();
  check('urna: auxiliar de eleição é o primeiro contato',
    papeis[0] === 'Auxiliar de eleição (TRE)', papeis.join(' | '));
  check('urna: NÃO oferece a Equatorial', !papeis.includes('Equatorial'), papeis.join(' | '));

  const href = await p.locator('.ct.destaque').getAttribute('href');
  check('urna: link do auxiliar é WhatsApp sem 55 duplicado',
    href.includes('wa.me/5586933332222'), href);
  check('urna: auxiliar foi achado pelo LOCAL (está cadastrado na seção 99)', !!href);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 2b. SOS (genérico) → mesa primeiro, PM como opção secundária ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'sos' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);

  const papeis = await p.locator('.ct-papel').allTextContents();
  check('sos: mesa é o primeiro contato (toque não carrega motivo)',
    papeis[0] === 'Presidente', papeis.join(' | '));
  check('sos: Polícia Militar aparece como opção secundária',
    papeis.includes('Polícia Militar'), papeis.join(' | '));

  const href = await p.locator('.ct-papel:text("Polícia Militar")').locator('xpath=ancestor::a').getAttribute('href');
  check('sos: contato da PM é do município da seção', href?.includes('8632223333'), href);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 3. Faltou mesário → a própria mesa, e nunca a junta eleitoral ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'mesa_incompleta' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);

  const papeis = await p.locator('.ct-papel').allTextContents();
  check('mesa incompleta: mesário é o primeiro contato', papeis[0] === 'Presidente', papeis.join(' | '));

  const hrefs = await p.locator('.ct').evaluateAll(els => els.map(e => e.getAttribute('href')));
  check('mesa incompleta: chama o Presidente, não o 2º mesário',
    hrefs[0].includes('5586999996666'), hrefs[0]);
  check('NUNCA contata a junta eleitoral', !hrefs.some(h => h.includes('86911112222')), hrefs.join(' | '));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 4. Telefone fixo vira tel:, não wa.me ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  mock.sime_contatos_externos = [
    { tipo:'energia', nome:'Equatorial — 0800', municipio:null, telefone:'0800111222', whatsapp:false, ativo:true },
  ];
  const { p, erros } = await abrir(ctx, mock);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  const href = await p.locator('.ct.destaque').getAttribute('href');
  check('contato sem WhatsApp abre discagem (tel:), não conversa vazia',
    href.startsWith('tel:'), href);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 5. Sem contato cadastrado: diz isso, em vez de botão morto ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'energia', externos:false }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  const papeis = await p.locator('.ct-papel').allTextContents();
  check('sem Equatorial cadastrada: não inventa botão', !papeis.includes('Equatorial'), papeis.join(' | '));
  check('mas ainda oferece a mesa como caminho', papeis.includes('Presidente'), papeis.join(' | '));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 6. Assumir / delegar — quem assume cuida até o fim ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'urna' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);

  check('sem dono: oferece Assumir', await p.locator('button:has-text("Assumir")').count() === 1);
  check('sem dono: NÃO oferece Delegar', await p.locator('button:has-text("Delegar")').count() === 0);

  await p.locator('button:has-text("Assumir")').click();
  await p.waitForTimeout(250);
  const chamadas = await p.evaluate(() => window.__mock.rpcCalls);
  check('Assumir chama sime_ocorrencia_assumir', chamadas.some(c => c.nome === 'sime_ocorrencia_assumir'),
    JSON.stringify(chamadas));
  const badgeCls = await p.locator('#sync-badge').getAttribute('class');
  check('badge de sync fica 🟢 depois de assumir com sucesso', badgeCls.includes('sync-ok'), badgeCls);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 7. Assumir o que já tem dono é recusado pelo servidor, e a tela diz ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna' });
  mock.rpcErros = { sime_ocorrencia_assumir: 'Ocorrência já tem responsável ou não está aberta' };
  const { p, erros } = await abrir(ctx, mock);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  await p.locator('button:has-text("Assumir")').click();
  await p.waitForTimeout(300);
  const toast = await p.locator('#toast').textContent();
  check('recusa do servidor aparece pro operador', toast.includes('já tem responsável'), toast);
  const badgeCls = await p.locator('#sync-badge').getAttribute('class');
  check('badge de sync vira 🔴 quando o servidor recusa (achado "alto" da auditoria)', badgeCls.includes('sync-fail'), badgeCls);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 8. Delegar exige motivo e não lista tokens de TV ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'urna', responsavel:'u-maria' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('com dono: oferece Delegar', await p.locator('button:has-text("Delegar")').count() === 1);

  await p.locator('button:has-text("Delegar")').click();
  await p.waitForTimeout(200);
  const opcoes = await p.locator('#del-quem option').allTextContents();
  check('delegar lista o gestor', opcoes.some(o => o.includes('João')), opcoes.join(' | '));
  check('delegar NÃO lista token de TV (observador)', !opcoes.some(o => o.includes('Token tv')), opcoes.join(' | '));
  check('delegar não lista você mesmo', !opcoes.some(o => o.includes('Maria')), opcoes.join(' | '));

  await p.locator('button:has-text("Confirmar delegação")').click();
  await p.waitForTimeout(250);
  const semMotivo = await p.evaluate(() => window.__mock.rpcCalls.filter(c => c.nome === 'sime_ocorrencia_delegar'));
  check('delegar sem motivo não chega a chamar o servidor', semMotivo.length === 0);
  check('e avisa o operador', (await p.locator('#toast').textContent()).includes('motivo'));

  await p.fill('#del-motivo', 'Precisa de técnico da urna');
  await p.locator('button:has-text("Confirmar delegação")').click();
  await p.waitForTimeout(250);
  const comMotivo = await p.evaluate(() => window.__mock.rpcCalls.filter(c => c.nome === 'sime_ocorrencia_delegar'));
  check('delegar com motivo chama o servidor', comMotivo.length === 1, JSON.stringify(comMotivo));
  check('motivo vai no payload', comMotivo[0]?.params?.p_motivo === 'Precisa de técnico da urna');
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 9. Resolver ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'energia', responsavel:'u-maria' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  await p.locator('button:has-text("Resolvido")').click();
  await p.waitForTimeout(200);
  await p.fill('#res-txt', 'Energia voltou');
  await p.locator('button:has-text("Confirmar resolução")').click();
  await p.waitForTimeout(250);
  const r = (await p.evaluate(() => window.__mock.rpcCalls)).filter(c => c.nome === 'sime_ocorrencia_resolver');
  check('resolver chama sime_ocorrencia_resolver', r.length === 1, JSON.stringify(r));
  check('resolução vai junto', r[0]?.params?.p_resolucao === 'Energia voltou');
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 10. Filtro Meus/Todos e as órfãs ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  mock.sime_ocorrencias = [
    { id:'oc-1', secao_id:SEC_63, tipo:'energia', status:'assumida', responsavel_id:'u-maria',
      aberta_em:new Date(Date.now()-5*60000).toISOString(), nivel_escalonamento:0, origem:'mesario' },
    { id:'oc-2', secao_id:SEC_63, tipo:'urna', status:'assumida', responsavel_id:'u-joao',
      aberta_em:new Date(Date.now()-6*60000).toISOString(), nivel_escalonamento:0, origem:'mesario' },
    { id:'oc-3', secao_id:SEC_99, tipo:'mesa_incompleta', status:'aberta', responsavel_id:null,
      aberta_em:new Date(Date.now()-40*60000).toISOString(), nivel_escalonamento:2, origem:'admin' },
  ];
  const { p, erros } = await abrir(ctx, mock);

  check('Todos mostra os 3', await p.locator('.prob').count() === 3);
  check('contador Todos = 3', (await p.locator('#n-todos').textContent()) === '3');
  // Achado "médio" da auditoria: o contador batia só com responsavel_id=EU,
  // divergindo da lista real de "Meus" (que também traz órfãs — ver abaixo).
  // Corrigido pra contar igual a visiveis(): o meu (oc-1) + a órfã (oc-3) = 2.
  check('contador Meus bate com o que "Meus" realmente mostra (2: o meu + a órfã)', (await p.locator('#n-meus').textContent()) === '2');
  check('avisa que há problema sem responsável',
    (await p.locator('.aviso-orfas').textContent()).includes('1 problema'));

  await p.locator('#f-meus').click();
  await p.waitForTimeout(200);
  const textos = await p.locator('.prob-sec').allTextContents();
  check('Meus traz o meu', textos.some(t => t.includes('63')), textos.join(' | '));
  check('Meus NÃO traz o do João', !textos.some(t => t.includes('Urna com problema')), textos.join(' | '));
  check('Meus TAMBÉM traz a órfã (ninguém pode perdê-la de vista)',
    textos.some(t => t.includes('Faltou mesário')), textos.join(' | '));

  check('escalonamento marca o cartão', await p.locator('.prob.escalado').count() === 1);
  check('e diz a quem foi escalado',
    (await p.locator('.prob.escalado').textContent()).includes('chefe'));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 11. Perfil decide o filtro inicial ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  mock.sime_usuarios[0].perfil = 'gestor_prob';   // Maria deixa de ser coordenadora
  const { p, erros } = await abrir(ctx, mock);
  check('gestor abre em "Meus" (sua fila de trabalho)',
    await p.locator('#f-meus.on').count() === 1);
  await ctx.close();

  const ctx2 = await b.newContext();
  const { p: p2 } = await abrir(ctx2, baseMock({ tipo:'energia' }));  // coordenador
  check('coordenador abre em "Todos" (precisa da visão inteira)',
    await p2.locator('#f-todos.on').count() === 1);
  await ctx2.close();
}

// ── 12. Nada aberto: a tela diz isso com clareza ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  mock.sime_ocorrencias = [];
  const { p, erros } = await abrir(ctx, mock);
  check('sem problemas: mostra estado vazio', await p.locator('.vazio').count() === 1);
  check('sem problemas: nenhum aviso de órfã', (await p.locator('#aviso-orfas').textContent()).trim() === '');
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 13. Falha de rede ao resolver mostra mensagem amigável, não o erro cru
// (bug real reportado: "ao resolver o problema aparece ⚠ TypeError: Failed
// to fetch" — o toast mostrava o texto do erro JS puro, direto do fetch que
// falhou, em vez de um aviso legível pra quem está no cartório. Mesmo padrão
// de mensagemErroAmigavel() já usado em SIME_admin.html). O card continua na
// lista (nada é fechado/recarregado à toa) — é só tentar de novo. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia', responsavel:'u-maria' });
  mock.rpcErros = { sime_ocorrencia_resolver: 'TypeError: Failed to fetch' };
  const { p, erros } = await abrir(ctx, mock);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  await p.locator('button:has-text("Resolvido")').click();
  await p.waitForTimeout(200);
  await p.locator('button:has-text("Confirmar resolução")').click();
  await p.waitForTimeout(250);

  const toast = await p.locator('#toast').textContent();
  check('falha de rede vira mensagem amigável, sem "TypeError" na tela',
    toast.includes('Sem conexão com o servidor') && !/TypeError/i.test(toast), toast);
  const badgeCls = await p.locator('#sync-badge').getAttribute('class');
  check('badge de sync vira 🔴 na falha de rede', badgeCls.includes('sync-fail'), badgeCls);
  check('card continua na lista (nada fechou/recarregou de propósito)',
    await p.locator('.prob').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// Mesmo tratamento em Assumir — a mesma classe de falha não deve mostrar o
// erro cru ali também.
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna' });
  mock.rpcErros = { sime_ocorrencia_assumir: 'TypeError: Failed to fetch' };
  const { p, erros } = await abrir(ctx, mock);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  await p.locator('button:has-text("Assumir")').click();
  await p.waitForTimeout(300);
  const toast = await p.locator('#toast').textContent();
  check('Assumir: falha de rede também vira mensagem amigável',
    toast.includes('Sem conexão com o servidor') && !/TypeError/i.test(toast), toast);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 14. Auxiliar de Eleição só vê URNA nos locais predeterminados
// (10/09/2026, pedido direto: "os auxiliares deverão ficar responsaveis por
// alguns locais de votação predeterminados, então o problema com urnas
// devem cair na pagina deles... somente daquelas urnas predeterminadas").
// Maria vira auxiliar_eleicao, atribuída só ao local da seção 63/99
// (G.E. Treze de Março); um problema de urna FORA desse local e um problema
// de ENERGIA dentro dele são os dois casos que precisam sumir da lista. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna' });
  mock.sime_usuarios[0].perfil = 'auxiliar_eleicao';
  mock.sime_secoes.push({ id:'sec-77', numero:77, local_nome:'Escola Fora', municipio:'Jatobá do Piauí' });
  mock.sime_ocorrencias.push(
    { id:'oc-2', secao_id:'sec-77', tipo:'urna', status:'aberta', descricao:null, responsavel_id:null,
      aberta_em:new Date(Date.now()-5*60000).toISOString(), assumida_em:null, nivel_escalonamento:0, origem:'mesario' },
    { id:'oc-3', secao_id:SEC_63, tipo:'energia', status:'aberta', descricao:null, responsavel_id:null,
      aberta_em:new Date(Date.now()-5*60000).toISOString(), assumida_em:null, nivel_escalonamento:0, origem:'mesario' },
  );
  mock.sime_auxiliar_locais = [{ usuario_id:'u-maria', local_nome:'G.E. Treze de Março', municipio:'Campo Maior' }];
  const { p, erros } = await abrir(ctx, mock);
  check('auxiliar vê só 1 card (a urna do próprio local)', await p.locator('.prob').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 15. Qualquer outro perfil continua vendo a zona inteira, sem recorte —
// o escopo por locais é exclusivo de auxiliar_eleicao. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna' }); // Maria continua coordenadora
  mock.sime_secoes.push({ id:'sec-77', numero:77, local_nome:'Escola Fora', municipio:'Jatobá do Piauí' });
  mock.sime_ocorrencias.push(
    { id:'oc-2', secao_id:'sec-77', tipo:'urna', status:'aberta', descricao:null, responsavel_id:null,
      aberta_em:new Date(Date.now()-5*60000).toISOString(), assumida_em:null, nivel_escalonamento:0, origem:'mesario' },
  );
  const { p, erros } = await abrir(ctx, mock);
  check('coordenador continua vendo todos os problemas (2 cards)', await p.locator('.prob').count() === 2);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 16. Auxiliar DESIGNADO de verdade (sime_auxiliar_locais) vence o roster
// do TRE no cartão de contato — o roster quase nunca traz secao_id pra essa
// função, então a atribuição real precisa ganhar quando existir. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna', auxiliar:true }); // Pedro Técnico (TRE) segue cadastrado, mesmo local
  mock.sime_usuarios.push({ id:'u-fabiana', nome:'Fabiana Reis', perfil:'auxiliar_eleicao', zona_id:'z7', ativo:true, telefone_whatsapp:'5586977776666' });
  mock.sime_auxiliar_locais = [{ usuario_id:'u-fabiana', local_nome:'G.E. Treze de Março', municipio:'Campo Maior' }];
  const { p, erros } = await abrir(ctx, mock);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  const nomes = await p.locator('.ct-nome').allTextContents();
  check('contato mostra a auxiliar designada de verdade', nomes.some(n=>n.includes('Fabiana Reis')), nomes.join(' | '));
  check('não mostra mais o fallback do roster do TRE quando há designação real',
    !nomes.some(n=>n.includes('Pedro Técnico')), nomes.join(' | '));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 17. Ocorrência sem `numero` (dado de antes desta migração) nunca mostra
// um prefixo quebrado tipo "#undefined" — só omite o chamado, mesmo critério
// "nunca inventa" já usado no resto do sistema. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  delete mock.sime_ocorrencias[0].numero;
  const { p, erros } = await abrir(ctx, mock);
  const cardTxt = await p.locator('.prob-sec').first().textContent();
  check('sem numero: card não mostra "#" nenhum', !cardTxt.includes('#'), cardTxt);
  check('sem numero: card ainda mostra a seção normalmente', cardTxt.includes('Seção 63'), cardTxt);
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  const shTxt = await p.locator('.sh-t1').textContent();
  check('sem numero: detalhe também não mostra "#" nenhum', !shTxt.includes('#'), shTxt);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18. Prioridade declarada (item 1) — manda na ordem de exibição, na
// frente do relógio de escalonamento: um problema recém-aberto marcado
// "Alta" fica no topo, sem esperar os 10/30 min do escalonamento
// automático. ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  mock.sime_ocorrencias = [
    { id:'oc-1', numero:1, secao_id:SEC_63, tipo:'energia', status:'aberta', responsavel_id:null,
      aberta_em:new Date(Date.now()-5*60000).toISOString(), nivel_escalonamento:0, origem:'mesario', prioridade:'normal' },
    { id:'oc-2', numero:2, secao_id:SEC_99, tipo:'mesa_incompleta', status:'aberta', responsavel_id:null,
      aberta_em:new Date(Date.now()-1*60000).toISOString(), nivel_escalonamento:0, origem:'mesario', prioridade:'alta' },
  ];
  const { p, erros } = await abrir(ctx, mock);

  const primeiroTxt = await p.locator('.prob-sec').first().textContent();
  check('prioridade Alta vai pro topo mesmo sendo o mais recente (não é a idade que manda)',
    primeiroTxt.includes('#002'), primeiroTxt);
  const badges = await p.locator('.prob').first().locator('.pill.bad').allTextContents();
  check('card mostra o badge de alta prioridade', badges.some(t => t.includes('alta prioridade')), badges.join(' | '));

  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('botão "Alta" vem destacado no detalhe', await p.locator('.prio-btn.prio-alta.on').count() === 1);

  await p.locator('.prio-btn.prio-baixa').click();
  await p.waitForTimeout(250);
  const chamadas = (await p.evaluate(() => window.__mock.rpcCalls)).filter(c => c.nome === 'sime_ocorrencia_definir_prioridade');
  check('clicar em Baixa chama a RPC de prioridade', chamadas.length === 1, JSON.stringify(chamadas));
  check('com o id e a prioridade certos no payload',
    chamadas[0]?.params?.p_id === 'oc-2' && chamadas[0]?.params?.p_prioridade === 'baixa', JSON.stringify(chamadas[0]));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 18b. Sem prioridade no dado (ocorrência de antes desta migração) cai
// em "Normal" por padrão — nunca nenhum botão destacado, nunca badge
// poluindo o card (mesmo critério "nunca inventa" de sempre). ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' });
  delete mock.sime_ocorrencias[0].prioridade;
  const { p, erros } = await abrir(ctx, mock);
  check('sem prioridade no card: nenhum badge de prioridade',
    await p.locator('.prob .pill.bad, .prob .pill.low').count() === 0);

  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('sem prioridade no dado: "Normal" vem destacado por padrão',
    await p.locator('.prio-btn.prio-normal.on').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 19. "Aguardando terceiro" (item 2) — só existe pra quem já foi
// assumida (pressupõe dono cuidando, só esperando resposta de fora); flag
// própria, não um status novo, pra não mexer em nenhum lugar que já lê
// status IN ('aberta','assumida') como "em aberto". ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'urna' })); // sem dono ainda
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('sem dono: não oferece "Aguardando terceiro"',
    await p.locator('button:has-text("Aguardando terceiro")').count() === 0);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'urna', responsavel:'u-maria' }));
  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('com dono: oferece "Aguardando terceiro"',
    await p.locator('button:has-text("Aguardando terceiro")').count() === 1);

  await p.locator('button:has-text("Aguardando terceiro")').click();
  await p.waitForTimeout(250);
  const chamadas = (await p.evaluate(() => window.__mock.rpcCalls)).filter(c => c.nome === 'sime_ocorrencia_toggle_aguardando_terceiro');
  check('clique chama a RPC de toggle com o id certo',
    chamadas.length === 1 && chamadas[0]?.params?.p_id === 'oc-1', JSON.stringify(chamadas));
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 19b. Badge de "aguardando terceiro" aparece no card e no detalhe
// (mostra o estado já marcado, "Terceiro respondeu" pra desmarcar). ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'urna', responsavel:'u-maria' });
  mock.sime_ocorrencias[0].aguardando_terceiro = true;
  const { p, erros } = await abrir(ctx, mock);
  const cardTxt = await p.locator('.prob-rod').first().textContent();
  check('card mostra badge de aguardando terceiro', cardTxt.includes('aguardando terceiro'), cardTxt);

  await p.locator('.prob').first().click();
  await p.waitForTimeout(250);
  check('detalhe mostra "Terceiro respondeu" (já marcado)',
    await p.locator('button:has-text("Terceiro respondeu")').count() === 1);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 20. Busca em chamados resolvidos (item 5) — recarregar() só busca
// aberta/assumida de propósito; a busca dedicada é o único jeito de reabrir
// um chamado já resolvido pra consulta ("o que foi feito no chamado
// #012?"). ──
{
  const ctx = await b.newContext();
  const mock = baseMock({ tipo:'energia' }); // oc-1, #007, continua aberta
  mock.sime_ocorrencias.push(
    { id:'oc-resolvida', numero:12, secao_id:SEC_63, tipo:'urna', status:'resolvida', responsavel_id:'u-maria',
      aberta_em:new Date(Date.now()-3600000).toISOString(), assumida_em:new Date(Date.now()-3500000).toISOString(),
      resolvida_em:new Date(Date.now()-3000000).toISOString(), resolucao:'Trocada a urna',
      nivel_escalonamento:0, origem:'mesario', prioridade:'normal' },
  );
  const { p, erros } = await abrir(ctx, mock);

  check('resolvido não aparece na lista principal', await p.locator('.prob').count() === 1);
  check('painel de busca começa recolhido', await p.locator('#busca-painel').isHidden());

  await p.locator('#busca-toggle').click();
  await p.waitForTimeout(150);
  check('painel de busca abre ao clicar', await p.locator('#busca-painel').isVisible());

  await p.fill('#busca-input', '012');
  await p.locator('#busca-submit').click();
  await p.waitForTimeout(300);

  const resTxt = await p.locator('#busca-resultados').textContent();
  check('busca por número de chamado acha o resolvido', resTxt.includes('#012'), resTxt);

  await p.locator('#busca-resultados .prob').first().click();
  await p.waitForTimeout(250);
  const shTxt = await p.locator('.sh-t1').textContent();
  check('abre o detalhe do chamado resolvido', shTxt.includes('#012'), shTxt);
  check('detalhe do resolvido não oferece Assumir/Delegar/Resolvido (é histórico, não se edita)',
    await p.locator('.sh-foot button').count() === 0);
  const corpo = await p.locator('.sh-body').textContent();
  check('mostra a resolução registrada', corpo.includes('Trocada a urna'), corpo);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

// ── 20b. Busca sem resultado avisa com clareza, sem parecer travada ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrir(ctx, baseMock({ tipo:'energia' }));
  await p.locator('#busca-toggle').click();
  await p.waitForTimeout(150);
  await p.fill('#busca-input', '999');
  await p.locator('#busca-submit').click();
  await p.waitForTimeout(300);
  const resTxt = await p.locator('#busca-resultados').textContent();
  check('sem achado: avisa em vez de ficar em branco', resTxt.includes('Nenhum chamado resolvido'), resTxt);
  check('sem erro JS', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await b.close();

let pass = 0, fail = 0;
for (const x of results) { console.log((x.ok ? 'PASS' : 'FAIL') + ' — ' + x.n + (x.e ? '  [' + x.e + ']' : '')); x.ok ? pass++ : fail++; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
