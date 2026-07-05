-- ============================================================
-- SIME — SQL: Triggers e Webhooks para notificações WhatsApp
-- Executar no Supabase após SIME_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABELA DE FILA DE NOTIFICAÇÕES (fallback offline)
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
CREATE INDEX idx_notif_status  ON sime_notificacoes(status);
CREATE INDEX idx_notif_secao   ON sime_notificacoes(secao_id);
CREATE INDEX idx_notif_created ON sime_notificacoes(created_at DESC);

-- RLS: usuário autenticado só vê notificações de seções da sua zona.
-- (sime_user_zona() é criada em SIME_schema.sql, executado antes deste arquivo.)
ALTER TABLE sime_notificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_zona_policy ON sime_notificacoes;
CREATE POLICY notif_zona_policy ON sime_notificacoes
  FOR ALL USING     (secao_id IN (SELECT id FROM sime_secoes WHERE zona_id = sime_user_zona()))
          WITH CHECK (secao_id IN (SELECT id FROM sime_secoes WHERE zona_id = sime_user_zona()));

-- ------------------------------------------------------------
-- 2. FUNÇÃO QUE CHAMA O WEBHOOK (Edge Function)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_notificar_whatsapp()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
BEGIN
  -- Em UPDATE, só notifica se um dos campos monitorados mudou de valor.
  -- (A checagem fica aqui — TG_OP não é válido na cláusula WHEN de CREATE TRIGGER.)
  IF TG_OP = 'UPDATE' AND NOT (
       NEW.status             IS DISTINCT FROM OLD.status OR
       NEW.rota_id            IS DISTINCT FROM OLD.rota_id OR
       NEW.responsavel_coleta IS DISTINCT FROM OLD.responsavel_coleta
     ) THEN
    RETURN NEW;
  END IF;

  -- Monta payload para a Edge Function
  v_payload := jsonb_build_object(
    'type',       TG_OP,
    'table',      TG_TABLE_NAME,
    'record',     row_to_json(NEW)::jsonb,
    'old_record', row_to_json(OLD)::jsonb
  );

  -- Chama a Edge Function via pg_net (extensão do Supabase)
  -- Em produção, substituir a URL pelo endpoint real do Vercel/Supabase
  PERFORM net.http_post(
    url     := current_setting('app.edge_function_url') || '/notificar-whatsapp',
    body    := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  current_setting('app.webhook_secret')
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca deixa o trigger quebrar a operação principal
  RAISE WARNING 'Falha ao notificar WhatsApp: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. TRIGGERS NA TABELA sime_midias
-- ------------------------------------------------------------

-- Dispara quando status muda para pronta_para_coleta, coletada,
-- entregue_transmissao OU quando rota_id/responsavel_coleta muda
CREATE OR REPLACE TRIGGER trg_midias_notif_whatsapp
  AFTER INSERT OR UPDATE OF
    status, rota_id, responsavel_coleta
  ON sime_midias
  FOR EACH ROW
  EXECUTE FUNCTION sime_notificar_whatsapp();

-- ------------------------------------------------------------
-- 4. TRIGGER PARA PÂNICO (sime_mesa_estado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_notificar_panico()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
BEGIN
  -- Só dispara quando pânico é ATIVADO (false → true)
  IF (NEW.panico_energia = true AND (OLD.panico_energia IS DISTINCT FROM true)) OR
     (NEW.panico_urna    = true AND (OLD.panico_urna    IS DISTINCT FROM true))
  THEN
    v_payload := jsonb_build_object(
      'type',         TG_OP,
      'table',        'sime_mesa_estado',
      'record',       row_to_json(NEW)::jsonb,
      'old_record',   row_to_json(OLD)::jsonb,
      'panico_tipo',  CASE
                        WHEN NEW.panico_energia = true AND (OLD.panico_energia IS DISTINCT FROM true)
                        THEN 'energia'
                        ELSE 'urna'
                      END
    );

    PERFORM net.http_post(
      url     := current_setting('app.edge_function_url') || '/notificar-whatsapp',
      body    := v_payload::text,
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'x-webhook-secret',  current_setting('app.webhook_secret')
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao notificar pânico: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_mesa_panico_notif
  AFTER UPDATE OF panico_energia, panico_urna
  ON sime_mesa_estado
  FOR EACH ROW
  EXECUTE FUNCTION sime_notificar_panico();

-- ------------------------------------------------------------
-- 5. CONFIGURAÇÃO (executar uma vez no Supabase)
-- ------------------------------------------------------------
-- Substitua pelos valores reais antes de executar:

-- ALTER DATABASE postgres SET app.edge_function_url  = 'https://SEU_PROJETO.supabase.co/functions/v1';
-- ALTER DATABASE postgres SET app.webhook_secret     = 'SEU_SECRET_AQUI';

-- Habilitar extensão pg_net (Supabase já inclui por padrão):
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 6. RPC: NOTIFICAR MANUALMENTE (chamada do frontend)
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
-- 7. VIEW: HISTÓRICO DE NOTIFICAÇÕES
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
