// Testa o perfil "Auxiliar de Eleição" (escopo 'locais') em SIME_admin.html
// (10/09/2026, pedido direto: "os auxiliares deverão ficar responsaveis por
// alguns locais de votação predeterminados, então o problema com urnas
// devem cair na pagina deles e nos whatsapp, somente daquelas urnas
// predeterminadas" — três decisões confirmadas via AskUserQuestion: login
// próprio e-mail/senha; vários locais por auxiliar (N-pra-N, não um campo
// único como o "Local" do Coord. de Acessibilidade); alerta de WhatsApp
// imediato, além da escalada de sempre).
//
// O que este arquivo cobre do lado SIME_admin.html:
//   1. O formulário de membro mostra/esconde o seletor de locais certo
//      conforme o perfil escolhido (nunca junto com "Local" único).
//   2. Criar um auxiliar novo grava a atribuição em sime_auxiliar_locais
//      (delete+reinsert), com zona_id da zona de quem criou.
//   3. Editar um auxiliar já atribuído pré-seleciona os locais certos, e
//      trocar a seleção regrava só o que mudou.
//   4. O card da equipe mostra os locais atribuídos (ou avisa que não tem
//      nenhum ainda).
//   5. Numa sessão REAL logada como o próprio auxiliar (não o admin
//      demo/local), secoesDoUsuario()/escopoLabel() de fato escopam pelos
//      locais — bug real corrigido no caminho: a sessão autenticada de
//      verdade nunca carregava curUser.locais (só o seletor de usuário
//      demo/local, via localStorage, carregava esse tipo de escopo).
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

