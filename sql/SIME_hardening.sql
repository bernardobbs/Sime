-- SIME — Hardening de segurança (aplicar POR ÚLTIMO, depois de SIME_schema.sql
-- e SIME_whatsapp_schema.sql). Fecha os apontamentos do database linter do
-- Supabase que são corrigíveis por SQL. Idempotente.
--
-- Aplicado em produção em 2026-07-10 (projeto unjhnlcmxbrlonppchux).

-- 1) search_path fixo nas funções (evita hijack via search_path mutável).
--    DO block resolve a assinatura sozinho — não precisa saber os argumentos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'sime_now','sime_notificar_manual','update_midia_updated_at','sime_acao_midia',
      'sime_chamar_hermes_notificar','sime_acao_acessibilidade','sime_acao_mesa',
      'sime_rota_estado_upsert','sime_rota_urna_toggle','sime_importar_ator')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;

-- 2) Views de relatório respeitam a RLS de QUEM consulta (security_invoker),
--    não a do criador — senão vazariam dados entre zonas.
ALTER VIEW IF EXISTS public.vw_notificacoes_recentes SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_midias_resumo        SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_midias_pendentes     SET (security_invoker = true);
ALTER VIEW IF EXISTS public.vw_atores_por_secao     SET (security_invoker = true);

-- Apontamentos WARN deixados de propósito (não são falha, são desenho):
--   • sime_logs INSERT WITH CHECK (true): log é append-only, qualquer operador
--     autenticado registra evento; a leitura é que é restrita por zona.
--   • sime_user_zona()/sime_is_super_admin()/sime_zona_visivel() executáveis por
--     anon/authenticated: são as funções auxiliares da própria RLS (retornam nulo
--     sem auth.uid()); revogar EXECUTE quebraria a avaliação das policies.
--   • pg_trgm no schema public: mover exige recriar índices de busca fuzzy; risco
--     maior que o ganho.
-- Fora do SQL (dashboard): habilitar "Leaked Password Protection" em Auth.
