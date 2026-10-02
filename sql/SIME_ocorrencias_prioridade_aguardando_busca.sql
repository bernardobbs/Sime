-- ════════════════════════════════════════════════════════════
-- SIME — Prioridade declarada + "Aguardando terceiro" + busca em resolvidos
-- ════════════════════════════════════════════════════════════
-- Pedido direto, a partir de um brainstorm sobre gestão de tickets/helpdesk
-- ("explique o que podemos melhorar..." → "vamos implementar os itens 1, 2
-- e 5"):
--   1. Prioridade/gravidade declarada — hoje só existe nivel_escalonamento
--      (derivado do relógio, 10min/30min); não há como o cartório dizer
--      "isto é urgente" na hora, antes do escalonamento automático chegar.
--   2. Status "aguardando terceiro" — hoje uma ocorrência assumida e uma
--      ocorrência assumida-mas-esperando-a-Equatorial-ligar-de-volta são
--      visualmente idênticas.
--   5. Busca em chamados já resolvidos — recarregar() só busca
--      status IN ('aberta','assumida'); um chamado resolvido some da tela
--      pra sempre, sem jeito de reabrir pra consulta (ex.: "o chamado #012
--      já foi resolvido, o que foi feito?").
--
-- Idempotente: pode ser aplicado mais de uma vez.

-- ------------------------------------------------------------
-- 1. PRIORIDADE — coluna própria, nunca substitui nivel_escalonamento
-- ------------------------------------------------------------
-- Os dois sinais respondem perguntas diferentes: nivel_escalonamento é
-- "quanto tempo isso já está parado, sem ninguém resolver" (cronômetro,
-- não editável por ninguém); prioridade é "quão grave o cartório julga que
-- isso é", declarado por quem está olhando o caso — pode mudar a qualquer
-- momento, pra cima ou pra baixo, sem depender do relógio. Continua editável
-- depois de aberta (não só "na abertura"): a maioria das ocorrências nasce
-- pelo gatilho automático do campo (pânico), sem passar por nenhum humano
-- no momento da abertura — travar a escolha só pro raro fluxo de
-- sime_ocorrencia_abrir() (que nem tem UI própria hoje) deixaria de fora
-- quase todo o volume real.
ALTER TABLE sime_ocorrencias
  ADD COLUMN IF NOT EXISTS prioridade TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE sime_ocorrencias DROP CONSTRAINT IF EXISTS sime_ocorrencias_prioridade_check;
ALTER TABLE sime_ocorrencias ADD CONSTRAINT sime_ocorrencias_prioridade_check
  CHECK (prioridade IN ('baixa','normal','alta'));

-- ------------------------------------------------------------
-- 2. AGUARDANDO TERCEIRO — flag booleana própria, não um status novo
-- ------------------------------------------------------------
-- Mesmo espírito de sime_atores.precisa_substituir (documentado no
-- CLAUDE.md): um novo VALOR de status exigiria atualizar todo lugar que já
-- lê `status IN ('aberta','assumida')` como "ainda em aberto" (recarregar(),
-- escalonamento, índice único de pânico) — uma flag ao lado não quebra
-- nenhum desses. Só faz sentido depois de alguém ter assumido (RPC abaixo
-- exige responsavel_id preenchido) — "aguardando terceiro" pressupõe que
-- já tem dono cuidando, só esperando resposta de fora.
ALTER TABLE sime_ocorrencias
  ADD COLUMN IF NOT EXISTS aguardando_terceiro BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 3. RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sime_ocorrencia_definir_prioridade(p_id UUID, p_prioridade TEXT)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual();
BEGIN
  IF p_prioridade NOT IN ('baixa','normal','alta') THEN
    RAISE EXCEPTION 'Prioridade inválida';
  END IF;

  UPDATE sime_ocorrencias
     SET prioridade = p_prioridade
   WHERE id = p_id AND status IN ('aberta','assumida')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Ocorrência não está aberta';
  END IF;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'prioridade_definida', v_eu,
          CASE p_prioridade WHEN 'alta' THEN 'Alta' WHEN 'baixa' THEN 'Baixa' ELSE 'Normal' END);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION sime_ocorrencia_toggle_aguardando_terceiro(p_id UUID)
RETURNS sime_ocorrencias AS $$
DECLARE v_row sime_ocorrencias; v_eu UUID := sime_usuario_atual(); v_novo BOOLEAN;
BEGIN
  SELECT NOT aguardando_terceiro INTO v_novo FROM sime_ocorrencias
   WHERE id = p_id AND status IN ('aberta','assumida') AND responsavel_id IS NOT NULL;

  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Ocorrência precisa estar assumida antes de marcar aguardando terceiro';
  END IF;

  UPDATE sime_ocorrencias SET aguardando_terceiro = v_novo
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO sime_ocorrencia_eventos(ocorrencia_id, acao, autor_id, detalhe)
  VALUES (p_id, 'aguardando_terceiro', v_eu, CASE WHEN v_novo THEN 'Marcado' ELSE 'Desmarcado' END);
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 4. Busca em resolvidos (item 5) não precisa de RPC nem coluna nova —
-- é só um SELECT com status IN ('resolvida','cancelada') em vez de
-- ('aberta','assumida'), já coberto pela mesma RLS de sempre
-- (ocorrencias_zona_policy). Ver SIME_problemas.html, buscarResolvidos().
-- ------------------------------------------------------------
