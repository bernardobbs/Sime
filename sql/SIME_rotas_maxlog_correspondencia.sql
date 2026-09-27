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
-- ganhou o sufixo "— MaxLog Rota N", pra cruzar as duas numerações sem
-- ambiguidade (o `codigo` interno do SIME, já referenciado noutros lugares,
-- não foi tocado):
update sime_rotas set nome = 'Rota 001 — MaxLog Rota 1' where codigo = '001';
update sime_rotas set nome = 'Rota 002 — MaxLog Rota 2' where codigo = '002';
update sime_rotas set nome = 'Rota 003 — MaxLog Rota 3' where codigo = '003';
update sime_rotas set nome = 'Rota 004 — MaxLog Rota 4 (Corredores)' where codigo = '004';
update sime_rotas set nome = 'Rota 006 — MaxLog Rota 06' where codigo = '006';
update sime_rotas set nome = 'Rota 007 — MaxLog Rota 7' where codigo = '007';
update sime_rotas set nome = 'Rota 008 — MaxLog Rota 8' where codigo = '008';
update sime_rotas set nome = 'Rota 009 — MaxLog Rota 9' where codigo = '009';
update sime_rotas set nome = 'Rota 010 — MaxLog Rota 10' where codigo = '010';
update sime_rotas set nome = 'Rota 011 — MaxLog Rota 11' where codigo = '011';
update sime_rotas set nome = 'Rota 014 — MaxLog Rota 14' where codigo = '014';
update sime_rotas set nome = 'Rota 015 — MaxLog Rota 15' where codigo = '015';
update sime_rotas set nome = 'Rota 016 — MaxLog Rota 16' where codigo = '016';
update sime_rotas set nome = 'Rota 017 — MaxLog Rota 17' where codigo = '017';
update sime_rotas set nome = 'Rota 018 — MaxLog Rota 18' where codigo = '018';
update sime_rotas set nome = 'Rota 036 — MaxLog Rota 4 (Tangará)' where codigo = '036';

-- Destino corrigido nas 3 rotas de Sigefredo Pacheco — o MaxLog mostra as
-- 3 convergindo pra "Câmara de Vereadores de Sigefredo Pacheco", não pra
-- "Escola Monsenhor Mateus" (que o SIME tinha registrado, herdado do
-- backfill de 04/09/2026). Vira o 5º ponto fixo em RT_DESTINOS_CONHECIDOS.
update sime_rotas set destino = 'Câmara de Vereadores de Sigefredo Pacheco' where codigo in ('014','015','016');
