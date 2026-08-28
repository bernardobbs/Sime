// Testa o campo "WhatsApp de contato" em SIME_admin.html (renomeado em
// 28/08/2026 — antes só existia pra Gestor de Problemas/Chefe de Cartório,
// rótulo "WhatsApp (escalonamento de pânico)"). Dupla finalidade agora:
// (1) escalonamento de pânico (hermes-contatos.js) — só relevante pra
// gestor_prob/coordenador, os dois perfis que o endpoint resolve; (2) enviar
// as credenciais de acesso por WhatsApp assim que a conta é criada (pedido
// direto: "quando criar um usuário, e constar o telefone podemos enviar os
// dados pelo whatsapp") — vale pra QUALQUER perfil, só ao criar. Por isso o
// campo aparece sempre que isNew (independente do perfil), e ao editar só
// continua visível pra gestor_prob/coordenador (não faz sentido reenviar
// credenciais numa edição).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ usuarios }) {
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }];
  let USUARIOS = ${JSON.stringify(usuarios)};
  window.__updates = [];
  window.__usuarios = () => USUARIOS;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = { _op: null, _filters: {}, _payload: null };
      qb.select = () => qb;
      qb.eq = (c, v) => { qb._filters[c] = v; return qb; };
      qb.order = () => qb; qb.not = () => qb; qb.limit = () => qb; qb.in = () => qb;
      qb.update = (p) => { qb._op = 'update'; qb._payload = p; return qb; };
      qb.maybeSingle = () => {
        if (t === 'sime_usuarios') {
          if ('auth_user_id' in qb._filters) return Promise.resolve({ data: { id: 'admin-1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      const matches = (row) => Object.entries(qb._filters).every(([k, v]) => row[k] === v);
      qb.then = (resolve) => {
        if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
        if (t === 'sime_usuarios') {
          if (qb._op === 'update') {
            window.__updates.push({ filters: { ...qb._filters }, payload: { ...qb._payload } });
            USUARIOS = USUARIOS.map((u) => matches(u) ? { ...u, ...qb._payload } : u);
            return resolve({ error: null });
          }
          return resolve({ data: USUARIOS, error: null });
        }
        if (t === 'sime_secoes') return resolve({ data: [], error: null });
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

// ── Caso 1: ao CRIAR, campo aparece pra QUALQUER perfil ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      usuarios: [{ id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.evaluate(() => window.openNewMember());

  await p.selectOption('#m-perfil', 'observador');
  check('criar: observador também mostra o campo (uso geral agora, não só escalonamento)', await p.evaluate(() => document.getElementById('grp-tel-escalonamento').style.display !== 'none'));

  await p.selectOption('#m-perfil', 'gestor_prob');
  check('criar: gestor_prob mostra o campo', await p.evaluate(() => document.getElementById('grp-tel-escalonamento').style.display !== 'none'));

  await p.selectOption('#m-perfil', 'coordenador');
  check('criar: coordenador mostra o campo', await p.evaluate(() => document.getElementById('grp-tel-escalonamento').style.display !== 'none'));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 1b: ao EDITAR, campo só continua visível pra gestor_prob/coordenador
// — reenviar credenciais não faz sentido numa edição, e outro perfil não
// recebe aviso de pânico mesmo. ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      usuarios: [
        { id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
        { id: 'u-obs', nome: 'Otávio Observador', email: 'otavio@sime.gov.br', perfil: 'observador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
        { id: 'u-gestor', nome: 'Ana Gestora', email: 'ana@sime.gov.br', perfil: 'gestor_prob', zona_id: 'zona-7', ativo: true, telefone_whatsapp: '558611110099' },
      ],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.waitForTimeout(200);

  await p.evaluate(() => window.editMember('u-obs'));
  check('editar observador: campo escondido', await p.evaluate(() => document.getElementById('grp-tel-escalonamento').style.display === 'none'));
  await p.evaluate(() => window.closeModal());
  await p.waitForTimeout(80);

  await p.evaluate(() => window.editMember('u-gestor'));
  check('editar gestor_prob: campo visível', await p.evaluate(() => document.getElementById('grp-tel-escalonamento').style.display !== 'none'));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 2: editar membro real pré-preenche o telefone já salvo no banco,
// formatado (não mais o valor cru com "55") — mesmo padrão de fmtTelefone()
// já usado em Contatar mesários. Salvar volta a gravar com "55" na frente. ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      usuarios: [
        { id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
        { id: 'u-gestor', nome: 'Ana Gestora', email: 'ana@sime.gov.br', perfil: 'gestor_prob', zona_id: 'zona-7', ativo: true, telefone_whatsapp: '558611110099' },
      ],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.waitForTimeout(200);

  await p.evaluate(() => window.editMember('u-gestor'));
  const telVal = await p.locator('#m-tel').inputValue();
  check('editar: campo pré-preenchido e FORMATADO (sem o "55")', telVal === '(86) 1111-0099', 'got=' + telVal);

  // Troca o telefone (digitado no formato local, como a pessoa realmente
  // digitaria) e salva — precisa sincronizar de volta pro sime_usuarios já
  // com "55" na frente.
  await p.fill('#m-tel', '(86) 99999-8888');
  await p.evaluate(() => window.saveMember('u-gestor'));
  await p.waitForTimeout(200);

  const updates = await p.evaluate(() => window.__updates);
  const upd = updates.find(u => u.filters.id === 'u-gestor');
  check('salvar: telefone_whatsapp sincronizou com "55" na frente', upd?.payload?.telefone_whatsapp === '5586999998888', JSON.stringify(upd));

  const usuarios = await p.evaluate(() => window.__usuarios());
  const gestor = usuarios.find(u => u.id === 'u-gestor');
  check('banco (mock) refletiu o novo telefone', gestor?.telefone_whatsapp === '5586999998888', JSON.stringify(gestor));

  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── Caso 3: mudar o perfil pra fora do escalonamento NÃO apaga mais o
// telefone (28/08/2026) — antes a captura só existia pra gestor_prob/
// coordenador, então trocar de perfil limpava o valor sem querer; agora o
// campo é de uso geral (contato/credenciais), então o número persiste — só
// deixa de ser lido pra escalonamento (hermes-contatos.js já filtra por
// perfil, então um observador com telefone salvo nunca recebe aviso de
// pânico mesmo assim). ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      usuarios: [
        { id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
        { id: 'u-gestor', nome: 'Ana Gestora', email: 'ana@sime.gov.br', perfil: 'gestor_prob', zona_id: 'zona-7', ativo: true, telefone_whatsapp: '558611110099' },
      ],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.waitForTimeout(200);

  await p.evaluate(() => window.editMember('u-gestor'));
  await p.selectOption('#m-perfil', 'observador');
  await p.evaluate(() => window.saveMember('u-gestor'));
  await p.waitForTimeout(200);

  const usuarios = await p.evaluate(() => window.__usuarios());
  const gestor = usuarios.find(u => u.id === 'u-gestor');
  check('mudar perfil pra fora do escalonamento MANTÉM o telefone', gestor?.telefone_whatsapp === '558611110099', JSON.stringify(gestor));
  check('zero erros JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_escalonamento_tel.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
