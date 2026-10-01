-- Urnas de contingência ganham estágio (01/10/2026)
--
-- Pedido direto, com print do TV box da 7ª Zona mostrando 147/147/147/174
-- ("faltam 27 urnas"): "E todas as urnas de contingência foi dado carga
-- quero que apareça 100%".
--
-- As 27 urnas de contingência (sime_eleicoes.urnas_contingencia, ver
-- sql/SIME_eleicoes_urnas_total.sql, 22/09/2026) nunca tiveram onde
-- "receber carga" — são só um NÚMERO somado ao Total, sem sime_secoes/
-- sime_carga_lacre próprios (não existe seção nem card pra elas em nenhuma
-- tela) — então o numerador das 3 barras (carga/preparação/lacre) da TV
-- Preparação/Coordenador de Preparação nunca passava de urnas_secoes/Total
-- (147/174 = 84% na 7ª Zona), mesmo com as urnas de contingência
-- fisicamente prontas.
--
-- Deliberadamente EM LOTE, não uma linha por urna — mesmo critério de
-- urnas_contingencia em si (só uma contagem agregada, nunca
-- individualizada): o cartório confirma "as 27 já foram carregadas" de uma
-- vez, não urna por urna.

alter table sime_eleicoes
  add column if not exists contingencia_carga boolean not null default false,
  add column if not exists contingencia_preparacao boolean not null default false,
  add column if not exists contingencia_lacre boolean not null default false;

-- Aplicado em produção na 7ª Zona (1º turno, eleição ativa) no mesmo dia:
-- update sime_eleicoes set contingencia_carga = true where id = '70e75e36-1110-4604-ba03-3bb934b31f49';