function stubSupabaseJs({ extraUsuarios = [], auxLocais = [], secoes, meuUsuario } = {}) {
  // ativo:true é obrigatório — getSecoes() (sime_dados.js) filtra .eq('ativo',true)
  // e withFallback() trata resposta vazia como "sem dado", caindo no
  // SECTIONS_FALLBACK hardcoded (175 seções reais da 7ª Zona) em vez do mock.
  const SECOES_PADRAO = [
    { id: 'sec-1', numero: 63, local_nome: 'Escola A', municipio: 'Campo Maior', zona_id: 'zona-7', ativo: true },
    { id: 'sec-2', numero: 64, local_nome: 'Escola B', municipio: 'Campo Maior', zona_id: 'zona-7', ativo: true },
    { id: 'sec-3', numero: 65, local_nome: 'Escola C', municipio: 'Jatobá do Piauí', zona_id: 'zona-7', ativo: true },
  ];
  const MEU_USUARIO_PADRAO = { id: 'admin-1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' };
  return `
export function createClient(url, key) {
  let session = null;
  const ZONAS = [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }];
  const USUARIOS = [
    { id: 'admin-1', nome: 'Rafael A.', email: 'x@sime.gov.br', perfil: 'coordenador', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
    ...${JSON.stringify(extraUsuarios)},
  ];
  const SECOES = ${JSON.stringify(secoes || SECOES_PADRAO)};
  let AUX_LOCAIS = ${JSON.stringify(auxLocais)};
  const MEU_USUARIO = ${JSON.stringify(meuUsuario || MEU_USUARIO_PADRAO)};
  window.__updates = []; window.__inserts = []; window.__deletes = [];
  function applyFilters(rows, filters) {
    return rows.filter(r => Object.entries(filters).every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
  }
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
      qb.delete = () => { qb._op = 'delete'; return qb; };
      qb.insert = (p) => {
        const linhas = Array.isArray(p) ? p : [p];
        if (t === 'sime_auxiliar_locais') AUX_LOCAIS.push(...linhas);
        window.__inserts.push({ tabela: t, payload: p });
        return Promise.resolve({ error: null });
      };
      qb.maybeSingle = () => {
        if (t === 'sime_usuarios' && 'auth_user_id' in qb._filters) {
          return Promise.resolve({ data: MEU_USUARIO, error: null });
        }
        if (t === 'sime_eleicoes') return Promise.resolve({ data: { id: 'elec-1', turno: 1, zona_id: 'zona-7' }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      qb.then = (resolve) => {
        if (t === 'sime_zonas') return resolve({ data: applyFilters(ZONAS, qb._filters), error: null });
        if (t === 'sime_usuarios') {
          if (qb._op === 'update') { window.__updates.push({ filters: { ...qb._filters }, payload: { ...qb._payload } }); return resolve({ error: null }); }
          return resolve({ data: applyFilters(USUARIOS, qb._filters), error: null });
        }
        if (t === 'sime_secoes') return resolve({ data: applyFilters(SECOES, qb._filters), error: null });
        if (t === 'sime_auxiliar_locais') {
          if (qb._op === 'delete') {
            window.__deletes.push({ tabela: t, filters: { ...qb._filters } });
            AUX_LOCAIS = AUX_LOCAIS.filter(l => !applyFilters([l], qb._filters).length);
            return resolve({ error: null });
          }
          return resolve({ data: applyFilters(AUX_LOCAIS, qb._filters), error: null });
        }
        return resolve({ data: [], error: null });
      };
      return qb;
    },
    rpc(name) { if (name === 'sime_now') return Promise.resolve({ data: '2026-09-10T12:00:00.000Z', error: null }); return Promise.resolve({ data: null, error: null }); },
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

async function abrirComoAdmin(ctx, opts = {}) {
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs(opts) }));
  if (opts.functionResponse) {
    await p.route('**/functions/v1/sime-admin-user', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.functionResponse) }));
  }
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  // SECTIONS (usado pelos selects de escopo, incluindo #m-locais) só existe
  // depois que carregarDadosReais() termina — sem esperar, o formulário abre
  // com a lista de locais vazia.
  await p.waitForFunction(() => window.SECTIONS && window.SECTIONS.length > 0, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(200);
  return { p, erros };
}

// ── 1. Formulário: o seletor de locais aparece só pro perfil certo, nunca
// junto do "Local" único do Coord. de Acessibilidade. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirComoAdmin(ctx);
  await p.evaluate(() => window.openNewMember());

  await p.selectOption('#m-perfil', 'auxiliar_eleicao');
  check('auxiliar_eleicao: mostra o seletor de locais', await p.locator('#grp-locais').isVisible());
  check('auxiliar_eleicao: NÃO mostra o "Local" único (esse é do Coord. de Acessibilidade)', !(await p.locator('#grp-local').isVisible()));

  await p.selectOption('#m-perfil', 'coord_acessibilidade');
  check('coord_acessibilidade: mostra o "Local" único', await p.locator('#grp-local').isVisible());
  check('coord_acessibilidade: NÃO mostra o seletor de locais (esse é do auxiliar)', !(await p.locator('#grp-locais').isVisible()));

  await p.selectOption('#m-perfil', 'coordenador');
  check('coordenador: nenhum dos dois aparece', !(await p.locator('#grp-locais').isVisible()) && !(await p.locator('#grp-local').isVisible()));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 2. Criar um auxiliar novo com 2 locais marcados grava em
// sime_auxiliar_locais (delete antes, depois insert) — usuario_id é o real,
// vindo da Edge Function, zona_id é a de quem criou. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirComoAdmin(ctx, {
    functionResponse: { ok: true, usuario_id: 'aux-novo-1', auth_user_id: 'auth-aux-novo-1', email: 'aux1@sime.gov.br', senha_temporaria: 'abc1234!' },
  });

  await p.evaluate(() => window.openNewMember());
  await p.fill('#m-nome', 'Pedro Auxiliar');
  await p.fill('#m-email', 'aux1@sime.gov.br');
  await p.selectOption('#m-perfil', 'auxiliar_eleicao');
  await p.selectOption('#m-locais', ['Escola A|||Campo Maior', 'Escola C|||Jatobá do Piauí']);
  await p.click('.modal-footer button:has-text("Salvar")');
  await p.waitForTimeout(300);

  const deletes = await p.evaluate(() => window.__deletes);
  const delAux = deletes.find(d => d.tabela === 'sime_auxiliar_locais');
  check('limpa a atribuição antiga antes de gravar a nova', delAux?.filters?.usuario_id === 'aux-novo-1', JSON.stringify(delAux));

  const inserts = await p.evaluate(() => window.__inserts);
  const insAux = inserts.filter(i => i.tabela === 'sime_auxiliar_locais').flatMap(i => i.payload);
  check('grava as 2 linhas com o usuario_id real (não o id local temporário)',
    insAux.length === 2 && insAux.every(l => l.usuario_id === 'aux-novo-1'), JSON.stringify(insAux));
  check('zona_id é a de quem criou (zona-7)', insAux.every(l => l.zona_id === 'zona-7'), JSON.stringify(insAux));
  check('locais batem com os 2 marcados',
    insAux.some(l => l.local_nome === 'Escola A' && l.municipio === 'Campo Maior') &&
    insAux.some(l => l.local_nome === 'Escola C' && l.municipio === 'Jatobá do Piauí'), JSON.stringify(insAux));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 3. Editar um auxiliar já atribuído pré-seleciona o local certo; trocar
// a seleção regrava só o novo conjunto (não acumula com o antigo). ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirComoAdmin(ctx, {
    extraUsuarios: [{ id: 'aux-existente', nome: 'Fabiana Reis', email: 'fabiana@sime.gov.br', perfil: 'auxiliar_eleicao', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null }],
    auxLocais: [{ usuario_id: 'aux-existente', zona_id: 'zona-7', local_nome: 'Escola A', municipio: 'Campo Maior' }],
  });
  await p.waitForTimeout(200);

  await p.evaluate(() => window.editMember('aux-existente'));
  await p.waitForTimeout(150);
  const selecionados = await p.locator('#m-locais').evaluate(el => [...el.selectedOptions].map(o => o.value));
  check('reabrir pré-seleciona o local já atribuído', selecionados.includes('Escola A|||Campo Maior'), JSON.stringify(selecionados));
  check('e só esse (não inventa outro)', selecionados.length === 1, JSON.stringify(selecionados));

  // Troca: sai Escola A, entra Escola B.
  await p.selectOption('#m-locais', ['Escola B|||Campo Maior']);
  await p.click('.modal-footer button:has-text("Salvar")');
  await p.waitForTimeout(300);

  const inserts = await p.evaluate(() => window.__inserts);
  const insAux = inserts.filter(i => i.tabela === 'sime_auxiliar_locais').flatMap(i => i.payload);
  check('regrava só o novo conjunto (Escola B, não os dois)',
    insAux.length === 1 && insAux[0].local_nome === 'Escola B', JSON.stringify(insAux));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 4. Card da equipe mostra os locais atribuídos, ou avisa que ainda não
// tem nenhum. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirComoAdmin(ctx, {
    extraUsuarios: [
      { id: 'aux-com-local', nome: 'Fabiana Reis', email: 'fabiana@sime.gov.br', perfil: 'auxiliar_eleicao', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
      { id: 'aux-sem-local', nome: 'Diego Souza', email: 'diego@sime.gov.br', perfil: 'auxiliar_eleicao', zona_id: 'zona-7', ativo: true, telefone_whatsapp: null },
    ],
    auxLocais: [{ usuario_id: 'aux-com-local', zona_id: 'zona-7', local_nome: 'Escola A', municipio: 'Campo Maior' }],
  });
  await p.waitForTimeout(200);

  const cardTxt = await p.locator('.team-card', { hasText: 'Fabiana Reis' }).textContent();
  check('card mostra o local atribuído', cardTxt.includes('Escola A'), cardTxt.replace(/\s+/g, ' '));

  const cardVazio = await p.locator('.team-card', { hasText: 'Diego Souza' }).textContent();
  check('sem nenhum local, avisa em vez de mostrar em branco', cardVazio.includes('nenhum local atribuído ainda'), cardVazio.replace(/\s+/g, ' '));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

// ── 5. Sessão REAL logada como o próprio auxiliar (não o seletor de
// usuário demo/local) — secoesDoUsuario()/escopoLabel() escopam de
// verdade. Bug real corrigido no caminho: a sessão autenticada nunca
// carregava curUser.locais, só o cache local (demo) carregava esse tipo
// de escopo — sem o fix, um auxiliar logado de verdade veria a zona
// inteira, não só os locais dele. ──
{
  const ctx = await b.newContext();
  const { p, erros } = await abrirComoAdmin(ctx, {
    meuUsuario: { id: 'aux-logado', nome: 'Pedro Auxiliar', perfil: 'auxiliar_eleicao', zona_id: 'zona-7' },
    auxLocais: [{ usuario_id: 'aux-logado', zona_id: 'zona-7', local_nome: 'Escola A', municipio: 'Campo Maior' }],
  });
  await p.waitForTimeout(300);

  const escopoTxt = await p.evaluate(() => window.escopoLabel ? window.escopoLabel() : (typeof escopoLabel !== 'undefined' ? escopoLabel() : null));
  check('escopoLabel() mostra os locais atribuídos, na sessão real', /Escola A/.test(escopoTxt || ''), escopoTxt);

  const secoesVisiveis = await p.evaluate(() => (window.secoesDoUsuario ? window.secoesDoUsuario() : secoesDoUsuario()).map(s => s.loc));
  check('secoesDoUsuario() traz só as seções do local atribuído', secoesVisiveis.every(l => l === 'Escola A') && secoesVisiveis.length > 0, JSON.stringify(secoesVisiveis));

  check('sem erro JS', erros.length === 0, erros.join('; '));
  await ctx.close();
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_auxiliar_locais.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
