-- codigo era varchar(3) — suficiente pros códigos numéricos (001-035) do
-- MaxLog, mas as rotas de urna (UR1..UR12, RU1..RU12) passam de 3
-- caracteres (UR10, UR11...). Aplicado em produção em 09/09/2026, antes
-- da carga de sql/SIME_rotas_urnas_2026-09-09.sql. Idempotente (ALTER ...
-- TYPE não falha se já estiver nesse tamanho, embora não seja um IF NOT
-- EXISTS de verdade).
ALTER TABLE sime_rotas ALTER COLUMN codigo TYPE VARCHAR(10);
