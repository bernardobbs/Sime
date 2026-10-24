-- ════════════════════════════════════════════════════════════
-- SIME — Chip "sendo atendido" no aparelho do mesário
-- ════════════════════════════════════════════════════════════
-- Pergunta direta: "como o mesário que irá indicar no site da seção o
-- problema vai saber que o chamado já esta sendo resolvido e verificar
-- atualizações?"
--
-- Hoje o aparelho do mesário (SIME_mesario.html) só recebe um sinal
-- binário — o chip vermelho "🔴 Pânico ativo" some (com um toast) quando o
-- cartório clica "✓ Resolvido" em Problemas. Não existe nenhum estado
-- intermediário de "alguém já assumiu isso", e a tela do mesário nunca lê
-- sime_ocorrencias/sime_ocorrencia_eventos (nem deveria passar a ler —
-- decisão registrada na conversa: a tela é deliberadamente mínima, toque
-- único, sem rolagem, uso às 5h30 com sono).
--
-- Corrigido reaproveitando o mesmo padrão que sime_ocorrencia_resolver()
-- já usa pra espelhar a resolução em sime_mesa_estado: sime_ocorrencia_
-- assumir() e sime_ocorrencia_delegar() agora também espelham "alguém
-- assumiu, e quem é" — o aparelho do mesário já assina Realtime na própria
-- seção (subscribeMesaEstadoSecao) pra saber quando o pânico é resolvido,
-- então o chip "sendo atendido" chega de graça pelo MESMO canal, sem
-- assinatura nova nem consulta a mais.
--
-- Escopo: só os 3 tipos que o próprio aparelho do mesário aciona
-- (energia/urna/sos — as chaves de S.panico em SIME_mesario.html).
-- `problema_instalacao` fica de fora — é acionado por outra tela (D-1),
-- não pelo mesário.
--
-- Idempotente: pode ser aplicado mais de uma vez.

-- ------------------------------------------------------------
-- 1. Colunas novas em sime_mesa_estado
-- ------------------------------------------------------------
ALTER TABLE sime_mesa_estado
  ADD COLUMN IF NOT EXISTS panico_energia_assumido BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS panico_urna_assumido    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS panico_sos_assumido     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS panico_energia_responsavel_nome TEXT,
  ADD COLUMN IF NOT EXISTS panico_urna_responsavel_nome    TEXT,
  ADD COLUMN IF NOT EXISTS panico_sos_responsavel_nome     TEXT;

