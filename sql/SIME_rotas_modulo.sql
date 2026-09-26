-- Módulo de Rotas (04/09/2026) — pedido direto: "precisa ser rota poder
-- cadastrar rotas de recolhimento de mídias, distribuição e recolhimento de
-- urnas, rotas de instalação de seção".
--
-- Até aqui `sime_rotas` só tinha um propósito implícito, nunca marcado no
-- schema: as 35 linhas atuais da 7ª Zona (+ 7 da 94ª) vieram do export do
-- MaxLog (Sistema de Logística das Eleições do TRE) em 31/08/2026 e — CONFIRMADO
-- com o dono do projeto em 04/09/2026, antes de aplicar esta migração — cobrem
-- ida (distribuição) E volta (recolhimento de urna) pelo MESMO trajeto físico
-- (mesmo veículo leva a urna e traz de volta). `urnas_estimadas` e o texto do
-- itinerário ("entrega direta pelo presidente de mesa", "ponto de
-- consolidação") batem com isso, não com recolhimento de mídia (cartão de
-- memória) — o CLAUDE.md anterior chamava essas rotas de "recolhimento de
-- mídia" por imprecisão de vocabulário, não porque o dado fosse esse.
--
-- Idempotente (pode rodar de novo sem duplicar nada).

-- 1. `tipos` — array, não um valor único: uma mesma rota pode servir mais de
-- um propósito ao mesmo tempo (caso confirmado das 42 rotas atuais).
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS tipos TEXT[];
UPDATE sime_rotas SET tipos = ARRAY['distribuicao','recolhimento_urna']
  WHERE tipos IS NULL;
ALTER TABLE sime_rotas ALTER COLUMN tipos SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE sime_rotas ADD CONSTRAINT sime_rotas_tipos_chk
    CHECK (tipos <@ ARRAY['distribuicao','recolhimento_urna','recolhimento_midia','instalacao']::text[]
           AND array_length(tipos, 1) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Junção rota↔seção — uma seção pode precisar de rotas DIFERENTES por
-- tipo ao mesmo tempo (ex.: rota de instalação numa data, rota de
-- distribuição/recolhimento de urna noutra), o que uma FK única em
-- `sime_secoes.rota_id` não comporta. `sime_secoes.rota_id`/`parada`
-- CONTINUAM existindo e são a fonte real pra quem já lê direto de lá
-- (Motorista, Conferente, TV Distribuição, sime_dados.js) — o módulo novo
-- escreve nos dois ao mesmo tempo pra tipo 'distribuicao'/'recolhimento_urna'
-- (ver sime_rotas_modulo.js), então esta tabela é sempre a visão completa e
-- atualizada, pros 4 tipos.
CREATE TABLE IF NOT EXISTS sime_rota_secoes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rota_id    UUID NOT NULL REFERENCES sime_rotas(id) ON DELETE CASCADE,
  secao_id   UUID NOT NULL REFERENCES sime_secoes(id) ON DELETE CASCADE,
  parada     INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rota_id, secao_id)
);
CREATE INDEX IF NOT EXISTS idx_rota_secoes_rota  ON sime_rota_secoes(rota_id);
CREATE INDEX IF NOT EXISTS idx_rota_secoes_secao ON sime_rota_secoes(secao_id);

ALTER TABLE sime_rota_secoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_secoes_zona_policy ON sime_rota_secoes;
CREATE POLICY rota_secoes_zona_policy ON sime_rota_secoes
  FOR ALL USING     (rota_id IN (SELECT id FROM sime_rotas WHERE sime_zona_visivel(zona_id)))
          WITH CHECK (rota_id IN (SELECT id FROM sime_rotas WHERE sime_zona_visivel(zona_id)));

-- 3. Backfill: espelha o que já existe em sime_secoes.rota_id (as 174/175
-- seções da 7ª Zona já vinculadas pelo import do MaxLog) — sem isso, o
-- módulo novo abriria mostrando "0 seções" nas rotas de
-- distribuição/recolhimento de urna que já têm gente vinculada de verdade.
INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
  SELECT rota_id, id, parada FROM sime_secoes WHERE rota_id IS NOT NULL
  ON CONFLICT (rota_id, secao_id) DO NOTHING;

-- 4. Código único por zona — nenhuma linha em produção violava isso (checado
-- antes de aplicar), só nunca tinha sido declarado no schema (mesmo padrão
-- de sime_secoes_zona_numero_key).
DO $$ BEGIN
  ALTER TABLE sime_rotas ADD CONSTRAINT sime_rotas_zona_codigo_key UNIQUE (zona_id, codigo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
