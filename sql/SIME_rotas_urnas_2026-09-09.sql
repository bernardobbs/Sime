-- Carga das 12 rotas de distribuição de urna da 7ª Zona (09/09/2026,
-- pedido direto: planilha "ROTA 01..12" colada, com a regra "distribuição
-- na véspera a partir de 5h" e "recolhimento após a eleição, após as
-- 17h"). Rodado uma vez via MCP/SQL Editor (service_role) — NÃO é
-- idempotente (os INSERTs duplicariam se rodados de novo); documentado
-- aqui pra registro, não pra reaplicar sozinho. Ver seção "MÓDULO 🗺️
-- ROTAS" do CLAUDE.md pra contexto completo (locais casados, os 9 que
-- ficaram de fora por não bater com nenhuma seção cadastrada, etc.).
--
-- Pré-requisito aplicado antes desta carga: sime_rotas.codigo alargado de
-- VARCHAR(3) pra VARCHAR(10) (códigos UR10/UR11/UR12/RU10/RU11/RU12 têm
-- 4 caracteres).

-- 1) UR1 já existia (cadastro de teste anterior) — só corrige pra bater
--    com a regra confirmada pelo cartório.
UPDATE sime_rotas
SET ponto_partida = 'Cartório Eleitoral da 7ª Zona Eleitoral',
    horario_saida = '05:00:00'
WHERE codigo = 'UR1';

-- 2) UR2..UR12 — rotas de distribuição, mesmo padrão de UR1.
INSERT INTO sime_rotas (zona_id, codigo, nome, tipos, ponto_partida, horario_saida, tempo_parada_min, ativo)
SELECT (SELECT id FROM sime_zonas WHERE numero='7'), codigo, nome, ARRAY['distribuicao'], 'Cartório Eleitoral da 7ª Zona Eleitoral', '05:00:00', 10, true
FROM (VALUES
  ('UR2','Rota Urnas 02'),('UR3','Rota Urnas 03'),('UR4','Rota Urnas 04'),('UR5','Rota Urnas 05'),
  ('UR6','Rota Urnas 06'),('UR7','Rota Urnas 07'),('UR8','Rota Urnas 08'),('UR9','Rota Urnas 09'),
  ('UR10','Rota Urnas 10'),('UR11','Rota Urnas 11'),('UR12','Rota Urnas 12')
) AS v(codigo, nome);

-- 3) Paradas de UR2..UR12, casadas por número de seção (ver CLAUDE.md pra
--    a lista de locais do texto → nome em sime_secoes; 9 locais da
--    planilha não bateram com nenhuma seção e ficaram de fora, de
--    propósito).
INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT r.id, s.id, v.ordem
FROM (VALUES
  ('UR2',1,187),('UR2',2,209),('UR2',3,164),('UR2',4,195),('UR2',5,234),
  ('UR3',1,137),('UR3',2,220),('UR3',3,141),('UR3',4,192),('UR3',5,244),('UR3',6,196),
  ('UR4',1,63),('UR4',2,64),('UR4',3,65),('UR4',4,66),('UR4',5,124),('UR4',6,145),('UR4',7,181),
  ('UR4',8,62),('UR4',9,122),('UR4',10,242),('UR4',11,248),('UR4',12,256),('UR4',13,205),('UR4',14,217),('UR4',15,233),('UR4',16,255),
  ('UR5',1,44),('UR5',2,191),('UR5',3,29),('UR5',4,30),('UR5',5,31),('UR5',6,123),('UR5',7,148),('UR5',8,259),
  ('UR5',9,71),('UR5',10,155),('UR5',11,202),('UR5',12,223),('UR5',13,240),('UR5',14,251),
  ('UR6',1,17),('UR6',2,18),('UR6',3,19),('UR6',4,20),('UR6',5,157),('UR6',6,6),('UR6',7,12),('UR6',8,149),
  ('UR6',9,4),('UR6',10,14),('UR6',11,37),('UR6',12,38),('UR6',13,15),('UR6',14,16),('UR6',15,125),
  ('UR6',16,45),('UR6',17,46),('UR6',18,47),('UR6',19,116),('UR6',20,117),('UR6',21,5),
  ('UR6',22,33),('UR6',23,34),('UR6',24,35),('UR6',25,36),('UR6',26,115),('UR6',27,128),
  ('UR7',1,204),('UR7',2,247),('UR7',3,136),('UR7',4,152),('UR7',5,140),('UR7',6,201),('UR7',7,189),('UR7',8,159),('UR7',9,246),
  ('UR8',1,79),('UR8',2,80),('UR8',3,81),('UR8',4,133),('UR8',5,252),('UR8',6,166),('UR8',7,228),('UR8',8,213),('UR8',9,167),('UR8',10,230),
  ('UR9',1,85),('UR9',2,86),('UR9',3,87),('UR9',4,88),('UR9',5,89),('UR9',6,90),('UR9',7,132),('UR9',8,151),('UR9',9,158),('UR9',10,177),
  ('UR9',11,203),('UR9',12,211),('UR9',13,222),('UR9',14,241),('UR9',15,250),('UR9',16,193),('UR9',17,214),
  ('UR10',1,147),('UR10',2,173),('UR10',3,198),('UR10',4,215),('UR10',5,235),('UR10',6,165),('UR10',7,208),('UR10',8,253),
  ('UR10',9,212),('UR10',10,245),('UR10',11,175),('UR10',12,238),('UR10',13,178),
  ('UR11',1,185),('UR11',2,226),('UR11',3,199),('UR11',4,179),('UR11',5,194),('UR11',6,188),('UR11',7,216),('UR11',8,227),
  ('UR12',1,200),('UR12',2,168),('UR12',3,101),('UR12',4,102),('UR12',5,103),('UR12',6,112),('UR12',7,171),('UR12',8,172),('UR12',9,176),
  ('UR12',10,207),('UR12',11,239),('UR12',12,174),('UR12',13,210),('UR12',14,232),('UR12',15,260),('UR12',16,225)
) AS v(codigo, ordem, numero)
JOIN sime_rotas r ON r.codigo = v.codigo AND r.zona_id = (SELECT id FROM sime_zonas WHERE numero='7')
JOIN sime_secoes s ON s.numero = v.numero AND s.zona_id = r.zona_id;

