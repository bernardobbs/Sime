-- =====================================================================
-- Fix: sime_campanhas_confirmacao_status_check
-- =====================================================================
-- A constraint original (criada manualmente no Supabase, fora deste
-- repositório) só permitia o fluxo simples: 'pendente', 'enviado', 'erro'.
--
-- O código evoluiu para o fluxo de confirmação de identidade
-- (ver api/hermes-campanhas.js):
--
--   pendente ──envia verificação──▶ aguardando_resposta
--   aguardando_resposta ──resposta SIM──▶ confirmado
--   aguardando_resposta ──resposta NÃO──▶ telefone_incorreto (terminal)
--   aguardando_resposta ──sem resposta, RETRY_HORAS──▶ reenvia
--     (até MAX_TENTATIVAS; depois vira sem_resposta, terminal)
--   confirmado ──envia convocação + imagem──▶ finalizado
--
-- mas a constraint no banco nunca foi atualizada para aceitar os novos
-- status, causando falha silenciosa (a fila nunca avançava, item ficava
-- preso em 'pendente' indefinidamente).
--
-- Aplicado diretamente via Supabase MCP em 2026-08-17. Este arquivo
-- documenta/versiona a mudança no repositório.
--
-- 'fora_do_script' adicionado em 2026-08-18 (também via Supabase MCP,
-- direto em produção): resposta que não casa com nenhuma palavra-chave da
-- etapa atual de um script de campanha (ver api/hermes-campanhas.js,
-- ação 'registrar_fora_do_script', e sql/SIME_campanhas_scripts_schema.sql).
-- Antes disso a resposta só ia pro log (sime_logs) e o item continuava
-- 'aguardando_resposta' — o que fazia o Hermes reenviar a mesma etapa pra
-- alguém que já tinha respondido algo (só que fora do script esperado),
-- sem nenhum jeito de listar esses casos pra revisão humana. Terminal (não
-- reaparece em 'pendentes'), aparece em 'relatorio' como fila de atenção.
-- =====================================================================

ALTER TABLE sime_campanhas_confirmacao
  DROP CONSTRAINT IF EXISTS sime_campanhas_confirmacao_status_check;

ALTER TABLE sime_campanhas_confirmacao
  ADD CONSTRAINT sime_campanhas_confirmacao_status_check
  CHECK (status IN (
    'pendente',
    'enviado',
    'erro',
    'aguardando_resposta',
    'confirmado',
    'telefone_incorreto',
    'sem_resposta',
    'finalizado',
    'fora_do_script'
  ));
