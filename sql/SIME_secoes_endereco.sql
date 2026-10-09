-- Endereço do local de votação, a partir do "Formulário de Vistoria" do TSE
-- (Local de Votação: nnnn - NOME / Endereço: ... / Seções: ...), 27/09/2026.
-- Texto livre, repetido entre as seções do mesmo prédio (mesmo padrão de
-- latitude/longitude/uc_equatorial) — não existe tabela própria de "locais".

alter table sime_secoes add column if not exists endereco text;

-- Backfill único, feito uma vez via SQL Editor/MCP a partir do anexo colado
-- pelo cartório (Campo Maior, Jatobá do Piauí, Sigefredo Pacheco) — casado
-- por número de seção (chave já usada em todo o resto do projeto), não pelo
-- "código do local" do TSE, que se repete entre municípios diferentes
-- (ex.: "1031" é SAAE em Campo Maior, G.E. Prof. Francisco Luis em Jatobá,
-- e G.E. Manoel Francisco em Sigefredo Pacheco — não é chave global).
-- Este arquivo documenta o schema; o backfill em si não é reaplicável
-- (mesmo padrão de SIME_telefones_normalizacao.sql e afins) — ver histórico
-- de execução no CLAUDE.md, seção "ENDEREÇO DO LOCAL DE VOTAÇÃO".
