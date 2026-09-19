-- Rota real via Google Directions API (09/09/2026, pedido direto: linha
-- seguindo rua de verdade na ficha impressa + previsão de chegada mais
-- precisa). O resultado do Google é sempre CACHEADO aqui — nunca
-- recalculado sozinho em tempo real (a API é paga acima do crédito
-- grátis mensal, e a ficha/previsão de chegada recalculam com muita
-- frequência; ver api/rotas-directions.js e a seção própria no CLAUDE.md).
--
-- Idempotente (pode rodar de novo sem duplicar nada).

ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS rota_real_polyline JSONB;          -- [[lat,lon], ...] já decodificado
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS rota_real_distancia_m NUMERIC;
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS rota_real_duracao_s NUMERIC;
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS rota_real_paradas_assinatura TEXT; -- ids das paradas na ordem, "id1,id2,id3" — pra saber se o cache ficou velho
ALTER TABLE sime_rotas ADD COLUMN IF NOT EXISTS rota_real_calculada_em TIMESTAMPTZ;
