-- SIME — Fecha o acesso anônimo a ~20 RPCs operacionais, achado numa auditoria
-- de segurança pedida direto em 23/10/2026 ("verifique se há a possibilidade
-- do sistema ser hackeado pelo link publico?"). Idempotente.
--
-- Causa raiz: o Postgres concede EXECUTE em toda função nova pro papel PUBLIC
-- por padrão, a menos que alguém revogue isso explicitamente — e isso nunca
-- tinha sido feito pra nenhuma das funções abaixo (só os helpers de RLS
-- (sime_user_zona/sime_is_super_admin/sime_zona_visivel/sime_usuario_atual/
-- sime_user_e_equipe_cartorio) e sime_now()/sime_normalizar_telefone_whatsapp
-- (puras, sem acesso a dado nenhum) já tinham sido avaliados e DELIBERADAMENTE
-- deixados públicos em SIME_hardening.sql, 10/07/2026 — "revogar EXECUTE
-- quebraria a avaliação das policies" — esses continuam intocados aqui).
--
-- Testado ao vivo ANTES desta correção (UUID falso, sem tocar dado real):
-- `set role anon; select sime_ocorrencia_assumir('00000000-...-000001');`
-- chegou até a UPDATE de sime_ocorrencias e só falhou pela checagem de
-- NEGÓCIO da própria função (nenhuma linha bateu) — não por permissão. Ou
-- seja: qualquer um, sem login nenhum, só com a chave pública anon (já
-- embutida em toda página do site, inclusive a nova busca pública), já
-- conseguia chamar sime_ocorrencia_assumir/resolver/delegar/abrir,
-- sime_acao_mesa, sime_arquivar_auxilio_alimentacao_e_ativar_turno etc. pelo
-- endpoint REST do Supabase. Como são SECURITY DEFINER (rodam como o dono da
-- tabela, que ignora RLS por sime_secoes/sime_ocorrencias terem
-- relforcerowsecurity=false), a própria função era o ÚNICO freio — e nenhuma
-- delas checa se quem chamou está autenticado.
--
-- Confirmado que nenhum fluxo legítimo depende de acesso anônimo aqui: todo
-- login de campo (QR+PIN, sime_campo_auth.js) troca token+PIN pela Edge
-- Function sime-login, que devolve um JWT de verdade (papel authenticated,
-- Bearer anexado em todo request) ANTES de qualquer uma dessas RPCs ser
-- chamada — nenhum módulo de campo nem admin jamais usou o papel anon pra
-- escrever. As 4 de "nunca chamadas por .rpc() nenhum" (sime_sync_ocorrencias,
-- sime_chamar_hermes_notificar, sime_escalonar_ocorrencias,
-- sime_proximo_numero_ocorrencia) são só internas — gatilho ou chamadas de
-- dentro de outra função SECURITY DEFINER (que já roda como o dono) — nunca
-- precisaram de EXECUTE nem pra authenticated.

DO $$
DECLARE r record;
BEGIN
  -- Grupo 1: usadas por client .rpc() autenticado — revoga de PUBLIC,
  -- mantém authenticated + service_role.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'sime_acao_acessibilidade','sime_acao_mesa','sime_acao_midia',
      'sime_arquivar_auxilio_alimentacao_e_ativar_turno','sime_importar_ator',
      'sime_midia_transmissao_upsert','sime_notificar_auxiliares_urna',
      'sime_notificar_manual','sime_ocorrencia_abrir','sime_ocorrencia_assumir',
      'sime_ocorrencia_contatou','sime_ocorrencia_definir_prioridade',
      'sime_ocorrencia_delegar','sime_ocorrencia_marcar_visualizada',
      'sime_ocorrencia_resolver','sime_ocorrencia_toggle_aguardando_terceiro',
      'sime_rota_estado_upsert','sime_rota_urna_toggle','sime_sync_atores_from_raw')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;

  -- Grupo 2: nunca chamadas via .rpc() client nenhum (gatilho ou só uso
  -- interno de outra SECURITY DEFINER) — revoga de PUBLIC, sem re-conceder
  -- pra authenticated; service_role mantém o grant explícito que já tinha.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'sime_chamar_hermes_notificar','sime_escalonar_ocorrencias',
      'sime_proximo_numero_ocorrencia','sime_sync_ocorrencias')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;
