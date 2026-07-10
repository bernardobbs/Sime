// supabase/functions/sime-admin-user/index.ts
// Edge Function administrativa: cria o ACESSO (login) de um membro da equipe.
//
// Diferente de sime-login (que só emite JWT de leitura para TV/campo a partir de
// um token), esta função cria uma conta REAL em auth.users — porque o membro da
// equipe faz login com e-mail + senha de verdade. Fluxo:
//   1. valida o admin que chamou (Authorization: Bearer <sessão do admin logado>)
//   2. confere que ele tem perfil com permissão de config de equipe
//   3. cria a conta Auth com senha temporária + flag must_change_password
//   4. insere/atualiza a linha em sime_usuarios (mesma zona do admin)
//   5. devolve a senha temporária para o Admin exibir uma única vez
//
// verify_jwt fica DESLIGADO no gateway porque a função faz sua própria validação
// do Bearer via admin.auth.getUser + checagem de perfil — mais explícita e com
// mensagens de erro próprias do que o 401 genérico do gateway.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// client service_role (ignora RLS) para criar conta + gravar sime_usuarios
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// perfis que este endpoint aceita criar (espelha PERFIS do SIME_admin.html)
const PERFIS_VALIDOS = new Set([
  'super_admin', 'coordenador', 'monitor', 'gestor_prob', 'gestor_dist',
  'observador', 'coord_motoristas', 'coord_acessibilidade', 'coletor_midias',
]);
// perfis que têm permissão de config_equipe (podem criar outros membros)
const PODE_CRIAR = new Set(['super_admin', 'coordenador']);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// senha temporária legível: 3 letras + 4 dígitos + símbolo (ex.: "kfr8241!")
function gerarSenhaTemporaria(): string {
  const letras = 'abcdefghijkmnpqrstuvwxyz';
  const digitos = '23456789';
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return `${pick(letras, 3)}${pick(digitos, 4)}!`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // ── 1. quem está chamando? ──
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) {
    return jsonResponse(401, { error: 'Sessão de admin obrigatória' });
  }
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse(401, { error: 'Sessão inválida' });
  }
  const chamadorAuthId = userData.user.id;

  // ── 2. o chamador tem permissão de config de equipe? ──
  const { data: chamador } = await admin
    .from('sime_usuarios')
    .select('id, perfil, zona_id, ativo')
    .eq('auth_user_id', chamadorAuthId)
    .maybeSingle();
  if (!chamador || !chamador.ativo || !PODE_CRIAR.has(chamador.perfil)) {
    return jsonResponse(403, { error: 'Sem permissão para criar acessos de equipe' });
  }

  // ── 3. valida o corpo ──
  const body = await req.json().catch(() => ({}));
  const acao = (body.acao || 'criar').trim();
  const email = (body.email || '').trim().toLowerCase();

  // ── AÇÃO: reset de senha ──
  // Gera uma nova senha temporária para um membro existente e reativa a troca
  // obrigatória no próximo login. Não depende de e-mail/SMTP — o admin repassa
  // a senha nova à pessoa. Autorização: mesma regra de config_equipe acima; um
  // admin de zona só reseta membros da própria zona.
  if (acao === 'reset') {
    if (!email) return jsonResponse(400, { error: 'email é obrigatório' });
    let q = admin.from('sime_usuarios').select('id, auth_user_id, zona_id, perfil').eq('email', email);
    if (chamador.perfil !== 'super_admin') q = q.eq('zona_id', chamador.zona_id);
    const { data: alvo } = await q.maybeSingle();
    if (!alvo || !alvo.auth_user_id) {
      return jsonResponse(404, { error: 'Membro não encontrado nesta zona' });
    }
    if (alvo.perfil === 'super_admin' && chamador.perfil !== 'super_admin') {
      return jsonResponse(403, { error: 'Apenas super_admin reseta outro super_admin' });
    }
    const novaSenha = gerarSenhaTemporaria();
    const { error: updErr } = await admin.auth.admin.updateUserById(alvo.auth_user_id, {
      password: novaSenha,
      user_metadata: { must_change_password: true },
    });
    if (updErr) {
      return jsonResponse(500, { error: 'Falha ao redefinir senha', detalhe: updErr.message });
    }
    return jsonResponse(200, { ok: true, acao: 'reset', email, senha_temporaria: novaSenha });
  }

  // ── AÇÃO: criar (padrão) ──
  const nome = (body.nome || '').trim();
  const perfil = (body.perfil || '').trim();
  if (!nome || !email || !perfil) {
    return jsonResponse(400, { error: 'nome, email e perfil são obrigatórios' });
  }
  if (!PERFIS_VALIDOS.has(perfil)) {
    return jsonResponse(400, { error: 'perfil inválido' });
  }
  // só super_admin pode criar outro super_admin
  if (perfil === 'super_admin' && chamador.perfil !== 'super_admin') {
    return jsonResponse(403, { error: 'Apenas super_admin cria outro super_admin' });
  }
  // super_admin pode escolher a zona; os demais só criam na própria zona
  const zonaId = (chamador.perfil === 'super_admin' && body.zona_id)
    ? body.zona_id
    : chamador.zona_id;
  if (!zonaId) {
    return jsonResponse(400, { error: 'zona_id não resolvido' });
  }

  // ── 4. cria a conta Auth com senha temporária ──
  const senhaTemporaria = gerarSenhaTemporaria();
  const { data: novaConta, error: criarErr } = await admin.auth.admin.createUser({
    email,
    password: senhaTemporaria,
    email_confirm: true, // sem SMTP: confirma na hora, login já funciona
    user_metadata: { must_change_password: true, nome },
  });
  if (criarErr || !novaConta?.user) {
    // e-mail duplicado é o erro mais comum — devolve mensagem clara
    const dup = /already|registered|exists/i.test(criarErr?.message || '');
    return jsonResponse(dup ? 409 : 500, {
      error: dup ? 'Já existe uma conta com esse e-mail' : 'Falha ao criar conta',
      detalhe: criarErr?.message,
    });
  }
  const novoAuthId = novaConta.user.id;

  // ── 5. grava a linha em sime_usuarios (idempotente por auth_user_id) ──
  const { data: usuarioRow, error: insErr } = await admin
    .from('sime_usuarios')
    .insert({
      nome, email, perfil, zona_id: zonaId,
      auth_user_id: novoAuthId, ativo: true,
    })
    .select('id')
    .single();
  if (insErr) {
    // desfaz a conta Auth para não deixar órfã se o insert falhar
    await admin.auth.admin.deleteUser(novoAuthId).catch(() => {});
    return jsonResponse(500, { error: 'Falha ao gravar usuário', detalhe: insErr.message });
  }

  return jsonResponse(200, {
    ok: true,
    usuario_id: usuarioRow.id,
    auth_user_id: novoAuthId,
    email,
    senha_temporaria: senhaTemporaria, // exibida UMA vez no Admin
    zona_id: zonaId,
  });
});
