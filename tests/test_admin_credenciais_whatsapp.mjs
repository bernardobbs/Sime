// Testa o envio das credenciais de acesso por WhatsApp ao criar um membro em
// SIME_admin.html (28/08/2026, pedido direto: "quando criar um usuário, e
// constar o telefone podemos enviar os dados pelo whatsapp"). Quando o campo
// "WhatsApp de contato" tem valor, saveMember() enfileira em
// sime_campanhas_confirmacao (fluxo SIMPLES, campanha_id nulo — mesma fila
// que o Hermes já drena via api/hermes-campanhas.js, sem precisar de nenhum
// código novo do lado dele). Cobre também o bug real corrigido no caminho:
// o modal "✓ Acesso criado" (mostrarSenhaTemporaria) abria e fechava sozinho
// no mesmo instante — um closeModal() incondicional logo depois fechava de
// volta antes de qualquer clique, então a senha temporária nunca ficava
// visível pra ninguém.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ extraUsuarios = [] } = {}) {
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }];
  const USUARIOS = [
    { id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
    ...${JSON.stringify(extraUsuarios)},
  ];
  window.__updates = [];
  window.__inserts = [];
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email }, access_token: 'tok-123' }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = { _op: null, _filters: {}, _payload: null };
      qb.select = () => qb;
      qb.eq = (c, v) => { qb._filters[c] = v; return qb; };
      qb.order = () => qb; qb.not = () => qb; qb.limit = () => qb; qb.in = () => qb;
      qb.update = (p) => { qb._op = 'update'; qb._payload = p; return qb; };
      qb.insert = (p) => { window.__inserts.push({ tabela: t, payload: p }); return Promise.resolve({ error: null }); };
      qb.maybeSingle = () => {
        if (t === 'sime_usuarios' && 'auth_user_id' in qb._filters) {
          return Promise.resolve({ data: { id: 'admin-1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
        }
        if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'elec-1', turno: 1, zona_id: 'zona-7' }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      qb.then = (resolve) => {
        if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
        if (t === 'sime_usuarios') {
          if (qb._op === 'update') { window.__updates.push({ filters: { ...qb._filters }, payload: { ...qb._payload } }); return resolve({ error: null }); }
          return resolve({ data: USUARIOS, error: null });
        }
        // 1 seção real (não vazio) — getSecoes() trata array vazio como
        // "resposta vazia" e cai no fallback null, o que pula
        // iniciarMesaEstadoReal() por inteiro (só roda "if (secoesReais)")
        // e window.ELEICAO_ID nunca é resolvido. Achado testando o log de
        // auditoria do envio de credenciais, que depende desse campo.
        if (t === 'sime_secoes') return resolve({ data: [{ id: 'sec-1', numero: 63, local_nome: 'Escola', municipio: 'Campo Maior', zona_id: 'zona-7' }], error: null });
        return resolve({ data: [], error: null });
      };
      return qb;
    },
    rpc(name) { if (name === 'sime_now') return Promise.resolve({ data: '2026-08-28T12:00:00.000Z', error: null }); return Promise.resolve({ data: null, error: null }); },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
  };
}
`;
}

async function fazerLogin(p) {
  await p.fill('#login-email', 'x@sime.gov.br');
  await p.fill('#login-pass', 'senha');
  await p.click('#login-form button[type=submit]');
  await p.waitForTimeout(400);
}

// ── Caso 1: criar SEM telefone — credenciais só na tela, nada enfileirado ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs() });
  });
  await p.route('**/functions/v1/sime-admin-user', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, usuario_id: 'novo-1', auth_user_id: 'auth-novo-1', email: 'nova@sime.gov.br', senha_temporaria: 'abc1234!' }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);

  await p.evaluate(() => window.openNewMember());
  await p.fill('#m-nome', 'Nova Pessoa');
  await p.fill('#m-email', 'nova@sime.gov.br');
  await p.selectOption('#m-perfil', 'observador');
  await p.click('.modal-footer button:has-text("Salvar")');
  await p.waitForTimeout(300);

  check('modal de credenciais fica aberto (bug do closeModal duplo corrigido)', await p.evaluate(() => document.getElementById('overlay').classList.contains('open')));
  const bodyTxt = await p.locator('#modal-body').textContent();
  // Senha/e-mail são <input readonly value="...">, não texto — textContent()
  // não pega value de input (mesma pegadinha já documentada nesta sessão
  // pros cartões de telefone de Contatar mesários).
  check('mostra a senha temporária', (await p.locator('#credenciais-senha').inputValue()) === 'abc1234!');
  check('SEM telefone: não mostra nota de envio por WhatsApp', !/também já foram enfileiradas/.test(bodyTxt));

  const inserts = await p.evaluate(() => window.__inserts);
  check('SEM telefone: nada enfileirado em sime_campanhas_confirmacao', !inserts.some(i => i.tabela === 'sime_campanhas_confirmacao'), JSON.stringify(inserts));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 2: criar COM telefone — enfileira em sime_campanhas_confirmacao,
// mostra a nota na tela, registra log ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs() });
  });
  await p.route('**/functions/v1/sime-admin-user', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, usuario_id: 'novo-2', auth_user_id: 'auth-novo-2', email: 'gestor2@sime.gov.br', senha_temporaria: 'xyz9876!' }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);

  await p.evaluate(() => window.openNewMember());
  await p.fill('#m-nome', 'Novo Gestor');
  await p.fill('#m-email', 'gestor2@sime.gov.br');
  await p.selectOption('#m-perfil', 'gestor_prob');
  await p.fill('#m-tel', '(86) 99999-7777');
  await p.click('.modal-footer button:has-text("Salvar")');
  await p.waitForTimeout(300);

  const bodyTxt = await p.locator('#modal-body').textContent();
  check('COM telefone: mostra a nota de envio por WhatsApp', /também já foram enfileiradas/.test(bodyTxt), bodyTxt.replace(/\s+/g, ' ').slice(0, 300));

  const inserts = await p.evaluate(() => window.__inserts);
  const campanha = inserts.find(i => i.tabela === 'sime_campanhas_confirmacao');
  check('enfileira em sime_campanhas_confirmacao', !!campanha, JSON.stringify(inserts));
  check('telefone gravado com "55" na frente', campanha?.payload?.telefone_whatsapp === '5586999997777', JSON.stringify(campanha));
  check('zona_id da linha bate com a zona de quem criou', campanha?.payload?.zona_id === 'zona-7', JSON.stringify(campanha));
  check('status pendente, sem campanha_id (fluxo SIMPLES — sem gate de campanha nenhuma)', campanha?.payload?.status === 'pendente' && !campanha?.payload?.campanha_id, JSON.stringify(campanha));
  check('mensagem inclui nome, e-mail e a senha temporária', /Novo Gestor/.test(campanha?.payload?.mensagem_enviada || '') && /gestor2@sime\.gov\.br/.test(campanha?.payload?.mensagem_enviada || '') && /xyz9876!/.test(campanha?.payload?.mensagem_enviada || ''), campanha?.payload?.mensagem_enviada);

  const logInsert = inserts.find(i => i.tabela === 'sime_logs');
  check('grava log de auditoria do envio', logInsert?.payload?.acao === 'membro_credenciais_whatsapp_enfileiradas', JSON.stringify(logInsert));
  check('log grava eleicao_id (senão fica invisível pra sempre — RLS de sime_logs)', !!logInsert?.payload?.eleicao_id, JSON.stringify(logInsert));

  const updates = await p.evaluate(() => window.__updates);
  const telUpd = updates.find(u => u.filters.id === 'novo-2' && 'telefone_whatsapp' in u.payload);
  check('telefone_whatsapp sincroniza em sime_usuarios também', telUpd?.payload?.telefone_whatsapp === '5586999997777', JSON.stringify(telUpd));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 3: gerar NOVA senha (redefinir) pra membro que já tem telefone
// salvo — também enfileira por WhatsApp (28/08/2026, pedido direto: "e
// quando gerar nova senha enviar por whatsapp tb a senha temporaria"),
// reaproveitando o telefone já cadastrado (não pede de novo). ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      extraUsuarios: [{ id: 'u-gestor3', nome: 'Carla Gestora', email: 'carla@sime.gov.br', perfil: 'gestor_prob', zona_id: 'zona-7', ativo: true, telefone_whatsapp: '5586955554444' }],
    }) });
  });
  await p.route('**/functions/v1/sime-admin-user', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, acao: 'reset', email: body.email, senha_temporaria: 'novaSenha1!' }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.waitForTimeout(200);

  await p.evaluate(() => window.resetarSenhaMembro('u-gestor3'));
  await p.waitForTimeout(150);
  await p.click('#confirmacao-ok-btn');
  await p.waitForTimeout(300);

  check('modal de credenciais mostra a senha nova', (await p.locator('#credenciais-senha').inputValue()) === 'novaSenha1!');
  const bodyTxt3 = await p.locator('#modal-body').textContent();
  check('mostra a nota de envio por WhatsApp (telefone já cadastrado, reaproveitado)', /também já foram enfileiradas/.test(bodyTxt3), bodyTxt3.replace(/\s+/g, ' ').slice(0, 300));

  const inserts3 = await p.evaluate(() => window.__inserts);
  const campanha3 = inserts3.find(i => i.tabela === 'sime_campanhas_confirmacao');
  check('enfileira em sime_campanhas_confirmacao com o telefone já salvo', campanha3?.payload?.telefone_whatsapp === '5586955554444', JSON.stringify(campanha3));
  check('mensagem de reset menciona a senha nova (não a de criação)', /Carla Gestora/.test(campanha3?.payload?.mensagem_enviada || '') && /redefinida/.test(campanha3?.payload?.mensagem_enviada || '') && /novaSenha1!/.test(campanha3?.payload?.mensagem_enviada || ''), campanha3?.payload?.mensagem_enviada);

  const logInsert3 = inserts3.find(i => i.tabela === 'sime_logs');
  check('grava log de auditoria do reset', logInsert3?.payload?.acao === 'membro_senha_resetada_whatsapp_enfileirada', JSON.stringify(logInsert3));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_credenciais_whatsapp.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