-- ------------------------------------------------------------
-- 2. sime_acao_mesa() — ganha 6 parâmetros novos, todos opcionais, no
-- FINAL da assinatura (mesmo critério de sime_rota_estado_upsert: só é
-- seguro pros chamadores existentes, que sempre usam parâmetro nomeado,
-- se os novos entrarem depois dos que já existem).
--
-- Convenção pros dois campos de nome (responsavel): NULL = não mexe (o
-- padrão, coerente com todo o resto da função); string vazia '' = limpa
-- pra NULL (usado ao resolver); qualquer outro texto = grava. Só as duas
-- RPCs de sime_ocorrencias.sql chamam isso com nome de responsável — o
-- mesário nunca passa esses parâmetros.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_acao_mesa(
  p_secao_id    UUID,
  p_eleicao_id  UUID,
  p_mesa_pres   INTEGER DEFAULT NULL,
  p_mesa_m1     INTEGER DEFAULT NULL,
  p_mesa_m2     INTEGER DEFAULT NULL,
  p_mesa_sec    INTEGER DEFAULT NULL,
  p_zeresima    BOOLEAN DEFAULT NULL,
  p_votacao     BOOLEAN DEFAULT NULL,
  p_encerrada   BOOLEAN DEFAULT NULL,
  p_bu_impresso BOOLEAN DEFAULT NULL,
  p_material_recolhido BOOLEAN DEFAULT NULL,
  p_fila        INTEGER DEFAULT NULL,
  p_panico_energia  BOOLEAN DEFAULT NULL,
  p_panico_urna     BOOLEAN DEFAULT NULL,
  p_panico_energia_resolvido BOOLEAN DEFAULT NULL,
  p_panico_urna_resolvido    BOOLEAN DEFAULT NULL,
  p_panico_sos      BOOLEAN DEFAULT NULL,
  p_panico_sos_resolvido     BOOLEAN DEFAULT NULL,
  p_urna_entregue    BOOLEAN DEFAULT NULL,
  p_urna_recolhida   BOOLEAN DEFAULT NULL,
  p_urna_cartorio    BOOLEAN DEFAULT NULL,
  p_urna_chegou      BOOLEAN DEFAULT NULL,
  p_urna_posicionada BOOLEAN DEFAULT NULL,
  p_urna_instalada   BOOLEAN DEFAULT NULL,
  p_problema_instalacao           BOOLEAN DEFAULT NULL,
  p_problema_instalacao_resolvido BOOLEAN DEFAULT NULL,
  p_observacao  TEXT DEFAULT NULL,
  p_origem      TEXT DEFAULT NULL,
  p_panico_energia_assumido BOOLEAN DEFAULT NULL,
  p_panico_urna_assumido    BOOLEAN DEFAULT NULL,
  p_panico_sos_assumido     BOOLEAN DEFAULT NULL,
  p_panico_energia_responsavel TEXT DEFAULT NULL,
  p_panico_urna_responsavel    TEXT DEFAULT NULL,
  p_panico_sos_responsavel     TEXT DEFAULT NULL
) RETURNS sime_mesa_estado AS $$
DECLARE
  v_row sime_mesa_estado;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO sime_mesa_estado (
    eleicao_id, secao_id, mesa_pres, mesa_m1, mesa_m2, mesa_sec,
    zeresima, votacao, encerrada, bu_impresso, material_recolhido, fila,
    panico_energia, panico_urna, panico_energia_resolvido, panico_urna_resolvido,
    panico_sos, panico_sos_resolvido,
    urna_entregue, urna_entregue_ts, urna_recolhida, urna_recolhida_ts,
    urna_cartorio, urna_cartorio_ts, urna_chegou, urna_chegou_ts,
    urna_posicionada, urna_posicionada_ts, urna_instalada, urna_instalada_ts,
    problema_instalacao, problema_instalacao_resolvido, observacao,
    panico_energia_assumido, panico_urna_assumido, panico_sos_assumido,
    panico_energia_responsavel_nome, panico_urna_responsavel_nome, panico_sos_responsavel_nome,
    updated_at, updated_by_origem
  ) VALUES (
    p_eleicao_id, p_secao_id,
    COALESCE(p_mesa_pres,0), COALESCE(p_mesa_m1,0), COALESCE(p_mesa_m2,0), COALESCE(p_mesa_sec,0),
    COALESCE(p_zeresima,false), COALESCE(p_votacao,false), COALESCE(p_encerrada,false), COALESCE(p_bu_impresso,false),
    COALESCE(p_material_recolhido,false), COALESCE(p_fila,0),
    COALESCE(p_panico_energia,false), COALESCE(p_panico_urna,false),
    COALESCE(p_panico_energia_resolvido,false), COALESCE(p_panico_urna_resolvido,false),
    COALESCE(p_panico_sos,false), COALESCE(p_panico_sos_resolvido,false),
    COALESCE(p_urna_entregue,false),    CASE WHEN p_urna_entregue    THEN v_now END,
    COALESCE(p_urna_recolhida,false),   CASE WHEN p_urna_recolhida   THEN v_now END,
    COALESCE(p_urna_cartorio,false),    CASE WHEN p_urna_cartorio    THEN v_now END,
    COALESCE(p_urna_chegou,false),      CASE WHEN p_urna_chegou      THEN v_now END,
    COALESCE(p_urna_posicionada,false), CASE WHEN p_urna_posicionada THEN v_now END,
    COALESCE(p_urna_instalada,false),   CASE WHEN p_urna_instalada   THEN v_now END,
    COALESCE(p_problema_instalacao,false), COALESCE(p_problema_instalacao_resolvido,false), p_observacao,
    COALESCE(p_panico_energia_assumido,false), COALESCE(p_panico_urna_assumido,false), COALESCE(p_panico_sos_assumido,false),
    NULLIF(p_panico_energia_responsavel,''), NULLIF(p_panico_urna_responsavel,''), NULLIF(p_panico_sos_responsavel,''),
    v_now, p_origem
  )
  ON CONFLICT (eleicao_id, secao_id) DO UPDATE SET
    mesa_pres = COALESCE(p_mesa_pres, sime_mesa_estado.mesa_pres),
    mesa_m1   = COALESCE(p_mesa_m1, sime_mesa_estado.mesa_m1),
    mesa_m2   = COALESCE(p_mesa_m2, sime_mesa_estado.mesa_m2),
    mesa_sec  = COALESCE(p_mesa_sec, sime_mesa_estado.mesa_sec),
    zeresima  = COALESCE(p_zeresima, sime_mesa_estado.zeresima),
    votacao   = COALESCE(p_votacao, sime_mesa_estado.votacao),
    encerrada = COALESCE(p_encerrada, sime_mesa_estado.encerrada),
    bu_impresso = COALESCE(p_bu_impresso, sime_mesa_estado.bu_impresso),
    material_recolhido = COALESCE(p_material_recolhido, sime_mesa_estado.material_recolhido),
    fila = COALESCE(p_fila, sime_mesa_estado.fila),
    panico_energia = COALESCE(p_panico_energia, sime_mesa_estado.panico_energia),
    panico_urna    = COALESCE(p_panico_urna, sime_mesa_estado.panico_urna),
    panico_energia_resolvido = COALESCE(p_panico_energia_resolvido, sime_mesa_estado.panico_energia_resolvido),
    panico_urna_resolvido    = COALESCE(p_panico_urna_resolvido, sime_mesa_estado.panico_urna_resolvido),
    panico_sos = COALESCE(p_panico_sos, sime_mesa_estado.panico_sos),
    panico_sos_resolvido = COALESCE(p_panico_sos_resolvido, sime_mesa_estado.panico_sos_resolvido),
    urna_entregue    = COALESCE(p_urna_entregue, sime_mesa_estado.urna_entregue),
    urna_entregue_ts = CASE WHEN p_urna_entregue AND sime_mesa_estado.urna_entregue_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_entregue_ts END,
    urna_recolhida    = COALESCE(p_urna_recolhida, sime_mesa_estado.urna_recolhida),
    urna_recolhida_ts = CASE WHEN p_urna_recolhida AND sime_mesa_estado.urna_recolhida_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_recolhida_ts END,
    urna_cartorio    = COALESCE(p_urna_cartorio, sime_mesa_estado.urna_cartorio),
    urna_cartorio_ts = CASE WHEN p_urna_cartorio AND sime_mesa_estado.urna_cartorio_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_cartorio_ts END,
    urna_chegou    = COALESCE(p_urna_chegou, sime_mesa_estado.urna_chegou),
    urna_chegou_ts = CASE WHEN p_urna_chegou AND sime_mesa_estado.urna_chegou_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_chegou_ts END,
    urna_posicionada    = COALESCE(p_urna_posicionada, sime_mesa_estado.urna_posicionada),
    urna_posicionada_ts = CASE WHEN p_urna_posicionada AND sime_mesa_estado.urna_posicionada_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_posicionada_ts END,
    urna_instalada    = COALESCE(p_urna_instalada, sime_mesa_estado.urna_instalada),
    urna_instalada_ts = CASE WHEN p_urna_instalada AND sime_mesa_estado.urna_instalada_ts IS NULL THEN v_now ELSE sime_mesa_estado.urna_instalada_ts END,
    problema_instalacao = COALESCE(p_problema_instalacao, sime_mesa_estado.problema_instalacao),
    problema_instalacao_resolvido = COALESCE(p_problema_instalacao_resolvido, sime_mesa_estado.problema_instalacao_resolvido),
    observacao = COALESCE(p_observacao, sime_mesa_estado.observacao),
    panico_energia_assumido = COALESCE(p_panico_energia_assumido, sime_mesa_estado.panico_energia_assumido),
    panico_urna_assumido    = COALESCE(p_panico_urna_assumido, sime_mesa_estado.panico_urna_assumido),
    panico_sos_assumido     = COALESCE(p_panico_sos_assumido, sime_mesa_estado.panico_sos_assumido),
    panico_energia_responsavel_nome = CASE WHEN p_panico_energia_responsavel IS NULL THEN sime_mesa_estado.panico_energia_responsavel_nome
                                            WHEN p_panico_energia_responsavel = '' THEN NULL
                                            ELSE p_panico_energia_responsavel END,
    panico_urna_responsavel_nome = CASE WHEN p_panico_urna_responsavel IS NULL THEN sime_mesa_estado.panico_urna_responsavel_nome
                                         WHEN p_panico_urna_responsavel = '' THEN NULL
                                         ELSE p_panico_urna_responsavel END,
    panico_sos_responsavel_nome = CASE WHEN p_panico_sos_responsavel IS NULL THEN sime_mesa_estado.panico_sos_responsavel_nome
                                        WHEN p_panico_sos_responsavel = '' THEN NULL
                                        ELSE p_panico_sos_responsavel END,
    updated_at = v_now,
    updated_by_origem = COALESCE(p_origem, sime_mesa_estado.updated_by_origem)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3. sime_ocorrencia_assumir() — espelha "assumida" pro campo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_ocorrencia_assumir(p_id UUID)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual(); v_nome TEXT;
