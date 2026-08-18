-- =====================================================================
-- Schema: campanhas + script conversacional por etapa
-- =====================================================================
-- Especificação: SIME_CAMPANHAS_MELHORIA_ESPECIFICACAO.md, seções 15-16.
--
-- Hoje sime_campanhas_confirmacao é só uma fila de itens (telefone +
-- status), sem noção de "campanha" como entidade — a lógica de
-- verificação/convocação é hardcoded em identidade.js no Hermes (uma
-- única etapa fixa, lista fixa de SIM/NÃO).
--
-- Este schema introduz:
--   1. sime_campanhas       — entidade campanha (nome, zona, criador)
--   2. sime_campanha_etapas — script: etapas com palavras-chave e ação
--   3. campanha_id + etapa_atual em sime_campanhas_confirmacao
--
-- Compatibilidade: campanha_id é NULLABLE. Itens antigos/sem campanha
-- continuam usando o comportamento hardcoded atual do Hermes
-- (identidade.js) como fallback — nada quebra em produção.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Campanha (entidade)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sime_campanhas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  zona_id       UUID REFERENCES sime_zonas(id),
  criado_por    UUID REFERENCES auth.users(id),
  status        TEXT NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('rascunho', 'ativa', 'pausada', 'encerrada')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campanhas_zona ON sime_campanhas(zona_id);

ALTER TABLE sime_campanhas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campanhas_zona_policy ON sime_campanhas;
CREATE POLICY campanhas_zona_policy ON sime_campanhas
  FOR ALL USING (sime_zona_visivel(zona_id)) WITH CHECK (sime_zona_visivel(zona_id));

-- ---------------------------------------------------------------------
-- 2. Etapas do script (o "script conversacional" da seção 15-16)
-- ---------------------------------------------------------------------
-- Cada linha é uma etapa. `respostas_esperadas` guarda as ramificações
-- possíveis dessa etapa em JSON — cada ramo tem palavras-chave, a
-- próxima etapa (ou null se terminal), uma ação e um status final
-- opcional (grava em sime_campanhas_confirmacao.status quando a etapa
-- é terminal).
--
-- Formato de respostas_esperadas (array de objetos):
-- [
--   {
--     "intencao": "confirmacao",
--     "palavras_chave": ["sim", "s", "sou eu", "confirmo", "correto"],
--     "proxima_etapa": 2,
--     "acao": "enviar_convocacao",
--     "status_final": null
--   },
--   {
--     "intencao": "negativa",
--     "palavras_chave": ["nao", "n", "numero errado", "outra pessoa"],
--     "proxima_etapa": null,
--     "acao": "nenhuma",
--     "status_final": "telefone_incorreto"
--   }
-- ]
CREATE TABLE IF NOT EXISTS sime_campanha_etapas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id           UUID NOT NULL REFERENCES sime_campanhas(id) ON DELETE CASCADE,
  etapa_numero          INTEGER NOT NULL,
  mensagem              TEXT NOT NULL,
  respostas_esperadas   JSONB NOT NULL DEFAULT '[]'::jsonb,
  etapa_inicial         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, etapa_numero)
);

CREATE INDEX IF NOT EXISTS idx_campanha_etapas_campanha ON sime_campanha_etapas(campanha_id);

ALTER TABLE sime_campanha_etapas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campanha_etapas_visivel ON sime_campanha_etapas;
CREATE POLICY campanha_etapas_visivel ON sime_campanha_etapas
  FOR ALL USING (
    campanha_id IN (SELECT id FROM sime_campanhas WHERE sime_zona_visivel(zona_id))
  ) WITH CHECK (
    campanha_id IN (SELECT id FROM sime_campanhas WHERE sime_zona_visivel(zona_id))
  );

-- ---------------------------------------------------------------------
-- 3. Liga a fila existente à campanha + etapa atual
-- ---------------------------------------------------------------------
-- Nullable de propósito: itens sem campanha_id continuam no fluxo
-- hardcoded atual (identidade.js) — só entram no interpretador de
-- script quando campanha_id estiver preenchido.
ALTER TABLE sime_campanhas_confirmacao
  ADD COLUMN IF NOT EXISTS campanha_id UUID REFERENCES sime_campanhas(id);

ALTER TABLE sime_campanhas_confirmacao
  ADD COLUMN IF NOT EXISTS etapa_atual INTEGER;

CREATE INDEX IF NOT EXISTS idx_campanhas_confirmacao_campanha
  ON sime_campanhas_confirmacao(campanha_id);