-- 4) Mão-dupla pra sime_secoes.rota_id/parada (distribuicao é tipo
--    legado — Motorista/Conferente/TV Distribuição leem esses campos
--    direto, não sime_rota_secoes).
UPDATE sime_secoes s
SET rota_id = rs.rota_id, parada = rs.parada
FROM sime_rota_secoes rs
JOIN sime_rotas r ON r.id = rs.rota_id
WHERE s.id = rs.secao_id AND r.tipos @> ARRAY['distribuicao']::text[]
  AND r.zona_id = (SELECT id FROM sime_zonas WHERE numero='7');

-- 5) Rotas de recolhimento (RU1..RU12) — mesmo trajeto de cada UR#,
--    invertido, indo até o Cartório, saindo às 17h.
INSERT INTO sime_rotas (zona_id, codigo, nome, tipos, ponto_partida, destino, horario_saida, tempo_parada_min, rota_origem_id, ativo)
SELECT r.zona_id,
       replace(r.codigo, 'UR', 'RU'),
       replace(r.nome, 'Urnas', 'Recolhimento Urnas'),
       ARRAY['recolhimento_urna'],
       ultima.local_nome || ', ' || ultima.municipio,
       'Cartório Eleitoral da 7ª Zona Eleitoral',
       '17:00:00',
       r.tempo_parada_min,
       r.id,
       true
FROM sime_rotas r
JOIN LATERAL (
  SELECT s.local_nome, s.municipio
  FROM sime_rota_secoes rs JOIN sime_secoes s ON s.id = rs.secao_id
  WHERE rs.rota_id = r.id ORDER BY rs.parada DESC LIMIT 1
) ultima ON true
WHERE r.tipos @> ARRAY['distribuicao']::text[] AND r.zona_id = (SELECT id FROM sime_zonas WHERE numero='7');

-- 6) Paradas do recolhimento — mesma lista da distribuição, ordem invertida.
INSERT INTO sime_rota_secoes (rota_id, secao_id, parada)
SELECT ru.id, rs.secao_id, (max_parada.mx - rs.parada + 1)
FROM sime_rotas ru
JOIN sime_rotas ur ON ur.id = ru.rota_origem_id
JOIN sime_rota_secoes rs ON rs.rota_id = ur.id
JOIN LATERAL (SELECT max(parada) mx FROM sime_rota_secoes WHERE rota_id = ur.id) max_parada ON true
WHERE ru.tipos @> ARRAY['recolhimento_urna']::text[] AND ru.zona_id = (SELECT id FROM sime_zonas WHERE numero='7');
