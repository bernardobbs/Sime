-- ============================================================
-- SIME — SQL: Fila de notificações WhatsApp (histórico/manual)
-- Executar no Supabase após SIME_schema.sql e SIME_hermes_trigger.sql
--
-- DECISÃO DE ARQUITETURA: o disparo automático de notificação de
-- pânico/mídia pronta é feito por SIME_hermes_trigger.sql (chama o
-- Hermes diretamente via pg_net). Este arquivo NÃO duplica esse
-- disparo — versões anteriores tinham triggers próprios
-- (trg_mesa_panico_notif, trg_midias_notif_whatsapp) que chamavam uma
-- Edge Function separada para os MESMOS eventos, gerando notificação
-- duplicada. Foram removidos; SIME_hermes_trigger.sql é o único
-- caminho automático. Este arquivo cobre apenas:
--   - sime_notificacoes: histórico/fila para auditoria e fallback
--   - sime_notificar_manual(): disparo manual pelo painel do admin
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABELA DE FILA DE NOTIFICAÇÕES (histórico + disparo manual)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sime_notificacoes (
  id              BIGSERIAL PRIMARY KEY,
  evento          TEXT NOT NULL,
  secao_id        UUID REFERENCES sime_secoes(id),
  destinatarios   JSONB NOT NULL,   -- [{nome, telefone, funcao}]
  mensagem        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente'
                  CHECK(status IN ('pendente','enviado','erro','ignorado')),
  tentativas      INTEGER NOT NULL DEFAULT 0,
  enviado_ts      TIMESTAMPTZ,
  erro_msg        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_status  ON sime_notificacoes(status);
CREATE INDEX IF NOT EXISTS idx_notif_secao   ON sime_notificacoes(secao_id);
CREATE INDEX IF NOT EXISTS idx_notif_created ON sime_notificacoes(created_at DESC);

-- RLS: usuário autenticado só vê notificações de seções da sua zona.
-- (sime_user_zona() é criada em SIME_schema.sql, executado antes deste arquivo.)
ALTER TABLE sime_notificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_zona_policy ON sime_notificacoes;
CREATE POLICY notif_zona_policy ON sime_notificacoes
  FOR ALL USING     (secao_id IN (SELECT id FROM sime_secoes WHERE zona_id = sime_user_zona()))
          WITH CHECK (secao_id IN (SELECT id FROM sime_secoes WHERE zona_id = sime_user_zona()));

-- ------------------------------------------------------------
-- 2. RPC: NOTIFICAR MANUALMENTE (chamada do frontend)
-- ------------------------------------------------------------
-- Para casos onde o admin quer notificar manualmente via painel

CREATE OR REPLACE FUNCTION sime_notificar_manual(
  p_secao_id    UUID,
  p_evento      TEXT,
  p_destinarios JSONB  -- [{nome, telefone}]
) RETURNS void AS $$
BEGIN
  INSERT INTO sime_notificacoes(evento, secao_id, destinatarios, mensagem, status)
  VALUES (
    p_evento,
    p_secao_id,
    p_destinarios,
    p_evento || ' (manual)',
    'pendente'
  );
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3. VIEW: HISTÓRICO DE NOTIFICAÇÕES
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vw_notificacoes_recentes AS
SELECT
  n.id,
  n.evento,
  s.numero     AS secao_numero,
  s.local_nome AS secao_local,
  n.status,
  n.tentativas,
  n.enviado_ts,
  n.created_at
FROM sime_notificacoes n
LEFT JOIN sime_secoes s ON s.id = n.secao_id
ORDER BY n.created_at DESC
LIMIT 200;
