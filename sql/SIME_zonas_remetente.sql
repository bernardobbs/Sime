-- Remetente (endereço do cartório) para etiqueta/AR de correspondência
-- (27/08/2026, pedido direto: "imprime uma etiqueta com os dados do
-- destinatario e do remetente e imprime o ar").
--
-- Onde morar esse dado: cogitado sime_usuarios (por pessoa) e sime_eleicoes
-- (por turno), descartados os dois — o endereço do cartório não muda por
-- pessoa nem por turno, é uma propriedade da ZONA (sede do cartório).
-- sime_zonas já tem numero/municipio/estado mas nenhum campo de endereço —
-- estes 6 campos cobrem o que uma etiqueta/AR precisa mostrar como
-- remetente. Todos opcionais (nullable) — a tela de Correspondência avisa
-- quando algum falta, em vez de travar a impressão.
alter table sime_zonas add column if not exists remetente_nome text;
alter table sime_zonas add column if not exists remetente_endereco text;
alter table sime_zonas add column if not exists remetente_bairro text;
alter table sime_zonas add column if not exists remetente_cep text;
alter table sime_zonas add column if not exists remetente_municipio text;
alter table sime_zonas add column if not exists remetente_uf text;

comment on column sime_zonas.remetente_nome is 'Nome do cartório eleitoral, usado como remetente em etiquetas/AR de correspondência (SIME_correspondencia).';
