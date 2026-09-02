-- sime_atores — telefone alternativo cadastrado manualmente pelo cartório
--
-- Achado real em 21/08/2026: um mesário pode ter mais de um telefone de
-- contato (a própria planilha do TRE já traz até 5 campos — ver
-- CM_RAW_TEL_CAMPOS em sime_contatar_mesarios.js — mostrados como
-- referência no modal desde o commit anterior). Mas às vezes o cartório
-- descobre um número que não está em NENHUM desses campos oficiais (ligou
-- pra um parente, alguém do local de votação informou outro contato,
-- etc.) — esse campo guarda esse número extra, digitado pelo cartório, sem
-- mexer no telefone_whatsapp principal (que continua sendo o que o Hermes
-- usa por padrão pra campanha e confirmação).
--
-- Diferente dos campos vindos do TRE (sime_mesarios_raw, staging
-- descartável), este é first-class em sime_atores — não se perde numa
-- recarga de planilha nova.
alter table sime_atores
  add column if not exists telefone_alternativo text;
