-- ============================================================
-- SIME — Trigger Supabase para chamar o Hermes (sem Z-API)
-- Substitui completamente o trigger do Z-API anterior
-- ============================================================

-- Variaveis de ambiente no Supabase:
-- app.hermes_url     = http://SEU_ORACLE_IP:3000
-- app.hermes_secret  = MESMO_SECRET_DO_HERMES

CREATE OR REPLACE FUNCTION sime_chamar_hermes_notificar()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_evento  TEXT;
  v_secao   RECORD;
  v_ts      TEXT;
BEGIN
  -- Timestamp formatado HH:MM
  v_ts := TO_CHAR(NOW() AT TIME ZONE 'America/Fortaleza', 'HH24:MI');

  -- Busca dados da secao
  SELECT numero, local_nome, municipio
  INTO v_secao
  FROM sime_secoes WHERE id = NEW.secao_id;

  -- Determina o evento baseado na mudanca
  IF TG_TABLE_NAME = 'sime_mesa_estado' THEN
    IF NEW.panico_energia = true AND (OLD.panico_energia IS DISTINCT FROM true) THEN
      v_evento := 'panico_energia';
    ELSIF NEW.panico_urna = true AND (OLD.panico_urna IS DISTINCT FROM true) THEN
      v_evento := 'panico_urna';
    ELSIF NEW.panico_energia_resolvido = true AND (OLD.panico_energia_resolvido IS DISTINCT FROM true) THEN
      v_evento := 'panico_resolvido';
    ELSIF NEW.panico_urna_resolvido = true AND (OLD.panico_urna_resolvido IS DISTINCT FROM true) THEN
      v_evento := 'panico_resolvido';
    ELSE
      RETURN NEW; -- Ignorar outras mudancas (TV Dia ja usa Realtime)
    END IF;

  ELSIF TG_TABLE_NAME = 'sime_midias' THEN
    IF NEW.status = 'pronta_para_coleta' AND (OLD.status IS DISTINCT FROM 'pronta_para_coleta') THEN
      v_evento := 'midia_pronta';
    ELSIF NEW.responsavel_coleta IS DISTINCT FROM OLD.responsavel_coleta
          AND NEW.responsavel_coleta IS NOT NULL THEN
      v_evento := 'novo_responsavel';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Monta payload para o Hermes
  v_payload := jsonb_build_object(
    'evento',    v_evento,
    'secao',     LPAD(v_secao.numero::text, 4, '0'),
    'local',     v_secao.local_nome,
    'cidade',    v_secao.municipio,
    'ts',        v_ts,
    'secao_id',  NEW.secao_id
  );

  -- Adiciona responsavel se mudanca de coleta dedicada
  IF v_evento = 'novo_responsavel' THEN
    SELECT jsonb_set(v_payload, '{responsavel_id}',
      to_jsonb(NEW.responsavel_coleta::text))
    INTO v_payload;
  END IF;

  -- Chama o Hermes via HTTP (pg_net — extensao Supabase)
  PERFORM net.http_post(
    url     := current_setting('app.hermes_url')
               || '/hermes/skill/sime_notificar',
    body    := v_payload::text,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.hermes_secret')
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- NUNCA deixar o trigger travar a operacao principal
  RAISE WARNING 'Hermes indisponivel: % — operacao SIME continua normalmente', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger na tabela de estados (panico)
DROP TRIGGER IF EXISTS trg_mesa_hermes_notif ON sime_mesa_estado;
CREATE TRIGGER trg_mesa_hermes_notif
  AFTER UPDATE OF panico_energia, panico_urna,
                  panico_energia_resolvido, panico_urna_resolvido
  ON sime_mesa_estado
  FOR EACH ROW
  EXECUTE FUNCTION sime_chamar_hermes_notificar();

-- Trigger na tabela de midias (pronta + novo responsavel)
DROP TRIGGER IF EXISTS trg_midias_hermes_notif ON sime_midias;
CREATE TRIGGER trg_midias_hermes_notif
  AFTER INSERT OR UPDATE OF status, responsavel_coleta
  ON sime_midias
  FOR EACH ROW
  EXECUTE FUNCTION sime_chamar_hermes_notificar();

-- Configurar variaveis (executar uma vez):
-- ALTER DATABASE postgres SET app.hermes_url    = 'http://SEU_ORACLE_IP:3000';
-- ALTER DATABASE postgres SET app.hermes_secret = 'SEU_SECRET_AQUI';

-- Cron: relatorio final as 18h (via pg_cron)
-- SELECT cron.schedule(
--   'sime-relatorio-final',
--   '0 18 * * *',
--   $$
--     SELECT net.http_post(
--       url     := current_setting('app.hermes_url') || '/hermes/skill/sime_notificar',
--       body    := '{"evento":"relatorio_final"}',
--       headers := jsonb_build_object(
--         'Content-Type','application/json',
--         'Authorization','Bearer ' || current_setting('app.hermes_secret'))
--     );
--   $$
-- );
