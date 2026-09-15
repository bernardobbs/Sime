-- Treinamento online — indicar quem fez (está fazendo) e quem concluiu
-- (15/09/2026, pedido direto: "quero poder indicar quem fez e concluiu o
-- treinamento online").
--
-- Separado do treinamento PRESENCIAL (sime_turmas/sime_turma_pessoas, aba
-- 🎓 Treinamento) de propósito: as 16 turmas importadas do ELO hoje são
-- todas modalidade='Presencial' (conferido em produção antes desta
-- migração — 0 turmas online cadastradas), e treinamento online não tem
-- turma/data/local/instrutor nenhum — é um curso autoguiado que cada
-- mesário faz por conta própria, então não faz sentido modelar como mais
-- uma "turma". Por isso vira um status por PESSOA em sime_atores, não uma
-- linha em sime_turma_pessoas.
--
-- Um status só (não dois booleanos independentes) pra nunca existir um
-- estado sem sentido tipo "concluiu mas nunca começou" — mesmo raciocínio
-- já usado noutros lugares do projeto (ex.: sime_ocorrencias.status).
ALTER TABLE sime_atores
  ADD COLUMN IF NOT EXISTS treinamento_online_status TEXT NOT NULL DEFAULT 'nao_iniciado'
    CHECK (treinamento_online_status IN ('nao_iniciado', 'em_andamento', 'concluido')),
  ADD COLUMN IF NOT EXISTS treinamento_online_concluido_em TIMESTAMPTZ;
