-- Correspondência entre as rotas de recolhimento de mídia do SIME e as do
-- MaxLog (Sistema de Logística das Eleições do TRE-PI), 27/09/2026 — pedido
-- direto: "verifique se cada uma das rotas do pdf corresponde a uma rota do
-- sime, caso seja preciso, renomeie as rotas do sime para coincidir com as
-- rotas de recolhimento de mídias do maxlog".
--
-- Rodado uma vez via SQL Editor/MCP a partir de um PDF de 17 páginas
-- ("Rota de Recolhimento de Mídia", uma rota por página) colado pelo
-- cartório — não é uma migração que reaplica sozinha. Ver CLAUDE.md, seção
-- "CORRESPONDÊNCIA DE ROTAS COM O MAXLOG", pro relatório completo (o que
-- bateu, o que ficou ambíguo, e a planilha das 20 rotas do SIME ainda sem
-- par no MaxLog).
--
-- Nome (`sime_rotas.nome`) das 16 rotas com correspondência confirmada
-- ganhou o sufixo "— MaxLog Rota N" nesta 1ª rodada — revertido no MESMO
-- dia, pedido direto do cartório ("nome enorme... mude pra algo mais
-- simples como midias 1"): virou só "Mídias N" (`codigo` interno do SIME,
-- já referenciado noutros lugares, nunca foi tocado em nenhuma das duas
-- rodadas). **`004` e `036` ficam os dois como "Mídias 4"** — mesmo número
-- que o MaxLog usa duas vezes pra rotas fisicamente diferentes (Corredores
-- e Tangará, ver seção "CORRESPONDÊNCIA DE ROTAS COM O MAXLOG" no
-- CLAUDE.md) — pedido explicitamente assim, mesmo sabendo da duplicata.
update sime_rotas set nome = 'Mídias 1' where codigo = '001';
update sime_rotas set nome = 'Mídias 2' where codigo = '002';
update sime_rotas set nome = 'Mídias 3' where codigo = '003';
update sime_rotas set nome = 'Mídias 4' where codigo = '004'; -- Corredores
update sime_rotas set nome = 'Mídias 6' where codigo = '006';
update sime_rotas set nome = 'Mídias 7' where codigo = '007';
update sime_rotas set nome = 'Mídias 8' where codigo = '008';
update sime_rotas set nome = 'Mídias 9' where codigo = '009';
update sime_rotas set nome = 'Mídias 10' where codigo = '010';
update sime_rotas set nome = 'Mídias 11' where codigo = '011';
update sime_rotas set nome = 'Mídias 14' where codigo = '014';
update sime_rotas set nome = 'Mídias 15' where codigo = '015';
update sime_rotas set nome = 'Mídias 16' where codigo = '016';
update sime_rotas set nome = 'Mídias 17' where codigo = '017';
update sime_rotas set nome = 'Mídias 18' where codigo = '018';
update sime_rotas set nome = 'Mídias 4' where codigo = '036'; -- Tangará (mesmo nome do 004, ver nota acima)

-- Destino corrigido nas 3 rotas de Sigefredo Pacheco — o MaxLog mostra as
-- 3 convergindo pra "Câmara de Vereadores de Sigefredo Pacheco", não pra
-- "Escola Monsenhor Mateus" (que o SIME tinha registrado, herdado do
-- backfill de 04/09/2026). Vira o 5º ponto fixo em RT_DESTINOS_CONHECIDOS.
update sime_rotas set destino = 'Câmara de Vereadores de Sigefredo Pacheco' where codigo in ('014','015','016');
