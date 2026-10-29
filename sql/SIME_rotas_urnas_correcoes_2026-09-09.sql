-- Correção de 3 dos 9 locais não casados na carga inicial das rotas de
-- urna (ver sql/SIME_rotas_urnas_2026-09-09.sql), confirmados pelo
-- cartório no mesmo dia: "vlceja é o mulata lima", "Milton Soldani é
-- agora a creche tia Medeiros", "escola municipal da varjota é o posto
-- de saude". Rodado uma vez via MCP/SQL Editor — não é idempotente.

-- UR11: Posto Saúde da Varjota (numero 218) entra na posição 1 — era o
-- PRIMEIRO item da ROTA 11 no texto original, então abre espaço nas
-- paradas já cadastradas em vez de só anexar no fim.
UPDATE sime_rota_secoes
SET parada = parada + 1
WHERE rota_id = (SELECT id FROM sime_rotas WHERE codigo='UR11' AND zona_id=(SELECT id FROM sime_zonas WHERE numero='7'));

INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT r.id, s.id, 1
FROM sime_rotas r
JOIN sime_secoes s ON s.numero = 218 AND s.zona_id = r.zona_id
WHERE r.codigo='UR11' AND r.zona_id=(SELECT id FROM sime_zonas WHERE numero='7');

-- UR4: Creche Tia Medeiros (9 seções, era "Escola Mun. Dr. Milton Soldani
-- Afonso") no final da rota — mesma posição do texto original.
INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT r.id, s.id, v.ordem
FROM (VALUES (17,74),(18,197),(19,206),(20,219),(21,224),(22,229),(23,236),(24,257),(25,261)) AS v(ordem, numero)
JOIN sime_rotas r ON r.codigo='UR4' AND r.zona_id=(SELECT id FROM sime_zonas WHERE numero='7')
JOIN sime_secoes s ON s.numero = v.numero AND s.zona_id = r.zona_id;

-- UR6: Centro Ed. JA Mulata Lima (9 seções, "CEJA") no final da rota.
INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT r.id, s.id, v.ordem
FROM (VALUES (28,1),(29,2),(30,3),(31,49),(32,50),(33,126),(34,156),(35,237),(36,249)) AS v(ordem, numero)
JOIN sime_rotas r ON r.codigo='UR6' AND r.zona_id=(SELECT id FROM sime_zonas WHERE numero='7')
JOIN sime_secoes s ON s.numero = v.numero AND s.zona_id = r.zona_id;

-- mão-dupla pra sime_secoes (distribuicao é tipo legado)
UPDATE sime_secoes s
SET rota_id = rs.rota_id, parada = rs.parada
FROM sime_rota_secoes rs
JOIN sime_rotas r ON r.id = rs.rota_id
WHERE s.id = rs.secao_id AND r.tipos @> ARRAY['distribuicao']::text[]
  AND r.zona_id = (SELECT id FROM sime_zonas WHERE numero='7');

-- regenera as paradas de RU4/RU6/RU11 do zero (a ordem invertida muda
-- por completo, não é só anexar).
DELETE FROM sime_rota_secoes
WHERE rota_id IN (
  SELECT id FROM sime_rotas WHERE codigo IN ('RU4','RU6','RU11')
    AND zona_id = (SELECT id FROM sime_zonas WHERE numero='7')
);

INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT ru.id, rs.secao_id, (max_parada.mx - rs.parada + 1)
FROM sime_rotas ru
JOIN sime_rotas ur ON ur.id = ru.rota_origem_id
JOIN sime_rota_secoes rs ON rs.rota_id = ur.id
JOIN LATERAL (SELECT max(parada) mx FROM sime_rota_secoes WHERE rota_id = ur.id) max_parada ON true
WHERE ru.codigo IN ('RU4','RU6','RU11') AND ru.zona_id = (SELECT id FROM sime_zonas WHERE numero='7');

-- ponto_partida do recolhimento segue o novo último local da ida
UPDATE sime_rotas ru
SET ponto_partida = ultima.local_nome || ', ' || ultima.municipio
FROM sime_rotas ur
JOIN LATERAL (
  SELECT s.local_nome, s.municipio
  FROM sime_rota_secoes rs JOIN sime_secoes s ON s.id = rs.secao_id
  WHERE rs.rota_id = ur.id ORDER BY rs.parada DESC LIMIT 1
) ultima ON true
WHERE ru.rota_origem_id = ur.id AND ru.codigo IN ('RU4','RU6','RU11');
