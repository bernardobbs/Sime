-- sime_atores.substituto_nome — pedido direto em 27/08/2026: "ao marcar
-- para substituir, deve ter uma forma de informar o nome do substituto".
--
-- `precisa_substituir` (já existente) é só a flag booleana — "alguém
-- precisa ser trocado, ainda em aberto". Este campo é opcional (nunca
-- bloqueia marcar a flag sem preencher — pode ser que ainda não exista
-- substituto na hora de marcar) e guarda só um NOME livre, não um vínculo
-- com outro sime_atores — o substituto quase sempre é alguém de fora do
-- cadastro (um novo voluntário indicado, ainda sem título de eleitor
-- processado), então referenciar por id seria forçar um cadastro completo
-- só pra guardar um nome de referência. Limpo junto quando a flag é
-- desmarcada (cmTogglePrecisaSubstituir) — o nome só faz sentido enquanto
-- a troca ainda está em aberto.
alter table sime_atores
  add column if not exists substituto_nome text;
