-- sime_voluntarios: aceitar CPF OU título de eleitor como documento
-- (28/08/2026, pedido direto: "no mesário voluntário podemos cadastrar cpf
-- ou titulo, e digitando o numero ele escolhe se cpf ou titulo de
-- eleitor").
--
-- A coluna `cpf` (só CPF, sempre 11 dígitos) vira `documento` (genérico,
-- CPF ou título), com `tipo_documento` guardando qual é qual. A decisão de
-- qual tipo é feita no CLIENTE só pelo TAMANHO do número digitado — 11
-- dígitos = CPF, 12 = título de eleitor (mesma convenção de
-- normalizarTituloEleitor() em sime_ui_utils.js) — nunca perguntada à
-- parte nem adivinhada aqui no banco (ver vlDetectarTipoDocumento em
-- sime_voluntarios.js). tipo_documento não tem default: o cliente sempre
-- manda os dois campos juntos, de propósito — um default mascararia em
-- silêncio um insert que esqueceu de calcular o tipo.
--
-- Zero registros em sime_voluntarios nas duas zonas até esta migração
-- (tabela criada no mesmo dia) — renomear a coluna em vez de manter as
-- duas foi seguro, sem backfill necessário.
alter table sime_voluntarios rename column cpf to documento;
alter index idx_voluntarios_zona_cpf rename to idx_voluntarios_zona_documento;

alter table sime_voluntarios add column tipo_documento text
  check (tipo_documento in ('cpf', 'titulo'));
update sime_voluntarios set tipo_documento = 'cpf' where tipo_documento is null;
alter table sime_voluntarios alter column tipo_documento set not null;

comment on column sime_voluntarios.documento is
  'CPF (11 dígitos) ou título de eleitor (12 dígitos) — só dígitos, sem formatação; ver tipo_documento.';
comment on column sime_voluntarios.tipo_documento is
  'cpf | titulo — decidido pelo tamanho do número digitado (11 ou 12 dígitos), nunca perguntado à parte nem com default.';
