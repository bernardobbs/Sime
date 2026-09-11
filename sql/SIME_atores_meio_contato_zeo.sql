-- Meio de contato: adicionar Convocação oficial (ZEO/TRE) (02/09/2026)
-- ══════════════════════════════════════════════════════════════════════════
-- Pedido direto: "acrescente a status zeo para os contatos que tiveram
-- tentativa de contato Convocação oficial (ZEO/TRE) — Convocação formal
-- enviada pelo sistema próprio do TRE (ZEO)". Mesmo padrão de sempre pra
-- adicionar um meio de contato novo (ver Ligação telefônica, 20/08/2026,
-- sql/SIME_atores_meio_contato.sql): quinto valor de
-- sime_atores.meio_contato, ao lado de whatsapp/carta_registrada/
-- oficial_justica/ligacao.
--
-- ZEO é o sistema próprio do TRE que dispara a carta de convocação oficial
-- (PDF nominal, um por pessoa) — diferente de Carta Registrada (Correios,
-- iniciativa do cartório) e Oficial de Justiça (entrega em mão), mas do
-- mesmo tipo de coisa: convocação formal, com necessidade de confirmar
-- recebimento. Por isso reaproveita o MESMO vocabulário de status já usado
-- por Carta/Oficial (a_enviar/enviado/entregue/devolvido,
-- cmStatusLabelSet() só troca de vocabulário pra 'ligacao') — nenhuma
-- migração de status nova precisou ser criada.
-- ══════════════════════════════════════════════════════════════════════════

alter table sime_atores drop constraint if exists sime_atores_meio_contato_check;
alter table sime_atores add constraint sime_atores_meio_contato_check
  check (meio_contato = any (array['whatsapp', 'carta_registrada', 'oficial_justica', 'ligacao', 'zeo']));
