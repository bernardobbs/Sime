-- Posição estimada de cada veículo no mapa (TV Dia, 08/09/2026)
--
-- Pedido direto: "conseguiríamos ter uma visão estimada do local no mapa em
-- que esta cada veiculo?" — esclarecido via AskUserQuestion: a posição
-- atualiza "a cada informe" do motorista (entrega de urna em D-1, recolhimento
-- em Dia D, chegada ao cartório) — não é rastreamento contínuo em segundo
-- plano, é geolocalização do navegador capturada no exato momento em que o
-- motorista já ia confirmar uma ação, de qualquer forma. Escopo: D-1
-- (distribuição) e Dia D (recolhimento), na TV Dia.
--
-- Reaproveita sime_rotas_estado — já é "1 linha = estado atual da rota",
-- já é lido pela TV Distribuição e agora TV Dia via Realtime
-- (subscribeRotasEstado, sime_realtime.js), já tem RPC de upsert
-- (sime_rota_estado_upsert). Criar uma tabela nova só pra posição duplicaria
-- essa infraestrutura sem necessidade — a pergunta "onde está a rota X agora"
-- já é exatamente o tipo de coisa que esta tabela responde pros outros campos
-- (status de embarque).
ALTER TABLE sime_rotas_estado ADD COLUMN IF NOT EXISTS motorista_lat NUMERIC;
ALTER TABLE sime_rotas_estado ADD COLUMN IF NOT EXISTS motorista_lng NUMERIC;
ALTER TABLE sime_rotas_estado ADD COLUMN IF NOT EXISTS motorista_pos_ts TIMESTAMPTZ;

-- sime_rota_estado_upsert ganha p_lat/p_lng no FINAL da assinatura (nunca no
-- meio) — CREATE OR REPLACE só é seguro pra chamadores existentes
-- (Conferente, sime_rotas_modulo.js) se os parâmetros antigos não mudarem de
-- posição; os dois novos, com DEFAULT NULL, não afetam nenhuma chamada já em
-- produção que não os informa.
CREATE OR REPLACE FUNCTION sime_rota_estado_upsert(
  p_eleicao_id UUID,
  p_rota_id    UUID,
  p_status     TEXT DEFAULT NULL,
  p_conferente_nome TEXT DEFAULT NULL,
  p_ts_aberta  BOOLEAN DEFAULT NULL,
  p_ts_pronta  BOOLEAN DEFAULT NULL,
  p_ts_saiu    BOOLEAN DEFAULT NULL,
  p_alerta     BOOLEAN DEFAULT NULL,
  p_lat        NUMERIC DEFAULT NULL,
  p_lng        NUMERIC DEFAULT NULL
) RETURNS sime_rotas_estado AS $$
DECLARE
  v_row sime_rotas_estado;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_rotas_estado (eleicao_id, rota_id, status, conferente_nome,
    ts_aberta, ts_pronta, ts_saiu, alerta, motorista_lat, motorista_lng,
    motorista_pos_ts, updated_at)
  VALUES (p_eleicao_id, p_rota_id, COALESCE(p_status, 'aguardando'), p_conferente_nome,
    CASE WHEN p_ts_aberta THEN v_now END, CASE WHEN p_ts_pronta THEN v_now END,
    CASE WHEN p_ts_saiu THEN v_now END, COALESCE(p_alerta, false),
    p_lat, p_lng, CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN v_now END,
    v_now)
  ON CONFLICT (eleicao_id, rota_id) DO UPDATE SET
    status          = COALESCE(p_status, sime_rotas_estado.status),
    conferente_nome = COALESCE(p_conferente_nome, sime_rotas_estado.conferente_nome),
    ts_aberta = CASE WHEN p_ts_aberta AND sime_rotas_estado.ts_aberta IS NULL THEN v_now ELSE sime_rotas_estado.ts_aberta END,
    ts_pronta = CASE WHEN p_ts_pronta AND sime_rotas_estado.ts_pronta IS NULL THEN v_now ELSE sime_rotas_estado.ts_pronta END,
    ts_saiu   = CASE WHEN p_ts_saiu   AND sime_rotas_estado.ts_saiu   IS NULL THEN v_now ELSE sime_rotas_estado.ts_saiu   END,
    alerta    = COALESCE(p_alerta, sime_rotas_estado.alerta),
    motorista_lat     = COALESCE(p_lat, sime_rotas_estado.motorista_lat),
    motorista_lng     = COALESCE(p_lng, sime_rotas_estado.motorista_lng),
    motorista_pos_ts  = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN v_now ELSE sime_rotas_estado.motorista_pos_ts END,
    updated_at = v_now
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;
