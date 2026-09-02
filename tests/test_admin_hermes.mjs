// Testa a aba Hermes de SIME_admin.html: heartbeat/versão vêm direto de
// sime_heartbeat/sime_componentes (sem endpoint Vercel — o Hermes real grava
// essas tabelas com o service key dele, mesmo caminho de sime_atores/
// sime_campanhas_confirmacao — ver sql/SIME_hermes_gestao_schema.sql), e
// "Solicitar atualização" faz upsert com atualizar_agora=true.
import pw from 'playwright';
const { chromium } = pw;

const results = []; const check = (n, c, e = '') => results.push({ n, ok: !!c, e });
const b = await chromium.launch();

const AGORA = '2026-08-04T12:00:00.000Z';

function stubSupabaseJs({ zonas, heartbeats, componentes }) {
  return `
export function createClient(url, key) {
  let session = null;
  let ZONAS = ${JSON.stringify(zonas)};
  let HEARTBEATS = ${JSON.stringify(heartbeats)};
  let COMPONENTES = ${JSON.stringify(componentes)};
  window.__upserts = [];
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; }, in(){ return qb; },
        maybeSingle(){
          if (t === 'sime_usuarios') return Promise.resolve({ data: { id: 'u1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        upsert(payload, opts){
          window.__upserts.push({ t, payload, opts });
          if (t === 'sime_componentes') {
            const i = COMPONENTES.findIndex(c => c.zona_id === payload.zona_id && c.componente === payload.componente);
            if (i > -1) COMPONENTES[i] = Object.assign({}, COMPONENTES[i], payload);
            else COMPONENTES.push(payload);
          }
          return Promise.resolve({ error: null });
        },
        then(resolve){
          if (t === 'sime_zonas') return resolve({ data: ZONAS, error: null });
          if (t === 'sime_componentes') return resolve({ data: COMPONENTES, error: null });
          if (t === 'sime_heartbeat') return resolve({ data: HEARTBEATS, error: null });
          if (t === 'sime_secoes') return resolve({ data: [], error: null });
          if (t === 'sime_usuarios') return resolve({ data: [], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    rpc(name){ if (name === 'sime_now') return Promise.resolve({ data: '${AGORA}', error: null }); return Promise.resolve({ data: null, error: null }); },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
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

// ── Caso 1: heartbeat recente = online, telemetria aparece, pedido de atualização pendente some do "erro" ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      zonas: [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }],
      heartbeats: [{ zona_id: 'zona-7', componente: 'hermes', ultimo_heartbeat: '2026-08-04T11:58:00.000Z', versao: '1.2.0', commit_hash: 'abcdef1234', uptime_s: 7200, cpu_pct: 18, mem_mb: 436, temperatura_c: 61, whatsapp_status: 'conectado', telegram_status: 'conectado' }],
      componentes: [{ zona_id: 'zona-7', componente: 'hermes', versao_instalada: '1.2.0', atualizar_agora: false }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Hermes')");
  await p.waitForTimeout(300);
  check('caso1: zero erros JS', erros.length === 0, erros.join('; '));
  const txt = (await p.locator('#hermes-grid').textContent()).replace(/\s+/g, ' ');
  check('caso1: mostra online (heartbeat há 2 min)', txt.includes('🟢'), txt);
  check('caso1: mostra versão e uptime', txt.includes('1.2.0') && txt.includes('2h'), txt);
  check('caso1: mostra status WhatsApp/Telegram', /conectado/.test(txt), txt);
  check('caso1: sem atualização pendente, sem aviso de erro', !txt.includes('Atualização pendente') && !txt.includes('falhou'), txt);
}

// ── Caso 2: heartbeat velho (6h) = sem sinal; atualização pendente aparece ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      zonas: [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }],
      heartbeats: [{ zona_id: 'zona-7', componente: 'hermes', ultimo_heartbeat: '2026-08-04T06:00:00.000Z', versao: '1.1.0' }],
      componentes: [{ zona_id: 'zona-7', componente: 'hermes', versao_instalada: '1.1.0', atualizar_agora: true, versao_desejada: '1.2.0' }],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Hermes')");
  await p.waitForTimeout(300);
  const txt = (await p.locator('#hermes-grid').textContent()).replace(/\s+/g, ' ');
  check('caso2: mostra sem sinal (heartbeat de 6h atrás)', txt.includes('sem sinal'), txt);
  check('caso2: mostra atualização pendente com a versão desejada', txt.includes('Atualização pendente') && txt.includes('1.2.0'), txt);
}

// ── Caso 3: solicitar atualização grava upsert com atualizar_agora=true ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: stubSupabaseJs({
      zonas: [{ id: 'zona-7', numero: 7, municipio: 'Campo Maior' }],
      heartbeats: [{ zona_id: 'zona-7', componente: 'hermes', ultimo_heartbeat: '2026-08-04T11:58:00.000Z', versao: '1.2.0' }],
      componentes: [],
    }) });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Hermes')");
  await p.waitForTimeout(300);
  await p.click('#hermes-grid button:has-text("Solicitar atualização")');
  await p.waitForTimeout(150);
  await p.fill('#pedir-texto-inp', 'v1.3.0');
  await p.click('#pedir-texto-ok-btn');
  await p.waitForTimeout(200);
  const upserts = await p.evaluate(() => window.__upserts);
  const pedido = upserts.find(u => u.t === 'sime_componentes' && u.payload.atualizar_agora === true);
  check('caso3: zero erros JS', erros.length === 0, erros.join('; '));
  check('caso3: upsert em sime_componentes com atualizar_agora=true', !!pedido, JSON.stringify(upserts));
  check('caso3: versão desejada = v1.3.0', pedido && pedido.payload.versao_desejada === 'v1.3.0', JSON.stringify(pedido));
  check('caso3: onConflict = zona_id,componente', pedido && pedido.opts && pedido.opts.onConflict === 'zona_id,componente', JSON.stringify(pedido));
  check('caso3: solicitado_por vem do usuário logado', pedido && pedido.payload.solicitado_por === 'u1', JSON.stringify(pedido));
  const txtDepois = (await p.locator('#hermes-grid').textContent()).replace(/\s+/g, ' ');
  check('caso3: re-renderiza mostrando o pedido pendente', txtDepois.includes('Atualização pendente'), txtDepois);
}

// ── Caso 4: tabelas ainda não existem (erro do Supabase) — não quebra a página ──
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.route('**/vendor/supabase-js.esm.js**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: `
export function createClient(url, key) {
  let session = null;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session ? { id: 'auth-uid-1' } : null } }),
      signInWithPassword: async ({ email, password }) => { session = { user: { email } }; return { data: { session }, error: null }; },
    },
    from(t) {
      const qb = {
        select(){ return qb; }, eq(){ return qb; }, order(){ return qb; }, not(){ return qb; }, limit(){ return qb; }, in(){ return qb; },
        maybeSingle(){
          if (t === 'sime_usuarios') return Promise.resolve({ data: { id: 'u1', nome: 'Rafael A.', perfil: 'coordenador', zona_id: 'zona-7' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve){
          if (t === 'sime_componentes' || t === 'sime_heartbeat') return resolve({ data: null, error: { message: 'relation does not exist' } });
          return resolve({ data: [], error: null });
        },
      };
      return qb;
    },
    rpc(name){ return Promise.resolve({ data: '${AGORA}', error: null }); },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
  };
}
` });
  });
  await p.goto('http://localhost:8917/modules/SIME_admin.html');
  await p.waitForTimeout(300);
  await fazerLogin(p);
  await p.click("button.nav-tab:has-text('Hermes')");
  await p.waitForTimeout(300);
  check('caso4: zero erros JS mesmo com tabelas ausentes', erros.length === 0, erros.join('; '));
  const txt = await p.locator('#hermes-grid').textContent();
  check('caso4: mostra aviso amigável em vez de travar', txt.includes('Não foi possível carregar'), txt);
}

await b.close();

const falhas = results.filter(r => !r.ok);
console.log(`\n${results.length - falhas.length}/${results.length} passaram — test_admin_hermes.mjs`);
falhas.forEach(f => console.log(`  ✗ ${f.n}${f.e ? ' — ' + f.e : ''}`));
if (falhas.length) process.exit(1);
