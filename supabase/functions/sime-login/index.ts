// supabase/functions/sime-login/index.ts
// Edge Function compartilhada: troca um token de sime_tokens (TV ou, na Fase 4,
// campo) por uma sessão JWT válida para a RLS zona-scoped já existente.
//
// TV (tipo='tv'): { token } — sem pin, expira em ~90 dias.
// Campo (Fase 4, demais tipos): { token, pin } — expira em ~12h (1 turno).
//
// Por que não cria um usuário real em auth.users: o "sub" do JWT só precisa
// bater com sime_usuarios.auth_user_id para a RLS resolver a zona — auth.uid()
// apenas decodifica o claim, não valida contra a tabela auth.users. Isso evita
// depender da API admin do GoTrue só para emitir uma sessão de leitura.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { signSimeJwt, expiracaoParaTipo } from './jwt.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET')!;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const { token, pin } = await req.json().catch(() => ({}));
  if (!token) {
    return jsonResponse(400, { error: 'token é obrigatório' });
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('sime_tokens')
    .select('id, eleicao_id, usuario_id, token, pin, tipo, rotas, local_id, expira_em')
    .eq('token', token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return jsonResponse(401, { error: 'Token inválido' });
  }
  if (tokenRow.expira_em && new Date(tokenRow.expira_em).getTime() < Date.now()) {
    return jsonResponse(401, { error: 'Token expirado' });
  }
  if (tokenRow.tipo !== 'tv' && tokenRow.pin !== pin) {
    return jsonResponse(401, { error: 'PIN incorreto' });
  }

  const { data: eleicao, error: eleicaoErr } = await supabase
    .from('sime_eleicoes')
    .select('zona_id')
    .eq('id', tokenRow.eleicao_id)
    .maybeSingle();
  if (eleicaoErr || !eleicao?.zona_id) {
    return jsonResponse(500, { error: 'Não foi possível resolver a zona do token' });
  }
  const zonaId = eleicao.zona_id;

  // perfil derivado do tipo do token — sempre um perfil de baixo privilégio
  // (observador): tokens de TV/campo nunca devem carregar perfis administrativos,
  // a RLS das tabelas operacionais já filtra só por zona, não por perfil.
  const perfil = 'observador';

  let usuarioId = tokenRow.usuario_id as string | null;
  let authUserId: string | null = null;

  if (usuarioId) {
    const { data: usuario } = await supabase
      .from('sime_usuarios')
      .select('id, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle();
    authUserId = usuario?.auth_user_id ?? null;
    if (!authUserId) {
      authUserId = crypto.randomUUID();
      await supabase.from('sime_usuarios').update({ auth_user_id: authUserId }).eq('id', usuarioId);
    }
  } else {
    authUserId = crypto.randomUUID();
    const { data: novoUsuario, error: criarErr } = await supabase
      .from('sime_usuarios')
      .insert({
        nome: `Token ${tokenRow.tipo} (${token})`,
        perfil,
        zona_id: zonaId,
        auth_user_id: authUserId,
        ativo: true,
      })
      .select('id')
      .single();
    if (criarErr) {
      return jsonResponse(500, { error: 'Falha ao provisionar usuário do token', detalhe: criarErr.message });
    }
    usuarioId = novoUsuario.id;
    await supabase.from('sime_tokens').update({ usuario_id: usuarioId }).eq('id', tokenRow.id);
  }

  const { data: agoraTs } = await supabase.rpc('sime_now');
  const agoraSegundos = Math.floor(new Date(agoraTs).getTime() / 1000);
  const exp = expiracaoParaTipo(tokenRow.tipo, agoraSegundos);

  const jwt = await signSimeJwt(
    {
      sub: authUserId!,
      zona_id: zonaId,
      tipo: tokenRow.tipo,
      rotas: tokenRow.rotas,
      local_id: tokenRow.local_id,
      exp,
      iat: agoraSegundos,
    },
    JWT_SECRET,
  );

  await supabase.from('sime_tokens').update({ usado_em: agoraTs }).eq('id', tokenRow.id);

  return jsonResponse(200, { jwt, exp, zona_id: zonaId, tipo: tokenRow.tipo });
});
