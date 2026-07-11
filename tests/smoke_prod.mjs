// tests/smoke_prod.mjs
// Smoke test contra o Supabase de PRODUÇÃO. Exercita as 5 peças que já
// quebraram silenciosamente antes (schema não aplicado, verify_jwt bloqueando
// login) — cada uma numa camada diferente:
//
//   1. Login de admin (Supabase Auth)          → e-mail/senha resolve sessão
//   2. Login de campo (Edge Function sime-login) → token+PIN devolve JWT (pega o
//      verify_jwt e o secret SIME_JWT_SECRET)
//   3. Leitura RLS                              → sessão de admin enxerga as seções
//   4. RPC                                      → sime_now() responde (plumbing das
//      funções; não muta dados)
//   5. Realtime                                 → o websocket conecta e autoriza
//      (status 'SUBSCRIBED')
//
// NÃO roda no sandbox do agente (a rede bloqueia *.supabase.co) — roda na
// máquina do usuário ou no CI. Ideal como um job agendado 1x/dia.
//
// Uso:
//   export SMOKE_SUPABASE_URL="https://xxxx.supabase.co"
//   export SMOKE_ANON_KEY="eyJ..."            # anon key (pública)
//   export SMOKE_ADMIN_EMAIL="admin@..."      # conta em Authentication+sime_usuarios
//   export SMOKE_ADMIN_PASSWORD="..."
//   export SMOKE_CAMPO_TOKEN="ABCD1234"       # um token de campo real (sime_tokens)
//   export SMOKE_CAMPO_PIN="4321"
//   node tests/smoke_prod.mjs
//
// Dependência: @supabase/supabase-js (mesma do tests/package.json).

const {
  SMOKE_SUPABASE_URL: URL,
  SMOKE_ANON_KEY: ANON,
  SMOKE_ADMIN_EMAIL: ADMIN_EMAIL,
  SMOKE_ADMIN_PASSWORD: ADMIN_PASS,
  SMOKE_CAMPO_TOKEN: CAMPO_TOKEN,
  SMOKE_CAMPO_PIN: CAMPO_PIN,
} = process.env;

const obrigatorias = { SMOKE_SUPABASE_URL: URL, SMOKE_ANON_KEY: ANON, SMOKE_ADMIN_EMAIL: ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD: ADMIN_PASS };
const faltando = Object.entries(obrigatorias).filter(([, v]) => !v).map(([k]) => k);
// Produção ainda não configurada (nenhum secret definido): PULA em vez de falhar,
// para o cron diário não ficar vermelho por algo que ainda não foi ligado. Só é
// uma falha de verdade quando alguns secrets existem e outros não (config pela
// metade) — aí sinaliza o erro.
if (faltando.length === Object.keys(obrigatorias).length) {
  console.log('SKIP  smoke-prod — secrets de produção não configurados (SMOKE_*). Nada a testar ainda.');
  process.exit(0);
}
if (faltando.length) {
  console.error('Configuração pela metade — faltam variáveis:', faltando.join(', '));
  console.error('Defina TODAS ou NENHUMA. Ver o cabeçalho deste arquivo.');
  process.exit(2);
}

// Import só depois de confirmar que há o que testar — o caminho de SKIP acima
// nem precisa da dependência instalada.
const { createClient } = await import('@supabase/supabase-js');

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  [' + extra + ']' : ''}`); };

// ── 1. Login de admin ──────────────────────────────────────────
const admin = createClient(URL, ANON);
let adminSessionOk = false;
try {
  const { data, error } = await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  adminSessionOk = !error && !!data?.session;
  check('1. login de admin resolve sessão', adminSessionOk, error?.message || '');
} catch (e) {
  check('1. login de admin resolve sessão', false, String(e));
}

// ── 3. Leitura RLS (depende da sessão do admin) ────────────────
if (adminSessionOk) {
  try {
    const { count, error } = await admin.from('sime_secoes').select('id', { count: 'exact', head: true });
    check('3. leitura RLS: admin enxerga seções', !error && (count ?? 0) > 0, error?.message || ('count=' + count));
  } catch (e) {
    check('3. leitura RLS: admin enxerga seções', false, String(e));
  }

  // ── 4. RPC ───────────────────────────────────────────────────
  try {
    const { data, error } = await admin.rpc('sime_now');
    check('4. RPC sime_now() responde', !error && !!data, error?.message || '');
  } catch (e) {
    check('4. RPC sime_now() responde', false, String(e));
  }

  // ── 5. Realtime (websocket conecta e autoriza) ───────────────
  await new Promise((resolve) => {
    let resolvido = false;
    const done = (ok, extra) => { if (!resolvido) { resolvido = true; check('5. Realtime conecta (SUBSCRIBED)', ok, extra); ch.unsubscribe(); resolve(); } };
    const ch = admin.channel('smoke_' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sime_mesa_estado' }, () => {})
      .subscribe((status) => { if (status === 'SUBSCRIBED') done(true); else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') done(false, status); });
    setTimeout(() => done(false, 'timeout 10s'), 10000);
  });
} else {
  check('3. leitura RLS: admin enxerga seções', false, 'pulado: sem sessão de admin');
  check('4. RPC sime_now() responde', false, 'pulado: sem sessão de admin');
  check('5. Realtime conecta (SUBSCRIBED)', false, 'pulado: sem sessão de admin');
}

// ── 2. Login de campo via Edge Function (independe do admin) ───
if (CAMPO_TOKEN && CAMPO_PIN) {
  try {
    const resp = await fetch(`${URL}/functions/v1/sime-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: CAMPO_TOKEN, pin: CAMPO_PIN }),
    });
    const body = await resp.json().catch(() => ({}));
    check('2. login de campo (sime-login) devolve JWT', resp.status === 200 && !!body.jwt, resp.status + ' ' + (body.error || ''));
  } catch (e) {
    check('2. login de campo (sime-login) devolve JWT', false, String(e));
  }
} else {
  console.log('SKIP  2. login de campo — defina SMOKE_CAMPO_TOKEN/SMOKE_CAMPO_PIN para testar');
}

await admin.auth.signOut().catch(() => {});

const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail} OK, ${fail} com falha`);
process.exit(fail ? 1 : 0);
