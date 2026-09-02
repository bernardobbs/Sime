-- ============================================================
-- SIME — SQL: carga, preparação e lacre por seção (D-X)
--
-- Achados críticos da auditoria de UI/UX (08/08/2026): o Coordenador de
-- Preparação (SIME_coordenador_preparacao.html) gravava esse progresso só
-- em localStorage['sime_lacre_v3'] — sem Supabase, sem fila offline, sem
-- badge de sincronização, violando a regra 5 do CLAUDE.md. A TV Preparação
-- (SIME_tv_preparacao.html) lia essa mesma chave local — numa TV real
-- (outro dispositivo físico), as barras ficavam sempre em 0%, sem Realtime
-- nenhum, a mesma armadilha já documentada no CLAUDE.md pra sime_mesa_estado.
--
-- Uma linha por (eleicao_id, secao_id) — mesmo padrão de sime_mesa_estado,
-- RLS via sime_zona_visivel(zona_id) através do join com sime_eleicoes.
-- ============================================================

CREATE TABLE IF NOT EXISTS sime_carga_lacre (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eleicao_id    UUID REFERENCES sime_eleicoes(id),
  secao_id      UUID REFERENCES sime_secoes(id),
  carga         BOOLEAN NOT NULL DEFAULT false,
  preparacao    BOOLEAN NOT NULL DEFAULT false,
  lacre         BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sime_carga_lacre DROP CONSTRAINT IF EXISTS sime_carga_lacre_eleicao_secao_key;
ALTER TABLE sime_carga_lacre ADD CONSTRAINT sime_carga_lacre_eleicao_secao_key UNIQUE (eleicao_id, secao_id);

ALTER TABLE sime_carga_lacre ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS carga_lacre_zona_policy ON sime_carga_lacre;
CREATE POLICY carga_lacre_zona_policy ON sime_carga_lacre
  USING (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)))
  WITH CHECK (eleicao_id IN (SELECT id FROM sime_eleicoes WHERE sime_zona_visivel(zona_id)));

-- Sem isto o Realtime nunca dispara (mesma armadilha documentada no
-- CLAUDE.md para sime_mesa_estado — assinar no JS não basta).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_carga_lacre;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
