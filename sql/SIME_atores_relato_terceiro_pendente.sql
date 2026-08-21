-- sime_atores — flag "tem relato de terceiro esperando confirmação"
--
-- Achado real em 21/08/2026: a nova acao 'relatar_terceiro' (outro mesário
-- reportando a situação de um colega, ver api/hermes-mesarios.js) já anexa um
-- carimbo em observacao marcado "PRECISA CONFIRMAR COM A PESSOA", mas isso
-- fica invisível a menos que o cartório abra o modal daquela pessoa
-- especificamente — não tinha como saber QUEM tem relato pendente sem
-- olhar um por um. Este campo booleano, no mesmo espírito de
-- precisa_substituir (flag manual, separada de confirmacao), dá um jeito de
-- filtrar/destacar essas pessoas em "Contatar mesários" até o cartório
-- confirmar com a própria pessoa e desmarcar.
alter table sime_atores
  add column if not exists tem_relato_terceiro_pendente boolean not null default false;
