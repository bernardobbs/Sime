-- ════════════════════════════════════════════════════════════
-- SIME — Número de chamado por ocorrência
-- ════════════════════════════════════════════════════════════
-- Pedido direto: "cada problema pode receber um número tipo um chamado?"
--
-- Sequencial POR ZONA (não global) — mesma lógica de "seção 0063": o número
-- precisa fazer sentido falado por telefone/rádio dentro da zona de quem
-- está operando, não competir por posição com o que está acontecendo na
-- outra zona ao mesmo tempo. `sime_zonas.ocorrencias_contador` guarda o
-- último número emitido; `sime_proximo_numero_ocorrencia()` incrementa via
-- UPDATE (o próprio lock de linha do Postgres evita duas ocorrências da
-- mesma zona saírem com o mesmo número em paralelo — sem precisar de
-- advisory lock nem SELECT FOR UPDATE à parte).
--
-- Idempotente: pode ser aplicado mais de uma vez.

ALTER TABLE sime_zonas
  ADD COLUMN IF NOT EXISTS ocorrencias_contador INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sime_ocorrencias
  ADD COLUMN IF NOT EXISTS numero INTEGER;

-- Emite o próximo número da zona, atômico por UPDATE (lock de linha).
CREATE OR REPLACE FUNCTION sime_proximo_numero_ocorrencia(p_zona_id UUID)
RETURNS INTEGER AS $$
DECLARE v_numero INTEGER;
BEGIN
  UPDATE sime_zonas SET ocorrencias_contador = ocorrencias_contador + 1
   WHERE id = p_zona_id
  RETURNING ocorrencias_contador INTO v_numero;
  RETURN v_numero;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill do que já existe: numera por zona, na ordem em que foi aberta —
-- é a mesma ordem que o histórico/escalonamento já usa (aberta_em), então o
-- nº 1 de cada zona é o problema mais antigo dela, não um sorteio.
DO $$
DECLARE r RECORD; v_num INTEGER;
BEGIN
  FOR r IN
    SELECT id, zona_id,
           ROW_NUMBER() OVER (PARTITION BY zona_id ORDER BY aberta_em, id) AS rn
      FROM sime_ocorrencias
     WHERE numero IS NULL
  LOOP
    UPDATE sime_ocorrencias SET numero = r.rn WHERE id = r.id;
  END LOOP;

  -- Alinha o contador de cada zona ao maior número já usado (nunca reduz um
  -- contador que porventura já estivesse à frente de uma rodada anterior
  -- deste script).
  UPDATE sime_zonas z SET ocorrencias_contador = GREATEST(z.ocorrencias_contador, sub.maximo)
    FROM (SELECT zona_id, MAX(numero) AS maximo FROM sime_ocorrencias GROUP BY zona_id) sub
   WHERE z.id = sub.zona_id;
END $$;

-- (zona_id, numero) só pode repetir entre ocorrências sem número (não deveria
-- existir mais nenhuma depois do backfill acima) — parcial pra não travar em
-- NULL, que o índice único do Postgres já trata como "nunca colide" mesmo
-- sem o WHERE, mas deixamos explícito pela mesma razão que os outros índices
-- parciais deste arquivo: clareza de intenção.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocor_zona_numero
  ON sime_ocorrencias(zona_id, numero) WHERE numero IS NOT NULL;

-- ------------------------------------------------------------
-- Emissão em toda ocorrência NOVA — os dois únicos pontos de INSERT:
-- ------------------------------------------------------------

-- 1) Gatilho automático a partir do campo (pânico de energia/urna/sos,
-- problema de instalação) — CREATE OR REPLACE inteiro porque o Postgres não
-- faz patch parcial de função (mesmo motivo já documentado nas correções
-- anteriores deste arquivo).
CREATE OR REPLACE FUNCTION sime_sync_ocorrencias() RETURNS TRIGGER AS $$
DECLARE
  v_zona UUID;
  v_now  TIMESTAMPTZ := NOW();
BEGIN
  SELECT zona_id INTO v_zona FROM sime_secoes WHERE id = NEW.secao_id;
  IF v_zona IS NULL THEN RETURN NEW; END IF;

  -- energia
  IF NEW.panico_energia AND NOT COALESCE(NEW.panico_energia_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em, numero)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'energia', COALESCE(NEW.updated_by_origem,'campo'), v_now,
            sime_proximo_numero_ocorrencia(v_zona))
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.panico_energia_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='energia' AND status IN ('aberta','assumida');
  END IF;

  -- urna
  IF NEW.panico_urna AND NOT COALESCE(NEW.panico_urna_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em, numero)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'urna', COALESCE(NEW.updated_by_origem,'campo'), v_now,
            sime_proximo_numero_ocorrencia(v_zona))
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.panico_urna_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='urna' AND status IN ('aberta','assumida');
  END IF;

  -- sos (genérico: conflito de fiscais, conflito entre eleitores, fila etc.)
  IF COALESCE(NEW.panico_sos,false) AND NOT COALESCE(NEW.panico_sos_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em, numero)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'sos', COALESCE(NEW.updated_by_origem,'campo'), v_now,
            sime_proximo_numero_ocorrencia(v_zona))
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.panico_sos_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='sos' AND status IN ('aberta','assumida');
  END IF;

  -- instalação (véspera)
  IF COALESCE(NEW.problema_instalacao,false) AND NOT COALESCE(NEW.problema_instalacao_resolvido,false) THEN
    INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, aberta_em, numero)
    VALUES (v_zona, NEW.eleicao_id, NEW.secao_id, 'instalacao', COALESCE(NEW.updated_by_origem,'campo'), v_now,
            sime_proximo_numero_ocorrencia(v_zona))
    ON CONFLICT (secao_id, tipo) WHERE status IN ('aberta','assumida') DO NOTHING;
  ELSIF COALESCE(NEW.problema_instalacao_resolvido,false) THEN
    UPDATE sime_ocorrencias SET status='resolvida', resolvida_em=v_now,
           resolucao=COALESCE(resolucao,'Resolvido no aparelho do campo')
     WHERE secao_id=NEW.secao_id AND tipo='instalacao' AND status IN ('aberta','assumida');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2) Abertura manual pelo cartório (soube por telefone).
CREATE OR REPLACE FUNCTION sime_ocorrencia_abrir(
  p_secao_id UUID, p_eleicao_id UUID, p_tipo TEXT, p_descricao TEXT DEFAULT NULL)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual(); v_zona UUID;
BEGIN
  SELECT zona_id INTO v_zona FROM sime_secoes WHERE id = p_secao_id;
  INSERT INTO sime_ocorrencias(zona_id, eleicao_id, secao_id, tipo, origem, descricao, numero)
  VALUES (v_zona, p_eleicao_id, p_secao_id, p_tipo, 'admin', p_descricao,
          sime_proximo_numero_ocorrencia(v_zona))
  RETURNING * INTO v_row;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (v_row.id, 'abriu', v_eu, p_descricao);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