BEGIN
  UPDATE sime_ocorrencias
     SET status='assumida', responsavel_id=v_eu, assumida_em=NOW()
   WHERE id=p_id AND status='aberta'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência já tem responsável ou não está aberta';
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id)
  VALUES (p_id, 'assumiu', v_eu);

  -- Espelha no campo — é o que faz o chip vermelho do mesário virar
  -- "🟡 Sendo atendido por Fulano" pelo MESMO canal Realtime que ele já
  -- assina (subscribeMesaEstadoSecao), sem nenhuma tela nova. Best-effort:
  -- uma falha aqui nunca desfaz o "assumir" em si.
  IF v_row.secao_id IS NOT NULL AND v_row.eleicao_id IS NOT NULL AND v_row.tipo IN ('energia','urna','sos') THEN
    BEGIN
      SELECT nome INTO v_nome FROM sime_usuarios WHERE id = v_eu;
      IF v_row.tipo = 'energia' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_energia_assumido => true, p_panico_energia_responsavel => COALESCE(v_nome,''), p_origem => 'cartorio');
      ELSIF v_row.tipo = 'urna' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_urna_assumido => true, p_panico_urna_responsavel => COALESCE(v_nome,''), p_origem => 'cartorio');
      ELSIF v_row.tipo = 'sos' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_sos_assumido => true, p_panico_sos_responsavel => COALESCE(v_nome,''), p_origem => 'cartorio');
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 4. sime_ocorrencia_delegar() — troca de mãos também atualiza o nome no
-- campo (o chip continua "sendo atendido", só troca de quem).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_ocorrencia_delegar(p_id UUID, p_para UUID, p_motivo TEXT)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual(); v_nome_novo TEXT;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da delegação';
  END IF;

  UPDATE sime_ocorrencias
     SET responsavel_id=p_para, status='assumida', assumida_em=NOW()
   WHERE id=p_id AND status IN ('aberta','assumida')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência não está aberta';
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'delegou', v_eu,
          (SELECT nome FROM sime_usuarios WHERE id=p_para) || ' — ' || p_motivo);

  IF v_row.secao_id IS NOT NULL AND v_row.eleicao_id IS NOT NULL AND v_row.tipo IN ('energia','urna','sos') THEN
    BEGIN
      SELECT nome INTO v_nome_novo FROM sime_usuarios WHERE id = p_para;
      IF v_row.tipo = 'energia' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_energia_assumido => true, p_panico_energia_responsavel => COALESCE(v_nome_novo,''), p_origem => 'cartorio');
      ELSIF v_row.tipo = 'urna' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_urna_assumido => true, p_panico_urna_responsavel => COALESCE(v_nome_novo,''), p_origem => 'cartorio');
      ELSIF v_row.tipo = 'sos' THEN
        PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
          p_panico_sos_assumido => true, p_panico_sos_responsavel => COALESCE(v_nome_novo,''), p_origem => 'cartorio');
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 5. sime_ocorrencia_resolver() — limpa "assumido"/nome junto da
-- resolução de sempre (mesmo bloco que já baixa panico_energia/resolvido).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_ocorrencia_resolver(p_id UUID, p_resolucao TEXT)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual();
BEGIN
  UPDATE sime_ocorrencias
     SET status='resolvida', resolvida_em=NOW(), resolvida_por=v_eu,
         resolucao=NULLIF(btrim(COALESCE(p_resolucao,'')),'')
   WHERE id=p_id AND status IN ('aberta','assumida')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência não está aberta';
  END IF;

  -- Espelha no campo. Só os campos do tipo em questão — os demais ficam NULL
  -- e o sime_acao_mesa mantém o que já estava lá.
  IF v_row.secao_id IS NOT NULL AND v_row.eleicao_id IS NOT NULL THEN
    IF v_row.tipo = 'energia' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_panico_energia => false, p_panico_energia_resolvido => true, p_origem => 'cartorio',
        p_panico_energia_assumido => false, p_panico_energia_responsavel => '');
    ELSIF v_row.tipo = 'urna' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_panico_urna => false, p_panico_urna_resolvido => true, p_origem => 'cartorio',
        p_panico_urna_assumido => false, p_panico_urna_responsavel => '');
    ELSIF v_row.tipo = 'instalacao' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_problema_instalacao => false, p_problema_instalacao_resolvido => true, p_origem => 'cartorio');
    ELSIF v_row.tipo = 'sos' THEN
      PERFORM sime_acao_mesa(p_secao_id => v_row.secao_id, p_eleicao_id => v_row.eleicao_id,
        p_panico_sos => false, p_panico_sos_resolvido => true, p_origem => 'cartorio',
        p_panico_sos_assumido => false, p_panico_sos_responsavel => '');
    END IF;
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'resolveu', v_eu, v_row.resolucao);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
