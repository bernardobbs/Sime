-- ============================================================
-- SIME — SQL: tabelas faltando na publicação do Realtime
--
-- Bug real encontrado em produção (06/08/2026): TV Dia não atualizava depois
-- que o cartório resolvia um problema no Painel de Problemas. A causa não
-- era o RPC (sime_ocorrencia_resolver → sime_acao_mesa grava certo) nem o
-- JS (subscribeMesaEstado já existia e já redesenha a tela) — era que
-- `sime_mesa_estado` **nunca tinha sido adicionada** à publicação
-- `supabase_realtime`. Só `sime_ocorrencias` estava lá (ver
-- SIME_ocorrencias.sql, que já fazia isso certo desde o início).
--
-- Sem a tabela na publicação, o canal Postgres Changes simplesmente nunca
-- dispara — a tela só mostra o snapshot carregado na abertura da página. Num
-- celular isso passa despercebido (a pessoa navega entre telas, cada volta
-- relê o estado do zero); num TV box ligado o dia inteiro, não há nada que
-- force uma releitura, e a tela fica presa no que carregou de manhã.
--
-- Verificado direto no Supabase (`select * from pg_publication_tables where
-- pubname='supabase_realtime'`) e corrigido com a migração aplicada nesta
-- mesma investigação — este arquivo só formaliza a correção no repo, pra
-- qualquer setup novo (94ª Zona, restauração, banco de testes) sair com o
-- Realtime completo desde o início, sem depender de alguém lembrar de rodar
-- isto manualmente no Supabase Studio.
--
-- Todas as tabelas que algum módulo assina via sime_realtime.js precisam
-- estar aqui. Ao adicionar uma subscribeX() nova em sime_realtime.js,
-- adicionar a tabela correspondente também aqui — é fácil esquecer porque o
-- código Realtime "parece" completo sem isso (não dá erro, só nunca dispara).
-- ============================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_mesa_estado;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_midias;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_rotas_estado;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_rotas_urnas;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sime_heartbeat;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
