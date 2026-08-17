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
    'finalizado'
  ));
