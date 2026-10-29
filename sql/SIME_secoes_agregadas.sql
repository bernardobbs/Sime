-- Seção agregada — sem mesa/urna própria (25/10/2026)
--
-- Pedido direto, a partir de um achado real: "Seção 18 está agregada" / "as
-- agregadas não devem aparecer como problema no SIME por mesa incompleta".
-- Investigado contra produção: a Seção 18 nunca teve nenhum dos 4 cargos de
-- mesa designados (0 mesário, sempre) — mesmo padrão do conceito de "seção
-- agregada" do TSE (já citado em sql/SIME_secoes_horario_encerramento_previsto.sql,
-- 27/09/2026 — "Tempo_de_Transmissão.xlsx", grupo PRINCIPAL + agregadas, mesmo
-- prédio, processadas com a mesma urna/mesa): confirmado batendo o
-- agrupamento por horário previsto de encerramento (minuto idêntico entre
-- seções do mesmo prédio) contra quem de fato tem mesa designada — pra
-- {17,18,19,20,157} (Col. Est. Profª Raimundinho Andrade), só 17 e 20 têm os
-- 4 cargos confirmados; 18/19/157 nunca tiveram nenhum.
--
-- Levantada a lista completa de seções ATIVAS da zona que nunca tiveram
-- NENHUM mesário designado desde que a convocação começou a ser sincronizada
-- (meses de imports do TRE/ELO, sem nenhuma oscilação) — sinal mais forte e
-- direto que casar por horário, e confirmado com o dono do projeto antes de
-- aplicar (as 26 são todas agregadas, nenhuma é vaga real por preencher).
--
-- `sime_secoes.secao_agregada` (boolean, nunca mais calculado — é uma
-- constatação administrativa do TSE, não um dado que o SIME deriva sozinho)
-- é consumido por agruparSecoesPorCidade() (sime_tv_auth.js), que passou a
-- excluir essas seções do agrupamento por prédio usado pelas 3 TVs
-- (Preparação/Véspera/Dia) — sem isso, o rollup do prédio inteiro nunca
-- fechava ("completo"/"encerrada"/"urna no cartório") porque a seção
-- agregada nunca gera linha em sime_mesa_estado (nenhum mesário loga pra
-- ela), e o Dia D ainda disparava "⏱ Votação não iniciada"/"👥 Mesa
-- incompleta" pra uma seção que não existe como unidade operacional própria.
alter table sime_secoes add column if not exists secao_agregada boolean not null default false;

update sime_secoes
set secao_agregada = true
where zona_id = (select id from sime_zonas where numero = 7)
  and numero in (6,14,16,18,19,34,36,45,49,50,112,115,117,149,156,157,171,174,176,220,234,237,249,258,260,262);
