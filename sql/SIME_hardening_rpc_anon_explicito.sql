-- SIME — continuação de SIME_hardening_rpc_anon.sql, aplicada no mesmo
-- turno (23/10/2026) depois de descobrir que REVOKE ... FROM PUBLIC sozinho
-- não bastava.
--
-- Causa: o Supabase concede EXECUTE a anon/authenticated/service_role por um
-- GRANT DIRETO via `ALTER DEFAULT PRIVILEGES` (configurado pelo próprio
-- Supabase na criação do projeto, não por nada escrito neste repositório) —
-- não só herdado de PUBLIC. Revogar de PUBLIC removeu o grant implícito, mas
-- o grant EXPLÍCITO a `anon` continuava de pé. Verificado ao vivo: depois da
-- primeira migração, `set role anon; select sime_ocorrencia_assumir(...)`
-- ainda chegava até a UPDATE real (mesmo erro de negócio de antes, não um
-- erro de permissão) — só depois desta segunda rodada (REVOKE EXECUTE ...
-- FROM anon, explícito, função por função) é que virou
-- `permission denied for function` (42501), o resultado esperado.
DO $$
DECLARE r record;
BEGIN
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
      'sime_rota_estado_upsert','sime_rota_urna_toggle','sime_sync_atores_from_raw',
      'sime_chamar_hermes_notificar','sime_escalonar_ocorrencias',
      'sime_proximo_numero_ocorrencia','sime_sync_ocorrencias')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- Tentativa de fechar a causa raiz pra sempre (função NOVA já nasce sem
-- acesso de anon por padrão) — REJEITADA pelo Postgres: o papel `postgres`
-- exposto neste projeto não é superuser de verdade (Supabase reserva isso
-- pro `supabase_admin` interno). Deixado aqui como registro do que foi
-- tentado, não como algo que de fato rodou:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     REVOKE EXECUTE ON FUNCTIONS FROM anon;
--   -- ERROR: 42501: permission denied to change default privileges
--
-- Regra a seguir manualmente daqui em diante: toda função nova criada em
-- `public` precisa de um `REVOKE EXECUTE ON FUNCTION <assinatura> FROM
-- anon;` explícito logo depois do CREATE FUNCTION, a menos que seja
-- deliberadamente pública (como sime_buscar_local_votacao).
