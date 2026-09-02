-- sime_campanha_etapas — imagem por etapa do script conversacional
--
-- Achado real em 22/08/2026: o disparo em massa já deixava digitar uma URL
-- de imagem mesmo escolhendo o modelo "🧩 Usar script salvo" (campo
-- "Imagem" aparecia igual pros outros modelos), mas o valor nunca era
-- entregue de verdade — api/hermes-campanhas.js só repassa imagem_url
-- quando proxima_acao='enviar' (fluxo simples), nunca pra
-- 'enviar_etapa_script'/'reenviar_etapa_script'. O cartório digitava a URL,
-- via "salvo", e a imagem nunca chegava no WhatsApp, sem erro nenhum.
--
-- Corrigido construindo suporte de verdade: imagem passa a pertencer à
-- ETAPA (igual a mensagem), não à linha de fila (sime_campanhas_confirmacao)
-- — cada etapa do script pode ter a sua própria imagem, inclusive etapas
-- seguintes (2, 3, ...), não só a primeira. O campo "Imagem" do Disparo em
-- massa (SIME_atores.html) deixa de aparecer pro modelo "script" — passa a
-- ser editado no editor de script (aba 🧩 Campanhas), por etapa.
alter table sime_campanha_etapas
  add column if not exists imagem_url text;
