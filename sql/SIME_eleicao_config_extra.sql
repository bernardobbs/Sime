-- ============================================================
-- SIME — SQL: nome da eleição, início da distribuição e intervalo
-- entre saídas, agora persistidos em sime_eleicoes
--
-- Pendência histórica (CLAUDE.md): esses três campos só existiam em
-- localStorage['sime_eleicao_v1'] — trocar de navegador, ou um admin que só
-- usa Tokens/Admin sem nunca ter aberto o Principal na mesma máquina, perdia
-- (ou nunca via) o nome da eleição configurado. O resto da configuração
-- (datas, horário de abertura/encerramento) já persistia; só faltavam estes.
-- ============================================================

ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS nome TEXT;
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS dist_inicio TIME;
ALTER TABLE sime_eleicoes ADD COLUMN IF NOT EXISTS intervalo_saidas_min INTEGER;

-- Sem índice novo: as três colunas só são lidas junto com a linha inteira de
-- sime_eleicoes (por zona_id/ativa), já coberto pela constraint existente
-- (zona_id, turno).
