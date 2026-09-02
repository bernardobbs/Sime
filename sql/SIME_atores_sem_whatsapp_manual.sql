-- Flag manual "sem WhatsApp" (01/09/2026)
-- ══════════════════════════════════════
-- Pedido direto: "estou com uma dificildade de identificar os mesário que
-- não tem whatsapp. exemplo GILCILENE DOS SANTOS SOUSA. verifique uma
-- forma de indicar se o numero é ou não whatsapp e como filtrar isso".
--
-- Investigado antes de construir: `sime_campanhas_confirmacao.whatsapp_existe`
-- já existe desde a campanha em massa (Hermes grava quando o envio falha por
-- número sem WhatsApp), mas em produção NUNCA foi gravado nem uma vez — 0
-- linhas com esse campo preenchido, apesar de 36 tentativas registradas.
-- Não dá pra depender desse sinal hoje (pendência do lado Hermes, fora
-- deste repositório). GILCILENE especificamente nunca teve nenhuma
-- tentativa de campanha registrada — pro SIME, o número dela é
-- simplesmente desconhecido, não "confirmado sem WhatsApp".
--
-- Dois sinais complementares, nenhum dos dois inventa dado:
-- 1. Automático (telFormatoFixo(), sime_ui_utils.js) — um telefone
--    normalizado sem o 9º dígito (DDD+8, não DDD+9) é, pela numeração
--    brasileira, um fixo — fixo não tem WhatsApp. Sempre disponível, não
--    depende de nenhuma tentativa de envio.
-- 2. Manual (esta coluna) — pro caso do cartório saber por fora (o
--    telefone tem formato de celular, mas a pessoa mesma disse que não usa
--    WhatsApp nesse número, ou o Hermes já tentou e não foi por outro
--    canal) que aquele número específico não tem WhatsApp, mesmo em
--    formato de celular. Mesmo espírito de `precisa_substituir` — flag do
--    cartório, nunca mexida pelo sync nem por nenhum processo automático.
-- ══════════════════════════════════════

alter table sime_atores add column if not exists sem_whatsapp_manual boolean not null default false;
comment on column sime_atores.sem_whatsapp_manual is 'Cartório confirmou que este número não tem WhatsApp (mesmo que tenha formato de celular) — flag manual, nunca escrita por sync ou automação.';
