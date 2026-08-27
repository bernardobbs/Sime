-- Telefone do substituto (27/08/2026, pedido direto: "deve vir para
-- acrescentar todos os dados do substituto" — nome sozinho não bastava pra
-- dar pra contactar quem vai substituir). Mesmo espírito de
-- substituto_nome: texto opcional, só existe enquanto precisa_substituir
-- estiver marcado (cmTogglePrecisaSubstituir limpa os dois ao desmarcar).
alter table sime_atores add column if not exists substituto_telefone text;
