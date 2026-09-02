-- sime_atores — status "convocado" + fato "recebeu a convocação"
--
-- Pedido direto (28/08/2026): "o botão de convocado deve ser habilitado
-- somente quando informamos que o eleitor recebeu a convocação. o
-- confirmado, quando vier do elo, serve para confirmar a convocação e a
-- convocação [participação] do eleitor. cada mesário deve ter 4 status
-- então: não contactado, precisa substituir, convocado e confirmado."
--
-- Modelo final, esclarecido em conversa: os 5 valores atuais de
-- `confirmacao` continuam existindo (pendente=não contactado,
-- confirmado=confirmado, recusou/contato_incorreto/substituido também
-- permanecem — nenhum foi removido) — ganha só um 6º valor, 'convocado',
-- que precisa de um fato separado pra poder ser setado: o eleitor de fato
-- recebeu a convocação (confirmação MANUAL do cartório, não detecção
-- automática por AR/WhatsApp).

-- 1. Fato "recebeu a convocação" — separado de `confirmacao` de propósito,
--    mesmo padrão de `precisa_substituir` (flag independente, não um valor
--    dentro do enum): é um PRÉ-REQUISITO pro botão "Convocado" ficar
--    disponível, decidido manualmente pelo cartório (ligou e confirmou, viu
--    o AR chegar, etc.) — nunca escrito pelo Hermes.
alter table sime_atores
  add column if not exists convocacao_recebida boolean not null default false,
  add column if not exists convocacao_recebida_ts timestamptz;

-- 2. 'convocado' vira valor válido de confirmacao.
alter table sime_atores drop constraint if exists sime_atores_confirmacao_chk;
alter table sime_atores add constraint sime_atores_confirmacao_chk
  check (confirmacao = any (array['pendente','confirmado','recusou','substituido','contato_incorreto','convocado']));

comment on column sime_atores.confirmacao is
  'pendente (default, = "não contactado") | confirmado | recusou | substituido | contato_incorreto | convocado.
   convocado só é setável pelo cartório depois de marcar convocacao_recebida=true (ver SIME_convocacao.html → Contatar mesários).';
comment on column sime_atores.convocacao_recebida is
  'Confirmação MANUAL do cartório de que o eleitor recebeu a convocação (qualquer meio — WhatsApp, carta, ligação, oficial de justiça). Pré-requisito pro botão "Convocado"; nunca escrito pelo Hermes. "Confirmado" também liga isto sozinho (confirmar participação já implica ter recebido a convocação).';

-- 3. "recusou" agora também sinaliza precisa_substituir=true — antes, uma
--    recusa via WhatsApp (api/hermes-mesarios.js) marcava ativo=false e
--    SUMIA da fila de "Contatar mesários" (que só lista ativo=true) sem
--    deixar rastro nenhum de que aquela vaga precisa de gente nova. Fix de
--    código já aplicado (ver api/hermes-mesarios.js, ACAO_CONF.recusar deixa
--    de zerar ativo); esta migração só corrige o único registro que já
--    existia em produção com esse estado antigo (checado em 28/08/2026: 1
--    registro, zona 7, já estava ativo=true por algum motivo — só faltava a
--    flag).
update sime_atores set precisa_substituir = true
where confirmacao = 'recusou' and not precisa_substituir;

-- Nota à parte, sem ação necessária: meio_contato já tem 'ligacao' na
-- constraint em produção (aplicado via SQL Editor quando a Ligação
-- telefônica foi adicionada como meio de contato, 20/08/2026) — nunca tinha
-- ficado registrado num arquivo .sql até agora. Documentado aqui pra quem
-- for recriar o banco do zero não achar essa lacuna:
--   alter table sime_atores drop constraint if exists sime_atores_meio_contato_check;
--   alter table sime_atores add constraint sime_atores_meio_contato_check
--     check (meio_contato = any (array['whatsapp','carta_registrada','oficial_justica','ligacao']));
