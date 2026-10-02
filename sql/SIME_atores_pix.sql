-- sime_atores.pix — pedido direto em 19/09/2026: cadastro de chave PIX
-- de mesários/coordenadores de acessibilidade/auxiliares de eleição, pro
-- pagamento de auxílio alimentação.
--
-- Texto livre, nunca formatado/validado por regex — a chave pode ser CPF,
-- telefone, e-mail ou aleatória — mesmo critério já usado em
-- codigo_rastreio/uc_equatorial (o formato varia demais pra validar com
-- segurança). Aplicado em produção nas duas zonas via MCP no mesmo dia.
alter table sime_atores
  add column if not exists pix text;
