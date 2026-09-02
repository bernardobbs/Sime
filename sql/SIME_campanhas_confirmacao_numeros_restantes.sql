-- sime_campanhas_confirmacao.numeros_restantes — cascata de números pro
-- "🧩 Rodar script conversacional" (modal de mesário), pedido direto em
-- 27/08/2026: "ele seguiria tentando contato com todos os numeros do
-- mesário caso um não confirme vai para o proximo".
--
-- Fila de telefones ainda não tentados (JSON array de strings, formato
-- "55"+DDD+número, mesma convenção de telefone_whatsapp), só usada por
-- itens avulso=true. Quando o telefone ATUAL da linha esgota (não
-- confirma — "não é essa pessoa" ou fica sem resposta até esgotar as
-- tentativas), api/hermes-campanhas.js tira o próximo desta lista, vira o
-- telefone_whatsapp da mesma linha, zera tentativas e volta pra
-- etapa_atual=1/status='pendente' — o próprio ciclo normal de 'pendentes'
-- manda a etapa 1 de novo, agora pro número novo. Só se aplica enquanto
-- etapa_atual=1 (ainda tentando estabelecer contato/confirmar identidade)
-- — depois de confirmado noutra etapa, a pessoa já está alcançável por
-- aquele número, não tem por que cascatear mais.
alter table sime_campanhas_confirmacao
  add column if not exists numeros_restantes jsonb not null default '[]'::jsonb;
